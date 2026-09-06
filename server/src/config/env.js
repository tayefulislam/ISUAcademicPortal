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
};
