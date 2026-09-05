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
    region: process.env.S3_REGION || '',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
};
