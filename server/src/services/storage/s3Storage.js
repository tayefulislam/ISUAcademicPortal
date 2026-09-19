import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { getSafeExtension } from '../../utils/fileTypes.js';

let client = null;

function getClient() {
  if (!env.s3.endpoint || !env.s3.bucket || !env.s3.accessKeyId || !env.s3.secretAccessKey) {
    throw new Error(
      'S3 storage is not configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY'
    );
  }
  if (!client) {
    client = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint,
      credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
      // Path-style (bucket in the URL path, not as a subdomain) is required
      // by most non-AWS S3-compatible providers (R2, MinIO, Spaces) and
      // works fine against real AWS too.
      forcePathStyle: true,
    });
  }
  return client;
}

function safeFileName(originalName) {
  const ext = getSafeExtension(originalName);
  const base = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .slice(0, 60);
  const unique = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}_${unique}_${base}.${ext}`;
}

function publicUrlFor(key) {
  const base = env.s3.publicUrl || `${env.s3.endpoint.replace(/\/$/, '')}/${env.s3.bucket}`;
  return `${base.replace(/\/$/, '')}/${key}`;
}

/**
 * Uploads a document buffer to an S3-compatible bucket.
 * @returns {{fileUrl:string, fileName:string, storageRef:string}} storageRef is the object key, used for deletion.
 */
export async function uploadDocumentS3(buffer, originalName, subDir, mimeType) {
  const s3 = getClient();
  const fileName = safeFileName(originalName);
  const key = `${subDir}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
      ContentDisposition: 'inline', // serve PDFs/images inline instead of forcing a download
    })
  );

  return { fileUrl: publicUrlFor(key), fileName, storageRef: key };
}

/**
 * Uploads a buffer under a non-public key (e.g. `private/student-ids/...`)
 * and returns only the storage key — never a public URL. The object is
 * readable only via getPrivateObject below, using the server's own S3
 * credentials, so it works whether or not the bucket/CDN exposes public URLs.
 * @returns {{storageRef:string}}
 */
export async function uploadPrivateS3(buffer, originalName, subDir, mimeType) {
  const s3 = getClient();
  const fileName = safeFileName(originalName);
  const key = `${subDir}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
    })
  );

  return { storageRef: key };
}

/**
 * Fetches a private object's body stream + content type using the server's
 * own credentials. Used only by authenticated admin-only proxy endpoints —
 * never exposed as a direct/public URL.
 */
export async function getPrivateObjectS3(storageRef) {
  const s3 = getClient();
  const result = await s3.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: storageRef }));
  return { stream: result.Body, contentType: result.ContentType || 'application/octet-stream' };
}

export async function deleteDocumentS3(storageRef) {
  if (!storageRef) return;
  try {
    const s3 = getClient();
    await s3.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: storageRef }));
  } catch {
    // best-effort — an orphaned object is not worth failing the metadata
    // deletion over
  }
}

/**
 * The same delete, but it THROWS when the object could not be removed. Used by
 * the application-export sweep, which must leave a record ACTIVE to retry rather
 * than mark a still-present file as cleaned. Deleting a key that is already gone
 * still succeeds (S3 DeleteObject is idempotent).
 */
export async function deleteObjectS3Strict(storageRef) {
  if (!storageRef) return;
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: storageRef }));
}

/**
 * Stores a buffer under a caller-chosen key rather than a randomized one.
 *
 * <p>Generated documents have a deterministic key
 * (`generated-documents/{yyyy}/{MM}/{userId}/{jobId}.pdf`) so the job row and the
 * stored object can never disagree about where the file lives; a randomized name
 * would mean the key had to be read back before it could be recorded.
 *
 * @returns {Promise<{storageRef:string}>}
 */
export async function putObjectS3(key, buffer, mimeType) {
  const s3 = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/pdf',
    })
  );
  return { storageRef: key };
}

/**
 * A short-lived signed GET URL for one private object.
 *
 * <p>The bucket is never public, so this is the only way a generated document is
 * ever downloaded: minted on demand, after the caller's ownership has been
 * checked, with a deliberately short lifetime and never persisted anywhere.
 */
export async function getSignedDownloadUrlS3(key, expiresInSeconds = 300, downloadName = '') {
  if (!key) {
    throw new Error('getSignedDownloadUrlS3 requires an object key');
  }
  const s3 = getClient();
  const command = new GetObjectCommand({
    Bucket: env.s3.bucket,
    Key: key,
    // Force a download with the document's own name, and strip anything that
    // could break out of the header value.
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${String(downloadName).replace(/["\\\r\n]/g, '')}"` }
      : {}),
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
