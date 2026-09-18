import dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // Supports a comma-separated list (e.g. a custom domain plus a platform
  // subdomain) — trimmed and stripped of trailing slashes for exact
  // Origin-header matching.
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((u) => u.trim().replace(/\/$/, ''))
    .filter(Boolean),

  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/academic-file-system',

  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  fileStorageProvider: process.env.FILE_STORAGE_PROVIDER || 'local',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 50,

  imgbbApiKey: process.env.IMGBB_API_KEY || '',

  // Default for Settings.studentIdStorageProvider (DB-driven, admin-editable
  // — see models/Settings.js) the first time it's ever read. Falls back to
  // whatever the general file-storage provider already effectively used for
  // student-ID photos before this setting existed (s3 if FILE_STORAGE_PROVIDER
  // was already 's3', imgbb otherwise), so existing deployments see no
  // behavior change until an admin explicitly picks something else.
  studentIdStorageProvider:
    process.env.STUDENT_ID_STORAGE_PROVIDER || (process.env.FILE_STORAGE_PROVIDER === 's3' ? 's3' : 'imgbb'),

  uploadcarePublicKey: process.env.UPLOADCARE_PUBLIC_KEY || '',
  uploadcareSecretKey: process.env.UPLOADCARE_SECRET_KEY || '',

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    // The API endpoint (S3_ENDPOINT) is often NOT publicly readable — e.g. on
    // Cloudflare R2, `https://<account>.r2.cloudflarestorage.com` requires
    // signed requests, while the public read URL is a separate R2.dev
    // subdomain or your own custom domain. Set this to whatever base URL
    // actually serves the object publicly; falls back to path-style off the
    // API endpoint for providers where that's the same thing (e.g. MinIO).
    publicUrl: process.env.S3_PUBLIC_URL || '',
  },

  // 'smtp' | 'resend' | 'console'. Falls back to 'console' (logs the email
  // instead of sending it) whenever the selected provider is missing its
  // required credentials, so the app never crashes for lack of mail config.
  email: {
    provider: process.env.EMAIL_PROVIDER || 'console',
    fromAddress: process.env.EMAIL_FROM || 'no-reply@isucloud.local',
    fromName: process.env.EMAIL_FROM_NAME || 'ISU Academic Portal',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT) || 587,
      // Port 465 is always implicit TLS; anything else (587, 25) defaults to
      // STARTTLS (secure: false) unless SMTP_SECURE explicitly overrides it.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT) === 465,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    resend: {
      apiKey: process.env.RESEND_API_KEY || '',
    },
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  // Firebase Cloud Messaging — the Android push channel. Optional in exactly the
  // same way as `email` and `vapid`: with no credentials, fcmService silently
  // skips push and every in-app notification still works.
  //
  // The service account is supplied either inline (FIREBASE_SERVICE_ACCOUNT, for
  // hosts whose filesystem is ephemeral) or as a path
  // (FIREBASE_SERVICE_ACCOUNT_PATH). It is a SERVER-ONLY secret and must never
  // be placed in the Android app.
  firebase: {
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT || '',
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  },

  // Shared secret for the class-reminder cron target
  // (POST /api/internal/reminders/run). Reminders need to fire on a clock, and
  // this stack has no scheduler — so an external cron calls that endpoint every
  // minute. The caller is a machine, not a user, so there is no JWT to check;
  // the endpoint refuses to run at all while this is unset rather than being
  // left open.
  reminderCronSecret: process.env.REMINDER_CRON_SECRET || '',
};
