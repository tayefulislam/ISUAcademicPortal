import fs from 'fs/promises';
import path from 'path';
import { ApiError } from '../../utils/ApiError.js';

// The institution's own images and PDFs, in two places:
//
//   - `server/img` — the bundled files that ship with the repository (the
//     university logo lives here). Read-only: a change is a file replacement in
//     the repo, so a design can reference it by name without re-uploading it.
//   - `private-uploads/document-assets` — anything an admin uploads from the
//     template editor. Deliberately OUTSIDE the statically-served upload dir, so
//     the only way in is the authenticated API route (never a guessable URL).
//
// A name is validated against a strict allowlist (basename only, known
// extension only) so a template can never point at an arbitrary file, and the
// resolved-path check makes that guarantee independent of the basename test.
const ASSET_ROOT = path.resolve(process.cwd(), 'img');
const UPLOAD_ROOT = path.resolve(process.cwd(), 'private-uploads', 'document-assets');

// A placed IMAGE element may only name an image; the library as a whole also
// holds PDFs, which are usable as a design's reference but never as an element.
// The two allowlists are kept separate for exactly that reason.
const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const PDF_MIME_BY_EXT = {
  '.pdf': 'application/pdf',
};

const MIME_BY_EXT = { ...IMAGE_MIME_BY_EXT, ...PDF_MIME_BY_EXT };

// Read once and reused: these are small, rarely-changed files, and the renderer
// asks for them on every preview and every generated document.
const dataUriCache = new Map();

function bareName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || name !== path.basename(name)) return '';
  return name;
}

function extOf(name) {
  return path.extname(String(name)).toLowerCase();
}

/** True only for a bare image file name (`logo.png`), never a path. */
export function isAssetFileName(value) {
  const name = bareName(value);
  return Boolean(name) && Boolean(IMAGE_MIME_BY_EXT[extOf(name)]);
}

/** True for a bare image OR PDF file name — the whole asset library. */
export function isDocumentAssetName(value) {
  const name = bareName(value);
  return Boolean(name) && Boolean(MIME_BY_EXT[extOf(name)]);
}

export function isPdfAsset(name) {
  return extOf(name) === '.pdf';
}

export function assetMimeType(name) {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

/** 'image' or 'pdf' — what the editor needs to decide how to offer the file. */
export function assetKind(name) {
  return isPdfAsset(name) ? 'pdf' : 'image';
}

function resolveIn(root, name) {
  const clean = String(name).trim();
  const target = path.resolve(root, clean);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new ApiError(422, 'Invalid asset path');
  }
  return target;
}

async function fileExists(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Where an asset actually lives: the uploads first, then the bundled folder. */
async function findAssetPath(name) {
  if (!isDocumentAssetName(name)) throw new ApiError(422, 'Invalid asset name');
  for (const root of [UPLOAD_ROOT, ASSET_ROOT]) {
    const target = resolveIn(root, name);
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(target)) return target;
  }
  return null;
}

/** True when a name is already taken by either an upload or a bundled file. */
async function assetExists(name) {
  return Boolean(await findAssetPath(name));
}

/** Every usable file in both folders. An absent folder simply means "none yet". */
export async function listAssets() {
  const assets = [];
  const seen = new Set();

  for (const [root, source] of [[UPLOAD_ROOT, 'uploaded'], [ASSET_ROOT, 'bundled']]) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue; // folder not created yet
    }
    for (const entry of entries) {
      if (!entry.isFile() || !isDocumentAssetName(entry.name) || seen.has(entry.name)) continue;
      seen.add(entry.name);
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(path.join(root, entry.name)).catch(() => null);
      assets.push({
        name: entry.name,
        size: stat ? stat.size : 0,
        mimeType: assetMimeType(entry.name),
        kind: assetKind(entry.name),
        source,
      });
    }
  }

  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readAssetBuffer(name) {
  const target = await findAssetPath(name);
  if (!target) throw new ApiError(404, 'File not found');
  return fs.readFile(target);
}

/** A cached base64 data URI — what the renderer embeds, so Chromium needs no second fetch. */
export async function readAssetDataUri(name) {
  const key = String(name).trim();
  if (dataUriCache.has(key)) return dataUriCache.get(key);
  const buffer = await readAssetBuffer(key);
  const uri = `data:${assetMimeType(key)};base64,${buffer.toString('base64')}`;
  dataUriCache.set(key, uri);
  return uri;
}

/**
 * The safe name an upload is stored under: the original basename folded to
 * `[a-z0-9-]`, with its extension kept only when it is one we allow. An empty
 * result means the file is not an image or a PDF.
 */
export function sanitizeAssetName(originalName) {
  const base = path.basename(String(originalName || '')).trim();
  const ext = extOf(base);
  if (!MIME_BY_EXT[ext]) return '';
  const stem = base
    .slice(0, -ext.length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
  return `${stem}${ext}`;
}

/**
 * Stores one uploaded file in the private asset folder under a collision-free
 * name (`logo.png`, then `logo-1.png`, …) so an upload never overwrites the
 * bundled logo or an earlier upload.
 *
 * @returns {Promise<{name:string,size:number,mimeType:string,kind:string,source:'uploaded'}>}
 */
export async function saveAsset(buffer, originalName) {
  const safe = sanitizeAssetName(originalName);
  if (!safe) throw new ApiError(400, 'Only PNG, JPG, WEBP, GIF or PDF files can be uploaded');
  if (!buffer || !buffer.length) throw new ApiError(400, 'That file is empty');

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });

  const ext = path.extname(safe);
  const stem = safe.slice(0, -ext.length);
  let name = safe;
  let attempt = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await assetExists(name)) {
    name = `${stem}-${attempt}${ext}`;
    attempt += 1;
    if (attempt > 500) throw new ApiError(409, 'Could not find a free name for that file');
  }

  await fs.writeFile(path.join(UPLOAD_ROOT, name), buffer);
  return {
    name,
    size: buffer.length,
    mimeType: assetMimeType(name),
    kind: assetKind(name),
    source: 'uploaded',
  };
}

/**
 * Removes one UPLOADED asset. The bundled repository files are not deletable
 * from the UI — a delete of one simply finds nothing in the upload folder.
 */
export async function deleteAsset(name) {
  if (!isDocumentAssetName(name)) throw new ApiError(422, 'Invalid asset name');
  const target = resolveIn(UPLOAD_ROOT, name);
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new ApiError(404, 'That file was not uploaded here and cannot be deleted');
    }
    throw error;
  }
  dataUriCache.delete(String(name).trim());
  return { name: String(name).trim() };
}

/**
 * Data URIs for every image a version places. A missing file is skipped rather
 * than fatal: the element simply prints nothing, and a document is never lost
 * because an image was removed from the library.
 */
export async function assetDataUris(fields = []) {
  const map = {};
  for (const field of fields || []) {
    if (!field || field.type !== 'IMAGE' || !isAssetFileName(field.asset)) continue;
    try {
      map[field.asset] = await readAssetDataUri(field.asset);
    } catch {
      // leave it out
    }
  }
  return map;
}

export default {
  listAssets,
  readAssetBuffer,
  readAssetDataUri,
  assetDataUris,
  isAssetFileName,
  isDocumentAssetName,
  isPdfAsset,
  assetMimeType,
  assetKind,
  sanitizeAssetName,
  saveAsset,
  deleteAsset,
};
