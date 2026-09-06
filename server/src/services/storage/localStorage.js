import fs from 'fs/promises';
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
