#!/usr/bin/env node
/**
 * Upload-pipeline self-check.
 *
 * Answers the question `checkCompression.js` cannot: not "can the engine
 * compress?" but "is anything actually being compressed on THIS deployment?".
 *
 * It reads the real configuration, pings Redis, and inspects the recent
 * `StoredFile` rows — so it distinguishes the four ways an upload stays at full
 * size, which otherwise look identical from the outside:
 *
 *   1. the worker/Redis is not running  -> rows sit QUEUED, or FAILED with
 *                                          `QUEUE_UNAVAILABLE`
 *   2. the engine ran and kept the original -> COMPLETED with `processingMethod:
 *      (the size floors, §10)                none` and a `reason`
 *   3. the type is not optimizable       -> COMPLETED / `none` (a ZIP, a video,
 *                                          an already-compressed file)
 *   4. nothing is reaching the pipeline  -> no recent rows at all
 *
 * Run it FROM THE SERVER DIRECTORY so `.env` is read:
 *
 *   cd ~/ISUAcademicPortal/server && node scripts/checkUploadPipeline.js
 *
 * Read-only: it never writes to Mongo, Redis or storage.
 */
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import StoredFile from '../src/models/StoredFile.js';
import { checkFileQueueHealth } from '../src/services/queue/fileProcessingQueue.js';
import { describeRedis } from '../src/services/queue/redis.js';

const mb = (bytes) => `${((Number(bytes) || 0) / (1024 * 1024)).toFixed(2)} MB`;
const onOff = (v) => (v ? 'on' : 'OFF');

async function main() {
  console.log('=== Upload pipeline self-check ===');
  console.log(`pipeline           : ${onOff(env.uploads.enabled)}`);
  console.log(
    `optimization       : ${onOff(env.uploads.optimization.enabled)}`
      + `  |  images: ${onOff(env.uploads.optimization.images)}`
      + `  |  pdf: ${onOff(env.uploads.optimization.pdf)}`
      + `  |  text: ${onOff(env.uploads.optimization.text)}`
  );
  console.log(
    `keep-original rule : needs BOTH >${mb(env.uploads.optimization.minSavingBytes)} and >${env.uploads.optimization.minSavingPercent}% saved`
  );
  console.log(`worker             : enabled=${onOff(env.uploads.worker.enabled)} inProcess=${onOff(env.uploads.worker.inProcess)} concurrency=${env.uploads.worker.concurrency}`);
  console.log(`redis              : ${describeRedis()}`);
  console.log('');

  if (!env.uploads.enabled) {
    console.error('RESULT: NOT WORKING — the whole pipeline is disabled (UPLOADS_ENABLED=false).');
    process.exitCode = 1;
    return;
  }

  // 1 — is Redis answering?
  const health = await checkFileQueueHealth();
  if (health.reachable) {
    console.log(`redis reachable    : yes (waiting=${health.counts?.waiting ?? 0}, active=${health.counts?.active ?? 0}, delayed=${health.counts?.delayed ?? 0}, failed=${health.counts?.failed ?? 0})`);
  } else {
    console.log(`redis reachable    : NO — ${health.error}`);
  }
  console.log('');

  // 2 — what do the recent rows say?
  await connectDB();
  const recent = await StoredFile.find({}).sort({ createdAt: -1 }).limit(8)
    .select('originalName category processingStatus processingMethod processingReason originalSize storedSize savedBytes errorCode errorMessage source.kind createdAt')
    .lean();

  if (!recent.length) {
    console.log('No StoredFile rows at all — nothing has reached the pipeline yet.');
    console.log('(Upload a file through the app and run this again.)');
    process.exit(0);
  }

  console.log('Most recent uploads:');
  for (const row of recent) {
    const when = row.createdAt ? new Date(row.createdAt).toISOString() : '?';
    const why = row.processingReason || row.errorMessage || '';
    const note = row.processingStatus === 'COMPLETED'
      ? `${mb(row.originalSize)} -> ${mb(row.storedSize)} (${row.processingMethod || 'none'}${why ? `; ${why}` : ''})`
      : `${mb(row.originalSize)} [${row.processingStatus}]${why ? ` — ${why}` : ''}`;
    console.log(`  ${when}  ${row.source?.kind || 'standalone'}/${row.category}  ${row.originalName}  ${note}`);
  }
  console.log('');

  const counts = await StoredFile.aggregate([{ $group: { _id: '$processingStatus', n: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  const optimized = await StoredFile.countDocuments({ storedOriginal: false });
  const total = await StoredFile.countDocuments({});
  console.log(`statuses           : ${JSON.stringify(byStatus)}`);
  console.log(`optimized          : ${optimized} of ${total} (${((optimized / total) * 100).toFixed(1)}%)`);
  console.log('');

  // 3 — verdict.
  const staleQueue = (byStatus.QUEUED || 0) + (byStatus.PROCESSING || 0) + (byStatus.VALIDATING || 0);
  if (!health.reachable) {
    console.error('RESULT: NOT WORKING — Redis is unreachable, so no job can run.');
    console.error('        Every upload is being stored as-is. Start Redis (or set REDIS_URL) and restart the server.');
    process.exitCode = 1;
  } else if ((byStatus.FAILED || 0) > 0 && recent.some((r) => r.errorCode === 'QUEUE_UNAVAILABLE')) {
    console.error('RESULT: NOT WORKING — jobs are failing with QUEUE_UNAVAILABLE.');
    console.error('        Redis answers now but did not when those uploads were made. Restart the API/worker and retry those files.');
    process.exitCode = 1;
  } else if (staleQueue > 0) {
    console.log(`RESULT: SUSPECT — ${staleQueue} row(s) are not terminal. If they do not move within a minute, no worker is consuming the queue.`);
    console.log('        Check that this process started the worker, or that the dedicated worker is running (`npm run worker:files`).');
  } else if (optimized === 0) {
    console.log('RESULT: ENGINE RAN, NOTHING WAS WORTH KEEPING.');
    console.log('        Every completed row reports method "none" — either the files tested are already');
    console.log('        small/compressed, or they did not clear the keep-original floors above.');
    console.log('        Test with a large scanned PDF or a >3000px JPEG to see a real saving.');
  } else {
    console.log(`RESULT: WORKING — ${optimized} file(s) were optimized and stored smaller.`);
  }

  // Forced exit on purpose: with Redis down, closing the queue connection can
  // hang indefinitely, and the verdict is already printed.
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error('RESULT: NOT WORKING — the check threw:');
  console.error(err);
  process.exit(1);
});
