import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import path from 'path';
import { env } from './config/env.js';
import { describeEmailProvider } from './services/email/emailService.js';
import { describeRedis } from './services/queue/redis.js';
import { connectDB } from './config/db.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { makeCorsOrigin } from './utils/corsOrigin.js';
import Course from './models/Course.js';
import Notification from './models/Notification.js';
import Question from './models/Question.js';
import User from './models/User.js';
import { logger } from './utils/logger.js';

const app = express();

// Railway/Render/most PaaS put the app behind a reverse proxy that sets
// X-Forwarded-For. Without this, Express's req.ip is the proxy's own
// address for every request, and express-rate-limit refuses to trust
// X-Forwarded-For (rightly — it's spoofable by the client otherwise),
// which is what threw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. `1` trusts
// exactly one hop (the platform's own proxy), not arbitrary upstream
// headers.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Always honors CLIENT_URL (one or more, comma-separated) regardless of
// NODE_ENV — a deploy that forgets to set NODE_ENV=production must not
// silently fall back to a dev-only CORS policy that rejects the real
// frontend. localhost/127.0.0.1 on any port is allowed as a permanent local
// dev convenience; it's harmless in production since CORS is enforced by
// the browser against the page's real origin, not spoofable by a remote
// attacker.
// The rule itself (and its reasoning) lives in utils/corsOrigin.js, so it can be
// tested without booting a server.
const corsOrigin = makeCorsOrigin();

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Locally-stored documents (pdf/doc/ppt/xls/txt/zip) are served as static
// assets. Images never hit this path — they are served from ImgBB directly.
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), env.uploadDir), {
    setHeaders: (res) => res.setHeader('Content-Disposition', 'inline'),
  })
);

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await connectDB();

  // Self-heals a legacy bug: courseId used to be globally unique, so the
  // same course code (e.g. ENG-101) could not be offered by more than one
  // department. The schema now enforces uniqueness per department instead —
  // syncIndexes drops the old global-unique index and creates the new
  // compound one on any deployment/database that still has it.
  try {
    await Course.syncIndexes();
  } catch (err) {
    logger.error(err, { source: 'app:Course.syncIndexes' });
  }

  // Self-heals a gap for the exam-builder's random question selection:
  // `difficulty` only reads back as its schema default ('medium') for a
  // document that never had the field written to Mongo — that default is
  // applied by Mongoose on read, but a raw `find({ difficulty: 'medium' })`
  // (which random-selection rules use) only matches documents where the
  // field is actually *stored*. Backfilling it once here makes every
  // pre-existing bank question properly filterable/selectable by
  // difficulty without a manual migration step.
  try {
    await Question.updateMany({ difficulty: { $exists: false } }, { $set: { difficulty: 'medium' } });
  } catch (err) {
    logger.error(err, { source: 'app:Question.difficultyBackfill' });
  }

  // Self-heals a bug where the {department, batch, rollNo} unique index's
  // partial-filter expression used `$ne` — an operator MongoDB's
  // partialFilterExpression doesn't support — so the index silently failed
  // to build on every deployment (mongoose only surfaces that failure via
  // an 'index' event nobody was listening for). Now fixed to `$gt: ''`;
  // syncIndexes builds it for the first time on any DB still missing it.
  // Registration itself also does an explicit pre-check (authController.js)
  // so a duplicate roll number is rejected with a clear message even before
  // this index exists/rebuilds.
  try {
    await User.syncIndexes();
  } catch (err) {
    logger.error(err, { source: 'app:User.syncIndexes' });
  }

  // The notification dedupe index. EVERY reminder/repeat guarantee rests on
  // {recipient, type, entityType, entityId} being unique: emit() relies on a
  // duplicate-key error to make a retried event a no-op. The collection is also
  // the one most likely to predate its own index (notifications shipped before
  // the reminder engine did), and a unique index that cannot be built — because
  // duplicates already exist — fails silently, after which every cron tick
  // writes another copy. Built here so a deployment cannot be left without it.
  //
  // A failure here is logged loudly rather than thrown: the process must still
  // start, but the admin needs to see it. See scripts/dedupeNotifications.js to
  // clear existing duplicates and then rebuild the index.
  try {
    await Notification.syncIndexes();
  } catch (err) {
    logger.error(err, { source: 'app:Notification.syncIndexes' });
    console.error(
      '[notifications] Could not build the notification dedupe index — duplicate '
      + 'notifications may be created until this is fixed. Run: '
      + 'npm --prefix server run dedupe:notifications'
    );
  }

  // Mail is optional and degrades to console logging when unconfigured, so the
  // effective transport is announced once at boot - otherwise "emails aren't
  // sending" is invisible from outside the process.
  console.log(`[email] provider=${describeEmailProvider()}`);

  // Same reasoning as the email line above: the browser can only say "blocked by
  // CORS policy", so the origins this process will actually accept are announced
  // once at boot. A frontend origin missing from this list is by far the most
  // common reason an upload fails in production while working locally.
  if (env.clientUrls.length === 0 || env.clientUrls.every((u) => u.includes('localhost'))) {
    console.warn(
      '[cors] CLIENT_URL still points only at localhost — set it to the deployed frontend origin(s), '
        + 'or every browser request from the real site will be refused'
    );
  }
  console.log(`[cors] allowing: ${env.clientUrls.join(', ') || '(none)'} (+ any localhost port)`);

  app.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port} (${env.nodeEnv})`);
  });

  // The Document Generator's worker. Started AFTER the listener and never
  // awaited: Redis being down must not stop the API from serving, it must only
  // mean documents stay queued until Redis returns. It runs in this process by
  // default (PDF_WORKER_IN_PROCESS) so a single-service deploy needs no second
  // process; set that false and run `npm run worker` instead.
  if (env.documents.workerEnabled) {
    import('./services/queue/documentQueue.js')
      .then(async ({ ensureCleanupSchedule, ensureApplicationSchedules }) => {
        // Registering a repeatable job needs only the producer, never a worker
        // — so both sweeps are scheduled here even in the two-service topology
        // where another process consumes them. (This used to sit inside the
        // worker-in-process branch, which meant a dedicated-worker deployment
        // had no export cleanup registered at all.)
        ensureCleanupSchedule().catch((err) =>
          console.error('[documents] could not schedule the expiry sweep:', err.message)
        );
        // The Write Application sweeps — the daily credit recharge and the
        // export cleanup — ride this same queue and worker.
        ensureApplicationSchedules().catch((err) =>
          console.error('[applications] could not schedule the credit/export sweeps:', err.message)
        );

        if (env.documents.workerInProcess) {
          const { startDocumentWorker } = await import('./workers/documentWorker.js');
          startDocumentWorker();
          console.log(`[documents] worker started (redis=${describeRedis()})`);
        }

        runStartupSweeps();
      })
      .catch((err) => {
        logger.error(err, { source: 'app:documentWorker' });
        console.error('[documents] worker did not start — documents will queue until it does');
      });
  }

  // The upload-processing worker. Same topology as the document worker above:
  // it runs in this process by default, or in a dedicated one when
  // UPLOAD_WORKER_IN_PROCESS=false. Started after the listener and never
  // awaited — Redis being down must only mean uploads stay queued, never that
  // the API fails to serve.
  if (env.uploads.worker.enabled) {
    Promise.all([
      import('./services/uploads/cleanup/tempSweeper.js'),
      import('./services/queue/fileProcessingQueue.js'),
    ])
      .then(async ([sweeper, queueModule]) => {
        await sweeper
          .ensureTempDirs()
          .catch((err) => console.error('[uploads] could not create the temp directories:', err.message));

        // Registered by scheduler id, so a restart re-asserts the schedule
        // rather than adding a second copy of it.
        await queueModule
          .ensureUploadCleanupSchedule()
          .catch((err) => console.error('[uploads] could not schedule the cleanup sweep:', err.message));

        if (env.uploads.worker.inProcess) {
          const { startFileProcessingWorker } = await import('./workers/fileProcessingWorker.js');
          startFileProcessingWorker();
        }

        // Catch-up for anything that expired while this process was down.
        sweeper.cleanupUploads().catch((err) => console.error('[uploads] startup sweep failed:', err.message));
      })
      .catch((err) => {
        logger.error(err, { source: 'app:fileWorker' });
        console.error('[uploads] worker did not start — uploads will queue until it does');
      });
  }
}

/**
 * Removes anything that expired while the process was down, instead of waiting
 * for the next scheduled tick — a restart after a long outage should not leave
 * temporary files in the bucket for another quarter of an hour. Both sweeps are
 * idempotent and guarded, so running this in more than one process is harmless.
 */
function runStartupSweeps() {
  import('./services/applications/exportService.js')
    .then(({ cleanupExpiredExports }) => cleanupExpiredExports())
    .then((result) => {
      if (result && result.cleaned) {
        console.log(`[applications] startup sweep removed ${result.cleaned} expired export(s)`);
      }
    })
    .catch((err) => console.error('[applications] startup export sweep failed:', err.message));

  import('./services/applications/creditService.js')
    .then(({ rechargeDueAccounts }) => rechargeDueAccounts())
    .catch((err) => console.error('[applications] startup credit recharge failed:', err.message));
}

start();

export default app;
