import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';

// The queue that carries PDF generation off the request path. A generate call
// creates a DocumentJob row and adds one job here; the HTTP request returns
// immediately with the job id and never waits for the render.
export const DOCUMENT_QUEUE_NAME = 'document-generation';
export const DOCUMENT_JOB = 'generate';
export const DOCUMENT_CLEANUP_JOB = 'cleanup-expired';
export const DOCUMENT_CLEANUP_SCHEDULE_ID = 'document-cleanup-hourly';

// Write Application rides the SAME queue and worker — one scheduler, one worker
// process, no second job system. A daily safety pass recharges monthly AI
// credits (the per-account compare-and-set makes it idempotent), and an hourly
// sweep deletes expired PDF/DOCX exports from object storage.
export const AI_CREDIT_RECHARGE_JOB = 'ai-credit-recharge';
export const AI_CREDIT_RECHARGE_SCHEDULE_ID = 'ai-credit-recharge-daily';
export const APPLICATION_EXPORT_CLEANUP_JOB = 'application-export-cleanup';
export const APPLICATION_EXPORT_CLEANUP_SCHEDULE_ID = 'application-export-cleanup-hourly';

let queue = null;

/**
 * The process-wide producer. Lazily created so importing this module (e.g. from
 * a route file) never opens a socket on its own.
 */
export function getDocumentQueue() {
  if (!queue) {
    queue = new Queue(DOCUMENT_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Retries cover the transient failures a render or an upload can hit
        // (a browser that failed to launch, a 5xx from the bucket). The worker
        // records a sanitized reason on the DocumentJob when these run out.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        // Keep the completed job for a day so a status lookup stays answerable,
        // then let Redis reclaim it — the DocumentJob row is the real record.
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    // A queue-level error (its connection dropping, Redis restarting) must be
    // reported, not thrown as an unhandled event.
    queue.on('error', (error) => {
      console.error('[documents] queue error:', error.message);
    });
  }
  return queue;
}

// How long a request may wait for Redis to accept the job before the API gives
// up and reports the queue as unavailable. Without this, ioredis buffers the
// command while it is disconnected (`maxRetriesPerRequest: null`) and
// `queue.add()` simply never settles — which would hang the HTTP request, the
// exact opposite of "return immediately with a job id".
const ENQUEUE_TIMEOUT_MS = Number(process.env.DOCUMENT_ENQUEUE_TIMEOUT_MS) || 5000;

/** Adds one generation job and returns the BullMQ job (its id is stored on the row). */
export async function enqueueDocumentJob(documentJobId, { timeoutMs = ENQUEUE_TIMEOUT_MS } = {}) {
  const queue = getDocumentQueue();

  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The document queue did not accept the job in time')), timeoutMs);
  });

  try {
    return await Promise.race([queue.add(DOCUMENT_JOB, { jobId: String(documentJobId) }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers the hourly sweep that flips expired jobs to EXPIRED.
 *
 * <p>A repeatable job is registered by id, so calling this on every boot is
 * idempotent — BullMQ upserts the schedule rather than stacking copies.
 */
export async function ensureCleanupSchedule() {
  return getDocumentQueue().add(
    DOCUMENT_CLEANUP_JOB,
    {},
    {
      repeat: { pattern: '0 * * * *' },
      jobId: DOCUMENT_CLEANUP_SCHEDULE_ID,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    }
  );
}

/**
 * Registers the Write Application sweeps on the same queue. Same idempotency
 * contract as {@link ensureCleanupSchedule}: BullMQ upserts by job id, so this is
 * safe to call on every boot.
 */
export async function ensureApplicationSchedules() {
  const queue = getDocumentQueue();
  await queue.add(
    AI_CREDIT_RECHARGE_JOB,
    {},
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: AI_CREDIT_RECHARGE_SCHEDULE_ID,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    }
  );
  await queue.add(
    APPLICATION_EXPORT_CLEANUP_JOB,
    {},
    {
      repeat: { pattern: '0 * * * *' },
      jobId: APPLICATION_EXPORT_CLEANUP_SCHEDULE_ID,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    }
  );
  return true;
}

export async function closeDocumentQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export default {
  DOCUMENT_QUEUE_NAME,
  DOCUMENT_JOB,
  DOCUMENT_CLEANUP_JOB,
  AI_CREDIT_RECHARGE_JOB,
  APPLICATION_EXPORT_CLEANUP_JOB,
  getDocumentQueue,
  enqueueDocumentJob,
  ensureCleanupSchedule,
  ensureApplicationSchedules,
  closeDocumentQueue,
};
