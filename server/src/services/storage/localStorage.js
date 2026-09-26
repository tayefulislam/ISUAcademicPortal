import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'path';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { getSafeExtension } from '../../utils/fileTypes.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), env.uploadDir);

// Deliberately OUTSIDE UPLOAD_ROOT (which app.js mounts wholesale under
// `/uploads` via express.static) so a private file can never be reached by
// guessing/URL-scanning — the only way in is the authenticated proxy route.
const PRIVATE_ROOT = path.resolve(process.cwd(), 'private-uploads');

function safeFileName(originalName) {
  const ext = getSafeExtension(originalName);
  const base = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .slice(0, 60);
  const unique = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}_${unique}_${base}.${ext}`;
}

/**
 * Store a document (non-image) buffer on the local filesystem.
 * @returns {{fileUrl:string, fileName:string, storageRef:string}}
 */
export async function uploadDocumentLocal(buffer, originalName, subDir) {
  const dir = path.join(UPLOAD_ROOT, subDir);
  await fs.mkdir(dir, { recursive: true });

  const fileName = safeFileName(originalName);
  const destPath = path.join(dir, fileName);

  // Path traversal guard: resolved path must stay inside the target dir.
  if (!destPath.startsWith(path.resolve(dir))) {
    throw new Error('Invalid file path');
  }

  await fs.writeFile(destPath, buffer);

  return {
    fileUrl: `/uploads/${subDir}/${fileName}`,
    fileName,
    storageRef: path.join(subDir, fileName),
  };
}

export async function deleteDocumentLocal(storageRef) {
  const target = path.resolve(UPLOAD_ROOT, storageRef);
  if (!target.startsWith(UPLOAD_ROOT)) {
    throw new Error('Invalid file path');
  }
  await fs.rm(target, { force: true });
}

/**
 * Store a buffer under private-uploads/<subDir>, never served statically.
 * @returns {{storageRef:string}}
 */
export async function uploadPrivateLocal(buffer, originalName, subDir) {
  const dir = path.join(PRIVATE_ROOT, subDir);
  await fs.mkdir(dir, { recursive: true });

  const fileName = safeFileName(originalName);
  const destPath = path.join(dir, fileName);
  if (!destPath.startsWith(path.resolve(dir))) {
    throw new Error('Invalid file path');
  }

  await fs.writeFile(destPath, buffer);
  return { storageRef: path.join(subDir, fileName) };
}

export async function getPrivateLocalPath(storageRef) {
  const target = path.resolve(PRIVATE_ROOT, storageRef);
  if (!target.startsWith(PRIVATE_ROOT)) {
    throw new Error('Invalid file path');
  }
  return target;
}

export async function deletePrivateLocal(storageRef) {
  const target = path.resolve(PRIVATE_ROOT, storageRef);
  if (!target.startsWith(PRIVATE_ROOT)) {
    throw new Error('Invalid file path');
  }
  await fs.rm(target, { force: true });
}

// ---------------------------------------------------------------------------
// Streaming + multipart — the development mirror of s3Storage.js's additions.
//
// The universal upload pipeline must behave identically on the local provider
// (the dev/Windows default) and on S3/R2, or Path B — the client-driven
// multipart upload used for multi-GB files — could never be exercised locally.
// So a local "multipart upload" is emulated faithfully: parts land in a temp
// directory keyed by uploadId and are concatenated on completion.
// ---------------------------------------------------------------------------

// Multipart scratch lives under the upload temp dir (never under UPLOAD_ROOT,
// which app.js serves statically — a half-finished part must not be reachable).
const MULTIPART_ROOT = path.resolve(env.uploads.tempDir, 'multipart');

/** Resolves a key to a path under UPLOAD_ROOT, refusing anything that escapes. */
function resolveUploadPath(key) {
  const target = path.resolve(UPLOAD_ROOT, key);
  if (!target.startsWith(UPLOAD_ROOT)) throw new Error('Invalid file path');
  return target;
}

/** The same for PRIVATE_ROOT. */
function resolvePrivatePath(key) {
  const target = path.resolve(PRIVATE_ROOT, key);
  if (!target.startsWith(PRIVATE_ROOT)) throw new Error('Invalid file path');
  return target;
}

function multipartDir(uploadId) {
  const dir = path.resolve(MULTIPART_ROOT, String(uploadId));
  if (!dir.startsWith(MULTIPART_ROOT)) throw new Error('Invalid upload id');
  return dir;
}

/**
 * Streams a body to `<UPLOAD_ROOT>/<key>`. `pipeline` applies backpressure, so
 * the file is never accumulated in memory however large it is.
 */
export async function uploadStreamLocal(key, stream) {
  const dest = resolveUploadPath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(stream, createWriteStream(dest));
  return { storageRef: key, fileUrl: `/uploads/${key}` };
}

/** The private-root equivalent (never served statically). */
export async function uploadPrivateStreamLocal(key, stream) {
  const dest = resolvePrivatePath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(stream, createWriteStream(dest));
  return { storageRef: key };
}

export async function downloadStreamLocal(storageRef, { private: isPrivate = false } = {}) {
  const target = isPrivate ? resolvePrivatePath(storageRef) : resolveUploadPath(storageRef);
  const stat = await fs.stat(target);
  return { stream: createReadStream(target), contentType: '', contentLength: stat.size, etag: '' };
}

export async function headObjectLocal(storageRef, { private: isPrivate = false } = {}) {
  try {
    const target = isPrivate ? resolvePrivatePath(storageRef) : resolveUploadPath(storageRef);
    const stat = await fs.stat(target);
    return { exists: true, contentLength: stat.size, contentType: '', etag: '', lastModified: stat.mtime };
  } catch {
    return { exists: false, contentLength: 0, contentType: '', etag: '', lastModified: null };
  }
}

export async function deleteObjectLocal(storageRef, { private: isPrivate = false } = {}) {
  if (!storageRef) return;
  const target = isPrivate ? resolvePrivatePath(storageRef) : resolveUploadPath(storageRef);
  await fs.rm(target, { force: true });
}

export async function createMultipartUploadLocal(key) {
  const uploadId = crypto.randomUUID();
  const dir = multipartDir(uploadId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ key, createdAt: Date.now() }));
  return { uploadId, storageRef: key };
}

export async function writePartLocal(uploadId, partNumber, stream) {
  const dir = multipartDir(uploadId);
  await fs.mkdir(dir, { recursive: true });
  const n = Number(partNumber);
  await pipeline(stream, createWriteStream(path.join(dir, `part-${n}`)));
  // A local "ETag" — the value is never verified, it only has to round-trip.
  return { partNumber: n, etag: `local-${n}` };
}

/** Concatenates the parts in part-number order into the final object. */
export async function completeMultipartUploadLocal(key, uploadId, parts) {
  const dir = multipartDir(uploadId);
  let targetKey = key;
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    if (meta?.key) targetKey = meta.key;
  } catch {
    // No sidecar (an older/aborted upload) — fall back to the caller's key.
  }

  const ordered = [...parts]
    .map((p) => Number(p.partNumber ?? p.PartNumber))
    .sort((a, b) => a - b);
  if (!ordered.length) throw new Error('completeMultipartUploadLocal requires at least one part');

  const dest = resolveUploadPath(targetKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });

  const out = createWriteStream(dest);
  for (const n of ordered) {
    // eslint-disable-next-line no-await-in-loop
    await pipeline(createReadStream(path.join(dir, `part-${n}`)), out, { end: false });
  }
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });

  await fs.rm(dir, { recursive: true, force: true });
  return { storageRef: targetKey, etag: `local-${ordered.length}` };
}

export async function abortMultipartUploadLocal(uploadId) {
  try {
    await fs.rm(multipartDir(uploadId), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Parts directories older than `olderThanMs`, for the cleanup sweep. */
export async function listStaleMultipartUploadsLocal(olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  let entries = [];
  try {
    entries = await fs.readdir(MULTIPART_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const stale = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(MULTIPART_ROOT, entry.name);
    try {
      // eslint-disable-next-line no-await-in-loop
      const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
      if ((meta?.createdAt || 0) < cutoff) {
        stale.push({ key: meta?.key || '', uploadId: entry.name, initiated: new Date(meta?.createdAt || 0) });
      }
    } catch {
      // A directory with no readable sidecar is itself stale debris.
      stale.push({ key: '', uploadId: entry.name, initiated: new Date(0) });
    }
  }
  return stale;
}
