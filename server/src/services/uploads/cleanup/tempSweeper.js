import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import * as storage from '../../storage/storageService.js';
import * as storedFileService from '../metadata/storedFileService.js';
import { sweepOrphanedObjects } from './orphanSweep.js';

/**
 * Reclaiming what uploads leave behind (§20).
 *
 * Four kinds of debris, all swept here so there is one place to look:
 *
 *   1. Abandoned spool files — an upload that began and never finished. Left
 *      alone they fill the disk.
 *   2. Abandoned job scratch directories — a worker that died mid-run.
 *   3. Rows stuck in an active status — a job the queue forgot. Without this,
 *      the client would poll a spinner forever.
 *   4. Incomplete multipart uploads — the expensive one. An abandoned multi-GB
 *      upload is BILLED for every part it leaves behind, on both S3 and R2,
 *      until it is aborted.
 *   5. Orphaned objects — a stored object no live record references any more
 *      (a record deleted while MongoDB was down, an aborted upload). See
 *      orphanSweep.js.
 */

const SPOOL_DIRNAME = 'spool';
const JOBS_DIRNAME = 'jobs';

/** Creates the temp root (and its subdirectories) if missing. */
export async function ensureTempDirs() {
  await fs.mkdir(path.join(env.uploads.tempDir, SPOOL_DIRNAME), { recursive: true });
  await fs.mkdir(path.join(env.uploads.tempDir, JOBS_DIRNAME), { recursive: true });
}

/** The directory a spooled upload is written to while it streams in. */
export function spoolDir() {
  return path.join(env.uploads.tempDir, SPOOL_DIRNAME);
}

/**
 * Deletes entries under `dir` whose mtime is older than `olderThanMs`.
 * Age-based on purpose: an active upload's file is seconds old, so a file old
 * enough to be swept is one nobody is working on.
 */
async function sweepDir(dir, olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(target);
      if (stat.mtimeMs >= cutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(target, { recursive: entry.isDirectory(), force: true });
      removed += 1;
    } catch {
      // A file removed by the running worker between readdir and stat is normal.
    }
  }

  return removed;
}

/** Runs one full sweep. Idempotent, and safe to run concurrently in several processes. */
export async function cleanupUploads() {
  const ttlMs = env.uploads.cleanup.tempTtlMinutes * 60 * 1000;
  const staleMs = env.uploads.cleanup.staleJobMinutes * 60 * 1000;
  const summary = { tempFiles: 0, staleJobs: 0, multipartAborted: 0, orphansRemoved: 0 };

  // 1 & 2 — temp debris.
  summary.tempFiles += await sweepDir(spoolDir(), ttlMs);
  summary.tempFiles += await sweepDir(path.join(env.uploads.tempDir, JOBS_DIRNAME), ttlMs);

  // 3 — rows the queue has forgotten about. Any temp path they still point at is
  // now unreferenced, so it goes too.
  const expired = await storedFileService.expireStaleJobs(staleMs);
  summary.staleJobs = expired.expired;
  for (const tempPath of expired.tempPaths) {
    await fs.rm(tempPath, { force: true }).catch(() => null);
  }

  // 4 — incomplete multipart uploads. Aborted with the SAME retention window as
  // stale jobs, since that is exactly the case they represent.
  try {
    const stale = await storage.listStaleMultipartUploads(staleMs);
    for (const upload of stale) {
      // eslint-disable-next-line no-await-in-loop
      await storage.abortMultipartUpload(upload.key, upload.uploadId);
      summary.multipartAborted += 1;
    }
  } catch (err) {
    // A storage hiccup must not fail the whole sweep — the temp cleanup is the
    // part that protects the disk.
    logger.warn(`[uploads] multipart sweep failed: ${err.message}`, { source: 'cleanup' });
  }

  // 5 — objects nothing references. Reference-checked, so running this on every
  // sweep never touches a live file.
  try {
    const orphans = await sweepOrphanedObjects({ olderThanMs: staleMs });
    summary.orphansRemoved = orphans.removed;
  } catch (err) {
    logger.warn(`[uploads] orphan sweep failed: ${err.message}`, { source: 'cleanup' });
  }

  if (summary.tempFiles || summary.staleJobs || summary.multipartAborted || summary.orphansRemoved) {
    logger.info(
      `[uploads] cleanup: ${summary.tempFiles} temp file(s), ${summary.staleJobs} stale job(s), ${summary.multipartAborted} multipart abort(s), ${summary.orphansRemoved} orphan(s)`,
      { source: 'cleanup' }
    );
  }

  return summary;
}

export default { ensureTempDirs, spoolDir, cleanupUploads };
