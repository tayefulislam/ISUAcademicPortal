import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
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

/**
 * The public URL for a stored key.
 *
 * <p>Exported because a caller that must PERSIST a URL — the academic-material
 * model keeps a `fileUrl` on every attachment — needs to derive one for a key
 * the upload pipeline chose, not only for the one its own upload returned.
 */
export function publicUrlForKey(key) {
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

  return { fileUrl: publicUrlForKey(key), fileName, storageRef: key };
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

// ---------------------------------------------------------------------------
// Streaming + multipart — the universal upload pipeline.
//
// Everything above takes a Buffer, which is fine for a cover page and fatal for
// a 5 GB recording. The functions below never accept or produce a Buffer of the
// whole object: an upload is a stream, a download is a stream, and the multipart
// path lets the BYTES go straight from the client to the bucket without passing
// through this process at all.
// ---------------------------------------------------------------------------

/** ETags arrive quoted (`"abc"`); stored metadata wants the bare value. */
function cleanEtag(value) {
  return String(value || '').replace(/^"+|"+$/g, '');
}

// lib-storage refuses a part smaller than 5 MB (S3's floor, except the last
// part) — so the configured size is clamped up rather than trusted.
const MIN_PART_SIZE_MB = 5;

/**
 * Streams an object to S3 without ever holding it whole.
 *
 * `Upload` reads the input in `partSize` chunks, so peak memory is one chunk
 * regardless of the file's size — this is what keeps RSS flat for a large
 * upload. `contentLength` should always be supplied when known (it is: the
 * caller is streaming a temp file whose size was already measured), because a
 * stream of unknown length forces lib-storage into a less efficient path.
 *
 * @param {string} key
 * @param {import('stream').Readable} body
 * @param {string} mimeType
 * @returns {Promise<{storageRef:string, etag:string}>}
 */
export async function uploadStreamS3(key, body, mimeType, { contentLength, partSizeMb } = {}) {
  const client = getClient();
  const partSize = Math.max(Number(partSizeMb) || env.uploads.partSizeMb, MIN_PART_SIZE_MB) * 1024 * 1024;

  const upload = new Upload({
    client,
    params: {
      Bucket: env.s3.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType || 'application/octet-stream',
      ContentDisposition: 'inline',
      ...(contentLength ? { ContentLength: Number(contentLength) } : {}),
    },
    partSize,
    // Four parts in flight: enough to keep a fast uplink busy without holding
    // more than ~4 chunks of memory.
    queueSize: 4,
    // A failed multipart upload is aborted instead of left to accrue storage
    // charges as an invisible incomplete upload.
    leavePartsOnError: false,
  });

  const result = await upload.done();
  return { storageRef: key, etag: cleanEtag(result?.ETag) };
}

/**
 * Begins a client-driven multipart upload. The client uploads each part
 * directly to the bucket using the presigned URLs from
 * {@link presignUploadPartS3}, so a multi-gigabyte body never touches Node.
 *
 * @returns {Promise<{uploadId:string, storageRef:string}>}
 */
export async function createMultipartUploadS3(key, mimeType) {
  const s3 = getClient();
  const out = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ContentType: mimeType || 'application/octet-stream',
      ContentDisposition: 'inline',
    })
  );
  return { uploadId: out.UploadId, storageRef: key };
}

/**
 * A presigned URL for exactly one part. Minted per request and never persisted,
 * so the exposure window is `expiresInSeconds` and nothing more — and it grants
 * write access to ONE part number of ONE key, not to the bucket.
 */
export async function presignUploadPartS3(key, uploadId, partNumber, expiresInSeconds = env.uploads.signedUrlTtlSeconds) {
  if (!key || !uploadId || !partNumber) {
    throw new Error('presignUploadPartS3 requires key, uploadId and partNumber');
  }
  const s3 = getClient();
  const command = new UploadPartCommand({
    Bucket: env.s3.bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: Number(partNumber),
  });
  return getSignedUrl(s3, command, { expiresIn: Number(expiresInSeconds) });
}

/**
 * Finishes a multipart upload. `parts` must be every uploaded part with the
 * ETag the bucket returned for it, in any order (sorted here) — S3 rejects a
 * completion that omits a part.
 *
 * @param {Array<{partNumber:number, etag:string}>} parts
 */
export async function completeMultipartUploadS3(key, uploadId, parts) {
  if (!Array.isArray(parts) || !parts.length) {
    throw new Error('completeMultipartUploadS3 requires at least one part');
  }
  const s3 = getClient();
  const sorted = [...parts]
    .map((p) => ({ PartNumber: Number(p.partNumber ?? p.PartNumber), ETag: p.etag ?? p.ETag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  const out = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: env.s3.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    })
  );
  return { storageRef: key, etag: cleanEtag(out.ETag), location: out.Location || '' };
}

/** Aborts a multipart upload. Best-effort — an abandoned upload is swept anyway. */
export async function abortMultipartUploadS3(key, uploadId) {
  if (!key || !uploadId) return;
  try {
    const s3 = getClient();
    await s3.send(new AbortMultipartUploadCommand({ Bucket: env.s3.bucket, Key: key, UploadId: uploadId }));
  } catch {
    // best-effort: the cleanup sweep re-aborts anything still dangling
  }
}

/**
 * Incomplete multipart uploads older than `olderThanMs`, for the cleanup sweep.
 * An abandoned multi-GB upload is billed for every part it left behind until it
 * is aborted, so this is worth hammering on.
 *
 * @returns {Promise<Array<{key:string, uploadId:string, initiated:Date}>>}
 */
export async function listStaleMultipartUploadsS3(prefix, olderThanMs) {
  const s3 = getClient();
  const cutoff = Date.now() - olderThanMs;
  const stale = [];
  let keyMarker;
  let uploadIdMarker;

  do {
    // eslint-disable-next-line no-await-in-loop
    const out = await s3.send(
      new ListMultipartUploadsCommand({
        Bucket: env.s3.bucket,
        Prefix: prefix || undefined,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      })
    );
    for (const upload of out.Uploads || []) {
      if (upload.Initiated && new Date(upload.Initiated).getTime() < cutoff) {
        stale.push({ key: upload.Key, uploadId: upload.UploadId, initiated: upload.Initiated });
      }
    }
    if (!out.IsTruncated) break;
    keyMarker = out.NextKeyMarker;
    uploadIdMarker = out.NextUploadIdMarker;
  } while (keyMarker);

  return stale;
}

/**
 * A streamed GET. Used to pull an object back for processing (the worker) and to
 * proxy a download for the local-provider case — never to buffer one.
 *
 * @returns {Promise<{stream:import('stream').Readable, contentType:string, contentLength:number, etag:string}>}
 */
export async function downloadStreamS3(key, { range } = {}) {
  const s3 = getClient();
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ...(range ? { Range: range } : {}),
    })
  );
  return {
    stream: out.Body,
    contentType: out.ContentType || 'application/octet-stream',
    contentLength: Number(out.ContentLength) || 0,
    etag: cleanEtag(out.ETag),
  };
}

/**
 * Object metadata without transferring the body. Returns `{exists:false}`
 * rather than throwing for a missing key, so callers can branch on it.
 */
export async function headObjectS3(key) {
  try {
    const s3 = getClient();
    const out = await s3.send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return {
      exists: true,
      contentLength: Number(out.ContentLength) || 0,
      contentType: out.ContentType || 'application/octet-stream',
      etag: cleanEtag(out.ETag),
      lastModified: out.LastModified || null,
    };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
      return { exists: false, contentLength: 0, contentType: '', etag: '', lastModified: null };
    }
    throw err;
  }
}
