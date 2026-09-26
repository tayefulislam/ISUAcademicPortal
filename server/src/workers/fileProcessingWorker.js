import { Worker } from 'bullmq';
import fs from 'node:fs/promises';
import { env } from '../config/env.js';
import { createRedisConnection } from '../services/queue/redis.js';
import { FILE_QUEUE_NAME, FILE_PROCESS_JOB, FILE_CLEANUP_JOB } from '../services/queue/fileProcessingQueue.js';
import { runProcessingJob } from '../services/uploads/processing/processPipeline.js';
import { cleanupUploads } from '../services/uploads/cleanup/tempSweeper.js';
import StoredFile from '../models/StoredFile.js';

/**
 * The BullMQ worker that runs upload processing.
 *
 * Mirrors the document worker's topology exactly (in-process by default, or a
 * dedicated process): one code path, two deployment shapes. What it does NOT do
 * is share that worker's queue — see fileProcessingQueue.js for why.
 */

let worker = null;

/** Strips a message down to something safe to persist and echo back to a client. */
function safeMessage(error) {
  return String(error?.message || 'Processing failed').slice(0, 500);
}

async function handle(job) {
  if (job.name === FILE_CLEANUP_JOB) return cleanupUploads();
  if (job.name === FILE_PROCESS_JOB) return runProcessingJob(job.data.fileId);
  return null;
}

/**
 * Starts the worker. Called by the API process (when UPLOAD_WORKER_IN_PROCESS)
 * or by the dedicated `src/fileWorker.js` process.
 */
export function startFileProcessingWorker() {
  if (worker) return worker;
  if (!env.uploads.worker.enabled) {
    console.log('[uploads] worker disabled (UPLOAD_WORKER_ENABLED=false)');
    return null;
  }

  worker = new Worker(FILE_QUEUE_NAME, handle, {
    connection: createRedisConnection(),
    concurrency: env.uploads.worker.concurrency,
    // A large file needs to stream for a while; the default lock duration can
    // expire mid-job and cause the same job to be picked up twice.
    lockDuration: Number(process.env.UPLOAD_WORKER_LOCK_MS) || 5 * 60 * 1000,
  });

  worker.on('completed', (job) => {
    if (job.name === FILE_PROCESS_JOB) console.log(`[uploads] ${job.data.fileId} processed`);
  });

  worker.on('failed', async (job, error) => {
    const fileId = job?.data?.fileId;
    const attempts = job?.attemptsMade || 1;
    const maxAttempts = job?.opts?.attempts || 1;
    const final = attempts >= maxAttempts;

    console.error(
      `[uploads] ${fileId || job?.name || 'job'} failed on attempt ${attempts}/${maxAttempts}:`,
      safeMessage(error)
    );
    if (!fileId) return;

    // runProcessingJob already recorded the failure. On the FINAL attempt only,
    // also drop the spool file — the original is already stored, so the temp
    // copy has no further purpose and a retry is not coming.
    if (final) {
      const record = await StoredFile.findById(fileId).select('tempPath').catch(() => null);
      if (record?.tempPath) {
        await fs.rm(record.tempPath, { force: true }).catch(() => null);
        await StoredFile.updateOne({ _id: fileId }, { $set: { tempPath: '' } }).catch(() => null);
      }
    }
  });

  worker.on('error', (error) => console.error('[uploads] worker error:', safeMessage(error)));

  console.log(`[uploads] worker started (concurrency=${env.uploads.worker.concurrency})`);
  return worker;
}

export async function stopFileProcessingWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export default { startFileProcessingWorker, stopFileProcessingWorker };
