import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import path from 'path';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import Course from './models/Course.js';

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
function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true); // same-origin / curl / server-to-server
  if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return callback(null, true);
  if (env.clientUrls.includes(origin.replace(/\/$/, ''))) return callback(null, true);
  callback(new Error(`Not allowed by CORS: ${origin}`));
}

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
    console.error('[db] Course.syncIndexes failed:', err.message);
  }

  app.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();

export default app;
