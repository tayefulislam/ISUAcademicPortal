import fs from 'fs/promises';
import path from 'path';
import { ApiError } from '../../utils/ApiError.js';

// The institution's own images — the university logo lives in `server/img`.
//
// They are referenced by file NAME rather than uploaded through a template, so
// the same logo can be placed on any number of templates without re-uploading
// it, and a logo change is a file replacement in the repo rather than an edit to
// every design. The name is validated against a strict allowlist (basename only,
// image extension only) so a template can never point at an arbitrary file.
const ASSET_ROOT = path.resolve(process.cwd(), 'img');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// Read once and reused: these are small, rarely-changed files, and the renderer
// asks for them on every preview and every generated document.
const dataUriCache = new Map();

/** True only for a bare image file name (`logo.png`), never a path. */
export function isAssetFileName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (!name || name !== path.basename(name)) return false;
  return Boolean(MIME_BY_EXT[path.extname(name).toLowerCase()]);
}

export function assetMimeType(name) {
  return MIME_BY_EXT[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function resolveAssetPath(name) {
  if (!isAssetFileName(name)) throw new ApiError(422, 'Invalid image name');
  const target = path.resolve(ASSET_ROOT, String(name).trim());
  // Belt and braces: the basename check already prevents traversal, but a
  // resolved-path check makes that guarantee independent of it.
  if (!target.startsWith(ASSET_ROOT)) throw new ApiError(422, 'Invalid image path');
  return target;
}

/** Every usable image in `img/`. An absent folder simply means "no images yet". */
export async function listAssets() {
  try {
    const entries = await fs.readdir(ASSET_ROOT, { withFileTypes: true });
    const assets = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isAssetFileName(entry.name)) continue;
      const stat = await fs.stat(path.join(ASSET_ROOT, entry.name)).catch(() => null);
      assets.push({ name: entry.name, size: stat ? stat.size : 0, mimeType: assetMimeType(entry.name) });
    }
    return assets.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readAssetBuffer(name) {
  try {
    return await fs.readFile(resolveAssetPath(name));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(404, 'Image not found');
  }
}

/** A cached base64 data URI — what the renderer embeds, so Chromium needs no second fetch. */
export async function readAssetDataUri(name) {
  const key = String(name);
  if (dataUriCache.has(key)) return dataUriCache.get(key);
  const buffer = await readAssetBuffer(key);
  const uri = `data:${assetMimeType(key)};base64,${buffer.toString('base64')}`;
  dataUriCache.set(key, uri);
  return uri;
}

/**
 * Data URIs for every image a version places. A missing file is skipped rather
 * than fatal: the element simply prints nothing, and a document is never lost
 * because an image was removed from the repository.
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

export default { listAssets, readAssetBuffer, readAssetDataUri, assetDataUris, isAssetFileName, assetMimeType };
