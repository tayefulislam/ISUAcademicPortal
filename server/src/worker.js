// Dedicated worker process: `npm --prefix server run worker`.
//
// Only needed when the render should not share a process with the API — set
// PDF_WORKER_IN_PROCESS=false on the API service and run this on a second one
// (Chromium wants memory, and the API wants to stay responsive). It owns no
// HTTP listener: it connects to MongoDB and Redis and consumes the queue.
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { describeRedis } from './services/queue/redis.js';
import { ensureCleanupSchedule } from './services/queue/documentQueue.js';
import { startDocumentWorker, stopDocumentWorker } from './workers/documentWorker.js';

async function main() {
  await connectDB();
  console.log(`[worker] redis=${describeRedis()}`);

  // Registered by id, so a restart re-asserts the schedule rather than adding a
  // second copy of it.
  await ensureCleanupSchedule().catch((error) => {
    console.error('[worker] could not schedule the expiry sweep:', error.message);
  });

  startDocumentWorker();
  console.log(`[worker] running (concurrency=${env.documents.workerConcurrency})`);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down`);
  try {
    await stopDocumentWorker();
  } catch (error) {
    console.error('[worker] shutdown error:', error.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('[worker] failed to start:', error);
  process.exit(1);
});
