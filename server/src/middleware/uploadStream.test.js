import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

/**
 * Tests the streaming ingest middleware directly.
 *
 * Everything is loaded DYNAMICALLY, after the environment overrides below, so
 * the tests exercise the real limit resolution rather than a hard-coded one —
 * a static import would freeze env.js before the override could apply.
 */

// A 1 MB cap for the catch-all category makes the limit testable without
// generating hundreds of megabytes.
process.env.UPLOAD_MAX_OTHER_MB = '1';
process.env.UPLOAD_TEMP_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/isu-uploads-test-${process.pid}`;

const { receiveUploadFile } = await import('./uploadStream.js');

const BOUNDARY = '----isuTestBoundary';

/** Builds a multipart/form-data body by hand. */
function multipartBody({ filename, contentType, data, fieldName = 'file', fields = {} }) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    )
  );
  parts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

/** A minimal Express-like request over a fixed body. */
function fakeRequest(body) {
  const req = Readable.from([body]);
  req.headers = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
  req.body = {};
  req.is = (type) => (req.headers['content-type'].includes(type) ? type : false);
  return req;
}

/** Runs the middleware and resolves with { error } or { req }. */
function runMiddleware(req) {
  return new Promise((resolve) => {
    const middleware = receiveUploadFile();
    middleware(req, {}, (err) => resolve({ err, req }));
  });
}

test('streams a file to disk and reports its real size, hash and detected type', async () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crypto.randomBytes(4096),
  ]);
  const req = fakeRequest(
    multipartBody({
      filename: 'diagram.png',
      contentType: 'image/png',
      data: png,
      fields: { purpose: 'academic-material' },
    })
  );

  const { err, req: done } = await runMiddleware(req);
  assert.equal(err, undefined, err && err.message);

  assert.ok(done.upload, 'req.upload should be populated');
  assert.equal(done.upload.originalName, 'diagram.png');
  assert.equal(done.upload.extension, 'png');
  assert.equal(done.upload.size, png.length, 'the size is the SERVER-side count, not a client claim');
  assert.equal(done.upload.detection.category, 'image');
  assert.equal(done.upload.detection.mime, 'image/png');
  assert.equal(done.body.purpose, 'academic-material');

  // The hash is SHA-256 of the actual bytes.
  const expected = crypto.createHash('sha256').update(png).digest('hex');
  assert.equal(done.upload.checksum, expected);

  // And the bytes really are on disk, unmodified.
  const onDisk = await fs.readFile(done.upload.tempPath);
  assert.deepEqual(onDisk, png);

  await fs.rm(done.upload.tempPath, { force: true });
});

test('rejects a file that exceeds its category limit mid-stream', async () => {
  // 1.5 MB of an unrecognized binary → category 'other' → 1 MB cap (overridden above).
  const payload = Buffer.alloc(1.5 * 1024 * 1024, 0x01);
  payload[0] = 0x00; // ensure it does not sniff as text
  const req = fakeRequest(multipartBody({ filename: 'blob.dat', contentType: 'application/octet-stream', data: payload }));

  const { err } = await runMiddleware(req);
  assert.ok(err, 'an oversized file must be rejected');
  assert.equal(err.statusCode, 413);
  assert.equal(err.code, 'FILE_TOO_LARGE');
  assert.equal(err.details.category, 'other');
});

test('rejects a request with no file', async () => {
  const body = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nacademic\r\n--${BOUNDARY}--\r\n`
  );
  const req = fakeRequest(body);

  const { err } = await runMiddleware(req);
  assert.ok(err);
  assert.equal(err.code, 'FILE_REQUIRED');
});

test('rejects an empty file', async () => {
  const req = fakeRequest(multipartBody({ filename: 'empty.txt', contentType: 'text/plain', data: Buffer.alloc(0) }));

  const { err } = await runMiddleware(req);
  assert.ok(err);
  assert.equal(err.code, 'EMPTY_FILE');
});

test('does not trust a spoofed extension — an executable is detected regardless', async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(2048)]);
  const req = fakeRequest(
    multipartBody({ filename: 'harmless-assignment.pdf', contentType: 'application/pdf', data: exe })
  );

  const { err, req: done } = await runMiddleware(req);
  assert.equal(err, undefined);
  // The client said PDF; the bytes said Windows executable.
  assert.equal(done.upload.detection.dangerous, true);
  assert.equal(done.upload.detection.mismatch, true);
  assert.notEqual(done.upload.detection.category, 'document');

  await fs.rm(done.upload.tempPath, { force: true });
});

test('refuses a non-multipart request', async () => {
  const req = Readable.from([Buffer.from('{}')]);
  req.headers = { 'content-type': 'application/json' };
  req.body = {};
  req.is = () => false;

  const { err } = await runMiddleware(req);
  assert.ok(err);
  assert.equal(err.code, 'BAD_CONTENT_TYPE');
});
