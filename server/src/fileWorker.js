// Dedicated upload-processing worker process:
//   `npm --prefix server run worker:files`
//
// Only needed when processing should not share a process with the API — set
// UPLOAD_WORKER_IN_PROCESS=false on the API service and run this on a second one.
// It owns no HTTP listener: it connects to MongoDB and Redis and consumes the
// queue. This is the deployment shape the spec's §25 diagram describes
// (API server | Redis | worker 1..n).
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { describeRedis } from './services/queue/redis.js';
import { ensureUploadCleanupSchedule } from './services/queue/fileProcessingQueue.js';
import { startFileProcessingWorker, stopFileProcessingWorker } from './workers/fileProcessingWorker.js';
import { ensureTempDirs, cleanupUploads } from './services/uploads/cleanup/tempSweeper.js';

async function main() {
  await connectDB();
  console.log(`[uploads-worker] redis=${describeRedis()}`);

  await ensureTempDirs().catch((error) => {
    console.error('[uploads-worker] could not create the temp directories:', error.message);
  });

  // Registered by scheduler id, so a restart re-asserts the schedule rather than
  // adding a second copy of it.
  await ensureUploadCleanupSchedule().catch((error) => {
    console.error('[uploads-worker] could not schedule the cleanup sweep:', error.message);
  });

  // Catch-up for whatever expired while this process was down.
  await cleanupUploads().catch((error) => {
    console.error('[uploads-worker] startup sweep failed:', error.message);
  });

  startFileProcessingWorker();
  console.log(`[uploads-worker] running (concurrency=${env.uploads.worker.concurrency})`);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[uploads-worker] ${signal} received, shutting down`);
  try {
    await stopFileProcessingWorker();
  } catch (error) {
    console.error('[uploads-worker] shutdown error:', error.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('[uploads-worker] failed to start:', error);
  process.exit(1);
});
