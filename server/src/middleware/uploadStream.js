import { createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { HARD_MAX_BYTES, limitBytesForCategory, prettyMb } from '../config/uploadLimits.js';
import { detectFileType, HEADER_BYTES } from '../services/uploads/detection/detectFileType.js';
import { sanitizeFilename, safeExtension } from '../services/uploads/security/filenameSanitizer.js';
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

/** Field names accepted on the multipart form. Anything else is ignored. */
const FILE_FIELD = 'file';
const MAX_FIELDS = 60;

/**
 * Middleware factory. Populates, on success:
 *
 *   req.body             — the text fields
 *   req.upload = {
 *     tempPath, originalName, extension, clientMime, size, checksum, detection
 *   }
 *
 * Nothing is written to anything but the spool directory, and the caller is
 * responsible for removing `tempPath` once the file is stored (the cleanup
 * sweeper is the backstop if it does not).
 */
export function receiveUploadFile() {
  return async function uploadStreamMiddleware(req, res, next) {
    try {
      await ensureTempDirs();
    } catch (err) {
      return next(new ApiError(500, 'Server storage is not writable', null, 'TEMP_UNAVAILABLE'));
    }

    if (!req.is('multipart/form-data')) {
      return next(new ApiError(400, 'Expected a multipart/form-data upload', null, 'BAD_CONTENT_TYPE'));
    }

    let settled = false;
    let ingest = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      // Remove the partially-written spool file — a rejected upload must not
      // leave debris behind.
      if (ingest?.spoolPath) fs.rm(ingest.spoolPath, { force: true }).catch(() => null);
      next(err);
    };

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        // The hard ceiling here is a coarse backstop; the real, per-category
        // limit is applied inside IngestStream once the type is known.
        limits: { fileSize: HARD_MAX_BYTES, files: 1, fields: MAX_FIELDS, fieldSize: 100 * 1024 },
      });
    } catch (err) {
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

    busboy.on('filesLimit', () => fail(new ApiError(400, 'Only one file may be uploaded per request', null, 'TOO_MANY_FILES')));

    busboy.on('file', (fieldName, fileStream, info) => {
      if (fieldName !== FILE_FIELD) {
        fileStream.resume(); // drain an unexpected field rather than stalling
        return;
      }
      if (ingest) {
        fileStream.resume();
        return;
      }

      const originalName = sanitizeFilename(info.filename || 'file');
      const extension = safeExtension(path.extname(originalName));
      const spoolPath = path.join(spoolDir(), `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${extension}`);

      ingest = new IngestStream({ originalName, clientMime: info.mimeType || '' });
      ingest.spoolPath = spoolPath;
      ingest.originalName = originalName;
      ingest.extension = extension;

      const write = pipeline(fileStream, ingest, createWriteStream(spoolPath));
      pending.push(write);

      write.catch((err) => fail(err));

      // Busboy reports its own coarse limit separately from ours.
      fileStream.on('limit', () => fail(new ApiError(413, 'File is too large', null, 'FILE_TOO_LARGE')));
    });

    busboy.on('error', (err) => fail(new ApiError(400, `Malformed upload: ${err.message}`, null, 'BAD_MULTIPART')));

    busboy.on('close', async () => {
      if (settled) return;
      try {
        await Promise.all(pending);
        if (!ingest || !ingest.detection) {
          fail(new ApiError(400, 'A file is required', null, 'FILE_REQUIRED'));
          return;
        }
        settled = true;
        req.upload = {
          tempPath: ingest.spoolPath,
          originalName: ingest.originalName,
          extension: ingest.extension,
          clientMime: ingest.clientMime,
          size: ingest.bytes,
          checksum: ingest.hash.digest('hex'),
          detection: ingest.detection,
        };
        next();
      } catch (err) {
        fail(err);
      }
    });

    // A client that disconnects mid-upload must not leave a dangling spool file.
    req.on('aborted', () => {
      if (ingest?.spoolPath) fs.rm(ingest.spoolPath, { force: true }).catch(() => null);
      if (!settled) {
        settled = true;
        next(new ApiError(499, 'Upload aborted', null, 'UPLOAD_ABORTED'));
      }
    });

    req.pipe(busboy);
  };
}

export default { receiveUploadFile };
