import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { createRedisConnection } from '../services/queue/redis.js';
import {
  DOCUMENT_QUEUE_NAME,
  DOCUMENT_JOB,
  DOCUMENT_CLEANUP_JOB,
  AI_CREDIT_RECHARGE_JOB,
  APPLICATION_EXPORT_CLEANUP_JOB,
} from '../services/queue/documentQueue.js';
import DocumentJob from '../models/DocumentJob.js';
import { processJob, expireStaleJobs, safeErrorMessage } from '../services/documents/documentService.js';

let worker = null;

async function handle(job) {
  if (job.name === DOCUMENT_CLEANUP_JOB) return expireStaleJobs();
  if (job.name === DOCUMENT_JOB) return processJob(job.data.jobId);

  // Write Application sweeps, on this same worker.
  if (job.name === AI_CREDIT_RECHARGE_JOB) {
    const { rechargeDueAccounts } = await import('../services/applications/creditService.js');
    return rechargeDueAccounts();
  }
  if (job.name === APPLICATION_EXPORT_CLEANUP_JOB) {
    const { cleanupExpiredExports } = await import('../services/applications/exportService.js');
    return cleanupExpiredExports();
  }
  return null;
}

/**
 * Starts the BullMQ worker that renders documents.
 *
 * <p>Runs in the API process by default (PDF_WORKER_IN_PROCESS) so a
 * single-service deployment needs no second process; set it false and run
 * `npm run worker` instead when the render should live on its own instance.
 */
export function startDocumentWorker() {
  if (worker) return worker;
  if (!env.documents.workerEnabled) {
    console.log('[documents] worker disabled (PDF_WORKER_ENABLED=false)');
    return null;
  }

  worker = new Worker(DOCUMENT_QUEUE_NAME, handle, {
    connection: createRedisConnection(),
    concurrency: env.documents.workerConcurrency,
  });

  worker.on('completed', (job) => {
    if (job.name === DOCUMENT_JOB) console.log(`[documents] job ${job.data.jobId} completed`);
  });

  worker.on('failed', async (job, error) => {
    const jobId = job && job.data ? job.data.jobId : null;
    console.error(
      `[documents] ${jobId || (job && job.name) || 'job'} failed on attempt ${job ? job.attemptsMade : '?'}:`,
      safeErrorMessage(error)
    );
    if (!jobId) return;

    const attempts = job.attemptsMade || 1;
    const maxAttempts = (job.opts && job.opts.attempts) || 1;
    const patch = { attempts, error: safeErrorMessage(error) };
    // Only the final attempt leaves the row FAILED — earlier failures remain
    // retryable, so the client keeps showing "generating" rather than "failed"
    // while a retry is still coming.
    if (attempts >= maxAttempts) patch.status = 'FAILED';
    await DocumentJob.updateOne({ _id: jobId }, { $set: patch }).catch(() => {});
  });

  worker.on('error', (error) => console.error('[documents] worker error', safeErrorMessage(error)));

  console.log(`[documents] worker started (concurrency=${env.documents.workerConcurrency})`);
  return worker;
}

export async function stopDocumentWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  // Imported lazily so this module (loaded by the API process too) never pulls
  // Playwright in unless the worker actually ran.
  try {
    const { closePdfBrowser } = await import('../services/pdf/pdfService.js');
    await closePdfBrowser();
  } catch {
    // nothing to close
  }
}

export default { startDocumentWorker, stopDocumentWorker };
