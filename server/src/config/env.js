import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// Comma-separated helper for the upload limits below (e.g. "jpg,png,webp"),
// trimmed and lower-cased, empty entries dropped.
function csv(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

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

  // Event-notification policy. Deliberately separate from the mail transport
  // above: EMAIL_PROVIDER says *how* mail is sent, these say *whether* an
  // in-app event also emails a copy, and who hears about a student upload.
  // Both parse strictly (`=== 'true'`), so an unset or misspelled value means
  // OFF rather than silently on.
  notifications: {
    // Master switch for the email copy of an event notification. Off by default,
    // so events stay in-app + push until mail is deliberately turned on.
    // Transactional mail (verify code, password reset, enrollment) does not go
    // through this — it calls sendEmail directly and is unaffected.
    emailEnabled: process.env.NOTIFICATION_EMAIL_ENABLED === 'true',
    // Whether Faculty are told about a student's material submission. Off by
    // default: the submission notification's audience is the CR/admin-tier
    // reviewers who work the queue, and faculty found the extra noise unwanted.
    // Flip to true to add faculty back with no code change.
    notifyFacultyOnStudentUpload: process.env.NOTIFY_FACULTY_ON_STUDENT_UPLOAD === 'true',
  },

  // Redis — the BullMQ queue that backs asynchronous PDF generation. Needed by
  // the worker process AND by the API process (every /documents/generate call
  // enqueues a job), so it is required by both, not just the worker.
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  // The institution's name, available to a template through the
  // `university.name` source. Deliberately unset by default rather than
  // hardcoded — a template that wants it can also carry it as a STATIC field.
  universityName: process.env.UNIVERSITY_NAME || '',

  // Document Generator (cover pages and other generated PDFs).
  documents: {
    // Master switch for running the BullMQ worker in this process.
    workerEnabled: process.env.PDF_WORKER_ENABLED !== 'false',
    // With a single-service deployment the worker runs in the API process; a
    // dedicated worker (npm run worker) sets this false so only that process
    // consumes the queue.
    workerInProcess: process.env.PDF_WORKER_IN_PROCESS !== 'false',
    workerConcurrency: Number(process.env.PDF_WORKER_CONCURRENCY) || 2,
    // Optional path to a system Chromium, for hosts that provide their own
    // instead of Playwright's downloaded build.
    chromiumPath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '',
    // How long a generated PDF lives before the hourly sweep removes it — the
    // object and the row both. An S3 lifecycle rule on `generated-documents/`
    // is still worth setting, but only as a backstop for objects whose row was
    // lost some other way (see docs/DEPLOYMENT_ARCHITECTURE.md).
    expiryHours: Number(process.env.DOCUMENT_EXPIRY_HOURS) || 24,
    // Hard ceiling on a rendered PDF, so a runaway template cannot fill the disk.
    maxPdfMb: Number(process.env.DOCUMENT_MAX_PDF_MB) || 10,
    // Per-user queue guards: one account must not be able to saturate the queue.
    maxActiveJobs: Number(process.env.DOCUMENT_MAX_ACTIVE_JOBS) || 5,
    maxJobsPerDay: Number(process.env.DOCUMENT_MAX_JOBS_PER_DAY) || 20,
    // A download URL is minted fresh on each request and expires quickly — it is
    // never stored, so this is the only exposure window.
    signedUrlTtlSeconds: Number(process.env.DOCUMENT_SIGNED_URL_TTL_SECONDS) || 300,
    // Requests per 15 minutes per user on POST /documents/generate.
    generateRateLimit: Number(process.env.DOCUMENT_GENERATE_RATE_LIMIT) || 10,
  },

  // Write Application — the AI layer and its credit system.
  //
  // Only `apiKey` is a secret and stays here (never in a client). Everything an
  // admin may want to change at runtime — provider, model, credit amounts,
  // rollover, export lifetime — has a DB-backed override in models/Settings.js;
  // these are the safe defaults used before/without that configuration.
  ai: {
    enabled: process.env.AI_ENABLED !== 'false',
    // 'deepseek' | 'openai' | 'openrouter' | 'gemini' — see services/ai.
    provider: process.env.AI_PROVIDER || 'deepseek',
    model: process.env.AI_MODEL || 'deepseek-chat',
    apiKey: process.env.AI_API_KEY || '',
    // Optional override for a compatible gateway; empty = the provider's own URL.
    baseUrl: process.env.AI_BASE_URL || '',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 45000,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 2000,
    temperature: Number(process.env.AI_TEMPERATURE) || 0.4,

    // Credits.
    creditsEnabled: process.env.AI_CREDIT_ENABLED !== 'false',
    monthlyCredits: Number(process.env.AI_MONTHLY_CREDITS) || 10,
    generationCost: Number(process.env.AI_APPLICATION_GENERATION_COST) || 1,
    // An AI edit action (make formal / shorter / …) is an AI call too.
    editCost: Number(process.env.AI_APPLICATION_EDIT_COST) || 1,
    // false = the month starts from the full allocation (no accumulation).
    rollover: process.env.AI_CREDIT_ROLLOVER === 'true',
    // Day of month the period starts on (1 = calendar month).
    resetDay: Number(process.env.AI_CREDIT_RESET_DAY) || 1,

    // Generated PDF/DOCX exports are temporary files; the application itself is
    // not touched by their expiry.
    exportExpirationHours: Number(process.env.AI_EXPORT_EXPIRATION_HOURS) || 24,

    // Guard rails on the free-text a user may submit.
    maxSubjectChars: Number(process.env.AI_MAX_SUBJECT_CHARS) || 200,
    maxDetailsChars: Number(process.env.AI_MAX_DETAILS_CHARS) || 4000,
    maxAdditionalChars: Number(process.env.AI_MAX_ADDITIONAL_CHARS) || 1000,
    // AI generations per 15 minutes per user, so one account cannot hammer the provider.
    generateRateLimit: Number(process.env.AI_GENERATE_RATE_LIMIT) || 12,
  },

  // Shared secret for the class-reminder cron target
  // (POST /api/internal/reminders/run). Reminders need to fire on a clock, and
  // this stack has no scheduler — so an external cron calls that endpoint every
  // minute. The caller is a machine, not a user, so there is no JWT to check;
  // the endpoint refuses to run at all while this is unset rather than being
  // left open.
  reminderCronSecret: process.env.REMINDER_CRON_SECRET || '',

  // ===== Universal Upload / Processing / Optimization =====
  //
  // Same contract as the `documents` and `ai` blocks above: every tunable has a
  // safe default here, an env override, and the app degrades rather than crashes
  // when something is missing. See services/uploads/** for the implementation
  // and docs/FILE_UPLOAD_SYSTEM.md for the operator-facing description.
  //
  // NOTE: `maxFileSizeMb` (above) is deliberately NOT reused here. That value
  // bounds the LEGACY multer.memoryStorage() path, which buffers a whole file in
  // RAM — raising it would let an existing route allocate gigabytes. The limits
  // below bound the new streaming pipeline instead, which never does.
  uploads: {
    // Master switch. When false the new pipeline is bypassed entirely and every
    // upload takes the legacy storeUploadedFile() path, unchanged.
    enabled: process.env.UPLOADS_ENABLED !== 'false',

    // Where a multipart part is spooled while streaming. Written to disk, never
    // buffered in the heap, so a 5 GB upload does not grow RSS.
    tempDir: process.env.UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'isu-uploads'),

    // Per-category caps in MB. A raw video legitimately reaches gigabytes; a
    // scanned image does not. Resolved by config/uploadLimits.js.
    limits: {
      image: Number(process.env.UPLOAD_MAX_IMAGE_MB) || 64,
      document: Number(process.env.UPLOAD_MAX_DOCUMENT_MB) || 256,
      archive: Number(process.env.UPLOAD_MAX_ARCHIVE_MB) || 1024,
      video: Number(process.env.UPLOAD_MAX_VIDEO_MB) || 4096,
      audio: Number(process.env.UPLOAD_MAX_AUDIO_MB) || 512,
      other: Number(process.env.UPLOAD_MAX_OTHER_MB) || 256,
    },
    // The fallback cap for anything the category resolver cannot classify.
    defaultMaxFileSizeMb: Number(process.env.UPLOAD_MAX_FILE_MB) || 256,
    filesPerUpload: Number(process.env.UPLOAD_MAX_FILES) || 10,

    // At or above this size the client MUST use the multipart path
    // (POST /uploads/init -> presigned part URLs -> direct to R2/S3), so the
    // bytes never pass through Node at all.
    multipartThresholdMb: Number(process.env.UPLOAD_MULTIPART_THRESHOLD_MB) || 25,
    // S3 multipart part size. 8 MB is R2's recommended floor; 16 MB keeps the
    // part count sane for multi-GB files.
    partSizeMb: Number(process.env.UPLOAD_PART_SIZE_MB) || 16,
    // Presigned URLs are minted per request and never persisted, so this is the
    // only exposure window.
    signedUrlTtlSeconds: Number(process.env.UPLOAD_SIGNED_URL_TTL_SECONDS) || 300,

    optimization: {
      enabled: process.env.UPLOAD_OPTIMIZE_ENABLED !== 'false',
      images: process.env.UPLOAD_OPTIMIZE_IMAGES !== 'false',
      pdf: process.env.UPLOAD_OPTIMIZE_PDF !== 'false',
      text: process.env.UPLOAD_OPTIMIZE_TEXT !== 'false',
      // The keep-original rule (§22): an optimized file replaces the original
      // ONLY when the saving clears BOTH floors. Replacing a 98 MB PDF with a
      // 94 MB one is not worth the quality risk, so it does not happen.
      minSavingBytes: Number(process.env.UPLOAD_MIN_SAVING_BYTES) || 262144,
      minSavingPercent: Number(process.env.UPLOAD_MIN_SAVING_PERCENT) || 5,
      // Applied when the caller does not name one. BALANCED per the spec.
      defaultPdfProfile: (process.env.UPLOAD_PDF_PROFILE || 'BALANCED').toUpperCase(),
      // Generate thumbnail/preview derivatives for images (the Android client
      // asks for the thumbnail first).
      derivatives: process.env.UPLOAD_DERIVATIVES !== 'false',
    },

    image: {
      // Long-edge cap. Anything larger is downsized (never enlarged).
      maxDimension: Number(process.env.UPLOAD_IMAGE_MAX_DIMENSION) || 3000,
      jpegQuality: Number(process.env.UPLOAD_IMAGE_JPEG_QUALITY) || 82,
      webpQuality: Number(process.env.UPLOAD_IMAGE_WEBP_QUALITY) || 80,
      pngCompressionLevel: Number(process.env.UPLOAD_IMAGE_PNG_LEVEL) || 9,
      // Convert an oversized opaque PNG/JPEG to WebP (better ratio, same
      // perceived quality). Off by default: it changes the extension, which
      // some strict clients care about.
      allowWebpConversion: process.env.UPLOAD_IMAGE_ALLOW_WEBP === 'true',
      thumbnailWidth: Number(process.env.UPLOAD_THUMB_WIDTH) || 320,
      previewWidth: Number(process.env.UPLOAD_PREVIEW_WIDTH) || 1280,
      // Text guard: a near-binary, low-colour image is almost certainly a scan
      // or a screenshot of text, so it gets a high quality floor instead of the
      // normal one. 0 disables the heuristic (always treat as a photo).
      textSafeQuality: Number(process.env.UPLOAD_IMAGE_TEXT_SAFE_QUALITY) || 90,
      textSafeSharpen: process.env.UPLOAD_IMAGE_TEXT_SHARPEN !== 'false',
    },

    pdf: {
      // The three profiles from the spec.
      //
      // Ceilings are expressed in PIXELS (long edge), not true DPI. DPI would
      // require mapping every embedded image back to the page that draws it, to
      // learn that page's physical size — more machinery, and one more thing
      // that can be wrong. A pixel ceiling is page-size independent,
      // deterministic, and directly bounds the thing that actually costs bytes
      // and decode time. On A4 that lands close to the spec's intent: ~3500 px
      // ≈ 300 DPI, ~2200 px ≈ 200 DPI, ~1400 px ≈ 120 DPI.
      profiles: {
        HIGH_QUALITY: {
          maxLongEdge: Number(process.env.UPLOAD_PDF_HQ_MAX_EDGE) || 3500,
          jpegQuality: Number(process.env.UPLOAD_PDF_HQ_QUALITY) || 90,
          downscaleOnly: true,
        },
        BALANCED: {
          maxLongEdge: Number(process.env.UPLOAD_PDF_BALANCED_MAX_EDGE) || 2200,
          jpegQuality: Number(process.env.UPLOAD_PDF_BALANCED_QUALITY) || 78,
          downscaleOnly: true,
        },
        SMALL_SIZE: {
          maxLongEdge: Number(process.env.UPLOAD_PDF_SMALL_MAX_EDGE) || 1400,
          jpegQuality: Number(process.env.UPLOAD_PDF_SMALL_QUALITY) || 62,
          downscaleOnly: true,
        },
      },
      // pdf-lib must load the whole document into memory to rewrite it, so a PDF
      // above this size is stored as-is rather than risking the heap. This is the
      // one place the "never load a huge file into RAM" rule bites, and it is a
      // deliberate, bounded exception inside a worker — never the API process.
      maxOptimizeMb: Number(process.env.UPLOAD_PDF_MAX_MB) || 300,
      // A PDF with no re-encodable images is stored as-is; rebuilding it would
      // only risk corrupting it for no gain.
      skipWhenNoImages: process.env.UPLOAD_PDF_SKIP_NO_IMAGES !== 'false',
      // Cap on images re-encoded in one job, as a runaway guard on pathological
      // documents. 0 = unlimited.
      maxImages: Number(process.env.UPLOAD_PDF_MAX_IMAGES) || 0,
      // Only JPEG-encoded (DCTDecode) image streams are re-encoded. A
      // CCITTFax/JBIG2 (1-bit scans, already tiny) or Flate-with-predictor
      // image is left exactly as it is — misinterpreting those is how a PDF gets
      // corrupted, and they are not where the bytes are.
      reencodeFilters: ['DCTDecode'],
    },

    text: {
      // 'auto' uses zstd when the optional @mongodb-js/zstd module is installed
      // and falls back to Brotli (built into Node) otherwise. Node 22 has no
      // built-in zstd, hence the adapter rather than a hard dependency.
      codec: (process.env.UPLOAD_TEXT_CODEC || 'auto').toLowerCase(),
      brotliQuality: Number(process.env.UPLOAD_BROTLI_QUALITY) || 5,
      gzipLevel: Number(process.env.UPLOAD_GZIP_LEVEL) || 9,
      // Small text files are not worth compressing at all.
      minSizeBytes: Number(process.env.UPLOAD_TEXT_MIN_BYTES) || 65536,
      // Compression must beat this or the original is stored uncompressed.
      minSavingPercent: Number(process.env.UPLOAD_TEXT_MIN_SAVING_PERCENT) || 10,
    },

    // 'off' | 'detect' | 'dedupe'. Detection (SHA-256 recorded, duplicates
    // reported) is safe and always on unless 'off'. 'dedupe' stores one
    // physical object and is deliberately opt-in — it is destructive and must
    // not be enabled before it has been exercised in a real deployment.
    dedupeMode: (process.env.UPLOAD_DEDUPE_MODE || 'detect').toLowerCase(),

    // Malware scanning hook. Empty = no scanner (the default). When set, the
    // command is run against each spooled file; a non-zero "infected" exit
    // rejects the upload. See services/uploads/security/scan.js.
    av: {
      command: process.env.UPLOAD_AV_COMMAND || '',
    },

    cleanup: {
      // An upload that never completes is swept after this long.
      tempTtlMinutes: Number(process.env.UPLOAD_TEMP_TTL_MINUTES) || 120,
      // A row stuck QUEUED/PROCESSING past this is treated as abandoned.
      staleJobMinutes: Number(process.env.UPLOAD_STALE_JOB_MINUTES) || 60,
      schedulePattern: process.env.UPLOAD_CLEANUP_CRON || '*/15 * * * *',
    },

    worker: {
      // Mirrors the document worker's topology exactly: in-process by default
      // so a single-service deploy works, dedicated process when split.
      enabled: process.env.UPLOAD_WORKER_ENABLED !== 'false',
      inProcess: process.env.UPLOAD_WORKER_IN_PROCESS !== 'false',
      concurrency: Number(process.env.UPLOAD_WORKER_CONCURRENCY) || 2,
      attempts: Number(process.env.UPLOAD_WORKER_ATTEMPTS) || 3,
    },

    rateLimit: {
      perUserPerHour: Number(process.env.UPLOAD_RATE_LIMIT_PER_HOUR) || 60,
      maxConcurrentPerUser: Number(process.env.UPLOAD_MAX_CONCURRENT_PER_USER) || 3,
    },
  },
};
