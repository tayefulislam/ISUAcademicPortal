import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';
import { env } from '../../config/env.js';

/**
 * The queue that carries file processing off the request path.
 *
 * Deliberately a SECOND queue, separate from `document-generation`. The document
 * worker runs Playwright/Chromium to render PDFs — a memory-hungry, slow,
 * long-running job. Mixing image and PDF-shredding work into that same worker
 * would mean an upload's optimization could sit behind a Chromium render, or
 * vice versa, and one saturated resource would starve the other. Separate queues
 * mean separate concurrency, separate failure domains, and separate scaling
 * (§25).
 */

export const FILE_QUEUE_NAME = 'file-processing';
export const FILE_PROCESS_JOB = 'process-upload';
export const FILE_CLEANUP_JOB = 'cleanup-uploads';
export const FILE_CLEANUP_SCHEDULE_ID = 'upload-cleanup';

// A repeatable job keeps no history.
const REPEAT_JOB_OPTS = { removeOnComplete: true, removeOnFail: true, attempts: 1 };

let queue = null;

/** The process-wide producer, created lazily so importing this module never opens a socket. */
export function getFileQueue() {
  if (!queue) {
    queue = new Queue(FILE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: env.uploads.worker.attempts,
        backoff: { type: 'exponential', delay: 5000 },
        // Keep a completed job briefly so a status lookup stays answerable; the
        // StoredFile row is the real record either way.
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    queue.on('error', (error) => {
      console.error('[uploads] queue error:', error.message);
    });
  }
  return queue;
}

// How long a request may wait for Redis to accept the job before the API gives
// up. Without this, ioredis buffers the command while disconnected and
// `queue.add()` never settles — which would hang the upload request, the exact
// opposite of "return immediately with a file id".
const ENQUEUE_TIMEOUT_MS = Number(process.env.UPLOAD_ENQUEUE_TIMEOUT_MS) || 5000;

/** Adds one processing job. The job id is the StoredFile id, so a retry replaces rather than duplicates. */
export async function enqueueFileProcessing(fileId, { timeoutMs = ENQUEUE_TIMEOUT_MS } = {}) {
  const q = getFileQueue();

  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The upload queue did not accept the job in time')), timeoutMs);
  });

  try {
    return await Promise.race([
      q.add(
        FILE_PROCESS_JOB,
        { fileId: String(fileId) },
        // A stable jobId makes a re-enqueue (a manual retry) an upsert of the
        // pending job rather than a second one racing the first.
        { jobId: `upload:${fileId}` }
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers the recurring cleanup sweep. Registered by a stable scheduler id, so
 * calling this on every boot upserts the schedule instead of stacking copies.
 */
export async function ensureUploadCleanupSchedule() {
  const q = getFileQueue();

  // Drop any scheduler left behind by an earlier cadence.
  const schedulers = await q.getJobSchedulers().catch(() => []);
  for (const scheduler of schedulers) {
    if (scheduler.name === FILE_CLEANUP_JOB && scheduler.id !== FILE_CLEANUP_SCHEDULE_ID) {
      // eslint-disable-next-line no-await-in-loop
      await q.removeJobScheduler(scheduler.id).catch(() => {});
    }
  }

  await q.upsertJobScheduler(
    FILE_CLEANUP_SCHEDULE_ID,
    { pattern: env.uploads.cleanup.schedulePattern },
    { name: FILE_CLEANUP_JOB, opts: REPEAT_JOB_OPTS }
  );
  return true;
}

export async function closeFileQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export default {
  FILE_QUEUE_NAME,
  FILE_PROCESS_JOB,
  FILE_CLEANUP_JOB,
  FILE_CLEANUP_SCHEDULE_ID,
  getFileQueue,
  enqueueFileProcessing,
  ensureUploadCleanupSchedule,
  closeFileQueue,
};
