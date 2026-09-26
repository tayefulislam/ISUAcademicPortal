import { createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

import { ApiError } from '../utils/ApiError.js';
import { HARD_MAX_BYTES, limitBytesForCategory, prettyMb } from '../config/uploadLimits.js';
import { detectFileType, HEADER_BYTES } from '../services/uploads/detection/detectFileType.js';
import { sanitizeFilename, safeExtension } from '../services/uploads/security/filenameSanitizer.js';
import { isScanningEnabled, scanFile } from '../services/uploads/security/scan.js';
import { ensureTempDirs, spoolDir } from '../services/uploads/cleanup/tempSweeper.js';

/**
 * Streaming multipart intake — the replacement for `multer.memoryStorage()`.
 *
 * The old middleware buffered an entire file in the V8 heap before any of this
 * could look at it, which is why `MAX_FILE_SIZE_MB` had to stay at 10. This one
 * pipes the request body through a single Transform straight into a spool file
 * on disk, so memory stays flat no matter how large the upload is.
 *
 * That Transform does three jobs at once, which is the point — the file is read
 * exactly once and never re-visited:
 *
 *   1. SIZE — counts bytes and aborts the moment the *category* limit is passed.
 *      The category is only knowable from the file's own header, so it is
 *      sniffed from the first chunk and the correct limit is applied from then
 *      on; until then the hard ceiling applies. This is why a 4 GB video is
 *      accepted and a 4 GB image is not, without trusting anything the client
 *      said.
 *   2. HASH — SHA-256, computed in the same pass, for duplicate detection (§19).
 *      Hashing during ingest rather than afterwards means a 5 GB file is read
 *      once, not twice.
 *   3. IDENTITY — magic-byte detection on the same buffer, so a spoofed
 *      extension or Content-Type is caught before the file is ever queued.
 *
 * One factory serves every route: the universal pipeline's single `file` field
 * and the domain routes' `files` / `attachments` / `attachment` / `image` /
 * `studentIdImage` / `source` fields all flow through {@link receiveUploads}, so
 * there is one intake implementation rather than one per controller.
 */

/**
 * Buffers the leading bytes for detection, enforces the size cap, and hashes the
 * stream — all in one pass.
 */
class IngestStream extends Transform {
  constructor({ originalName, clientMime }) {
    super();
    this.originalName = originalName;
    this.clientMime = clientMime;
    this.header = Buffer.alloc(0);
    this.bytes = 0;
    this.hash = crypto.createHash('sha256');
    this.detection = null;
    // Until the header is sniffed, only the absolute ceiling can be enforced.
    this.limit = HARD_MAX_BYTES;
    this.categoryKnown = false;
  }

  /** Runs detection and switches to that category's limit. */
  #detect() {
    this.detection = detectFileType(this.header, { originalName: this.originalName, clientMime: this.clientMime });
    this.limit = limitBytesForCategory(this.detection.category);
    this.categoryKnown = true;
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    this.hash.update(chunk);

    if (!this.categoryKnown) {
      if (this.header.length < HEADER_BYTES) {
        const need = HEADER_BYTES - this.header.length;
        this.header = Buffer.concat([this.header, chunk.subarray(0, Math.min(need, chunk.length))]);
        if (this.header.length >= HEADER_BYTES) this.#detect();
      } else {
        this.#detect();
      }
    }

    if (this.bytes > this.limit) {
      callback(
        new ApiError(
          413,
          `File is too large: ${prettyMb(this.bytes)} exceeds the ${prettyMb(this.limit)} limit for ${
            this.detection?.category || 'this'
          } files`,
          { category: this.detection?.category, limitBytes: this.limit, receivedBytes: this.bytes },
          'FILE_TOO_LARGE'
        )
      );
      return;
    }

    callback(null, chunk);
  }

  _flush(callback) {
    // A file smaller than the sniff window never triggered detection mid-stream.
    if (!this.categoryKnown) this.#detect();
    if (this.bytes === 0) {
      callback(new ApiError(400, 'The uploaded file is empty', null, 'EMPTY_FILE'));
      return;
    }
    callback();
  }
}

const MAX_FIELDS = 60;

/** Removes any spool files a rejected request left behind. */
function discardSpools(ingests) {
  for (const ingest of ingests) {
    if (ingest?.spoolPath) fs.rm(ingest.spoolPath, { force: true }).catch(() => null);
  }
}

/**
 * Middleware factory. Populates, on success:
 *
 *   req.body     — the text fields
 *   req.uploads  — one descriptor per accepted file:
 *                  { tempPath, originalName, extension, clientMime, size,
 *                    checksum, detection, fieldName }
 *   req.upload   — the first descriptor (the pipeline's single-file shape)
 *   req.files / req.file — a multer-compatible view ({ path, originalname,
 *                  mimetype, size, fieldname }) so the domain controllers keep
 *                  their existing `req.files[0]` handling while the bytes never
 *                  enter the heap.
 *
 * Nothing is written outside the spool directory, and the caller is responsible
 * for removing each `tempPath` once the file is stored (the cleanup sweeper is
 * the backstop if it does not).
 *
 * @param {{fields?:string[], maxFiles?:number, required?:boolean}} [options]
 */
export function receiveUploads({ fields = ['file'], maxFiles = 1, required = true } = {}) {
  const accepted = new Set(fields);

  return async function uploadStreamMiddleware(req, res, next) {
    try {
      await ensureTempDirs();
    } catch {
      return next(new ApiError(500, 'Server storage is not writable', null, 'TEMP_UNAVAILABLE'));
    }

    if (!req.is('multipart/form-data')) {
      return next(new ApiError(400, 'Expected a multipart/form-data upload', null, 'BAD_CONTENT_TYPE'));
    }

    let settled = false;
    /** @type {IngestStream[]} */
    const ingests = [];
    let failure = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      discardSpools(ingests);
      next(err);
    };

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        // The hard ceiling here is a coarse backstop; the real, per-category
        // limit is applied inside IngestStream once the type is known.
        limits: { fileSize: HARD_MAX_BYTES, files: maxFiles, fields: MAX_FIELDS, fieldSize: 100 * 1024 },
      });
    } catch {
      return fail(new ApiError(400, 'Malformed multipart request', null, 'BAD_MULTIPART'));
    }

    req.body = req.body || {};
    const pending = [];

    busboy.on('field', (name, value) => {
      // A repeated field becomes an array, matching how the rest of the app
      // handles e.g. multiple batch ids.
      if (req.body[name] === undefined) req.body[name] = value;
      else if (Array.isArray(req.body[name])) req.body[name].push(value);
      else req.body[name] = [req.body[name], value];
    });

    busboy.on('filesLimit', () => fail(new ApiError(400, `At most ${maxFiles} file(s) may be uploaded per request`, null, 'TOO_MANY_FILES')));

    busboy.on('file', (fieldName, fileStream, info) => {
      // A field we do not accept is drained rather than stalling the request.
      if (!accepted.has(fieldName)) {
        fileStream.resume();
        return;
      }
      if (ingests.length >= maxFiles) {
        fileStream.resume();
        return;
      }

      const originalName = sanitizeFilename(info.filename || 'file');
      const extension = safeExtension(path.extname(originalName));
      const spoolPath = path.join(spoolDir(), `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${extension}`);

      const ingest = new IngestStream({ originalName, clientMime: info.mimeType || '' });
      ingest.spoolPath = spoolPath;
      ingest.originalName = originalName;
      ingest.extension = extension;
      ingest.fieldName = fieldName;
      ingests.push(ingest);

      const write = pipeline(fileStream, ingest, createWriteStream(spoolPath));
      pending.push(write);
      write.catch((err) => {
        if (!failure) failure = err;
      });

      // Busboy reports its own coarse limit separately from ours.
      fileStream.on('limit', () => {
        if (!failure) failure = new ApiError(413, 'File is too large', null, 'FILE_TOO_LARGE');
      });
    });

    busboy.on('error', (err) => fail(new ApiError(400, `Malformed upload: ${err.message}`, null, 'BAD_MULTIPART')));

    busboy.on('close', async () => {
      if (settled) return;
      try {
        await Promise.all(pending);
        if (failure) throw failure;
        if (!ingests.length) {
          if (required) {
            fail(new ApiError(400, 'A file is required', null, 'FILE_REQUIRED'));
          } else {
            settled = true;
            req.uploads = [];
            req.upload = null;
            req.files = [];
            req.file = null;
            next();
          }
          return;
        }
        settled = true;

        const uploads = ingests.map((ingest) => ({
          tempPath: ingest.spoolPath,
          originalName: ingest.originalName,
          extension: ingest.extension,
          clientMime: ingest.clientMime,
          size: ingest.bytes,
          checksum: ingest.hash.digest('hex'),
          detection: ingest.detection,
          fieldName: ingest.fieldName,
        }));

        // Optional malware scan, BEFORE anything is stored. It is a no-op unless
        // UPLOAD_AV_COMMAND is configured, and it fails OPEN on a scanner error
        // (logged) so a broken scanner cannot block the whole portal — but a
        // positive detection rejects the upload, and the spools are removed with
        // it. Scanning here, in the one intake, is what makes it cover every
        // route rather than the several that remembered to ask for it.
        if (isScanningEnabled()) {
          for (const upload of uploads) {
            // eslint-disable-next-line no-await-in-loop
            await scanFile(upload.tempPath, { originalName: upload.originalName, mimeType: upload.clientMime });
          }
        }

        req.uploads = uploads;
        req.upload = uploads[0];
        // The multer-compatible view: `path` is what the controllers now hand to
        // storeUploadedFileFromPath, so `buffer` is deliberately absent.
        req.files = uploads.map((u) => ({
          fieldname: u.fieldName,
          originalname: u.originalName,
          mimetype: u.clientMime || u.detection?.mime || 'application/octet-stream',
          size: u.size,
          path: u.tempPath,
        }));
        req.file = req.files[0];
        next();
      } catch (err) {
        fail(err);
      }
    });

    // A client that disconnects mid-upload must not leave a dangling spool file.
    req.on('aborted', () => {
      discardSpools(ingests);
      if (!settled) {
        settled = true;
        next(new ApiError(499, 'Upload aborted', null, 'UPLOAD_ABORTED'));
      }
    });

    req.pipe(busboy);
  };
}

/**
 * The universal pipeline's single-file intake: exactly one file on the `file`
 * field, populating `req.upload`. Kept as its own name because that is the shape
 * `POST /api/uploads` is documented around.
 */
export function receiveUploadFile() {
  return receiveUploads({ fields: ['file'], maxFiles: 1 });
}

export default { receiveUploadFile, receiveUploads };
