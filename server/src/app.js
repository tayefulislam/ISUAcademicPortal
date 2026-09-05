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

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// In development, Vite may pick a fallback port (5174, 5175, ...) if 5173 is
// already in use, so any localhost origin is accepted; production is locked
// to CLIENT_URL only.
const corsOrigin =
  env.nodeEnv === 'development'
    ? (origin, callback) => {
        if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
          return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
      }
    : env.clientUrl;

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
