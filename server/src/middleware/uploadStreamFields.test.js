import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

/**
 * Tests the generalized intake factory — the one every domain route now uses.
 *
 * The single-file pipeline path is covered by uploadStream.test.js; this covers
 * the parts that make it a SHARED intake: an arbitrary field name (`files`,
 * `attachments`, `studentIdImage`, …), several files in one request, and the
 * multer-compatible `req.file(s)` view that the migrated controllers still read.
 */

process.env.UPLOAD_MAX_OTHER_MB = '1';
process.env.UPLOAD_TEMP_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/isu-uploads-fields-test-${process.pid}`;

const { receiveUploads } = await import('./uploadStream.js');

const BOUNDARY = '----isuFieldsBoundary';

/** Builds a multipart body carrying any number of files plus text fields. */
function multiBody(files, fields = {}) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      )
    );
    parts.push(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function fakeRequest(body) {
  const req = Readable.from([body]);
  req.headers = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
  req.body = {};
  req.is = (type) => (req.headers['content-type'].includes(type) ? type : false);
  return req;
}

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve({ err, req }));
  });
}

/** A minimal valid PNG so detection has real magic bytes to read. */
function png(bytes = 512) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(bytes)]);
}

test('accepts several files on the `files` field and exposes both views', async () => {
  const req = fakeRequest(
    multiBody(
      [
        { field: 'files', filename: 'one.png', contentType: 'image/png', data: png(300) },
        { field: 'files', filename: 'two.png', contentType: 'image/png', data: png(700) },
      ],
      { title: 'Course notes' }
    )
  );

  const { err, req: out } = await run(receiveUploads({ fields: ['files'], maxFiles: 10, required: false }), req);
  try {
    assert.equal(err, undefined);
    // Text fields are parsed alongside the files.
    assert.equal(out.body.title, 'Course notes');
    assert.equal(out.uploads.length, 2);
    // The pipeline's own single-file alias is the first file.
    assert.equal(out.upload.originalName, 'one.png');
    // The multer-compatible view carries a PATH, never a buffer — that is what
    // makes the migrated controllers stream instead of allocate.
    assert.equal(out.files.length, 2);
    assert.equal(out.files[1].originalname, 'two.png');
    assert.equal(out.files[1].size, 708); // 8-byte signature + 700
    assert.ok(out.files[1].path);
    assert.equal(out.files[1].buffer, undefined);

    // Each spool file really exists on disk.
    for (const upload of out.uploads) {
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(upload.tempPath);
      assert.ok(stat.isFile());
    }
  } finally {
    for (const upload of out.uploads || []) await fs.rm(upload.tempPath, { force: true }).catch(() => null);
  }
});

test('ignores a file on a field this route does not accept', async () => {
  const req = fakeRequest(
    multiBody([{ field: 'file', filename: 'nope.png', contentType: 'image/png', data: png() }])
  );

  // The route accepts `files`, so a `file` part is drained and the request ends
  // with no accepted file — which a required field reports as FILE_REQUIRED.
  const { err } = await run(receiveUploads({ fields: ['files'], maxFiles: 10 }), req);
  assert.ok(err);
  assert.equal(err.code, 'FILE_REQUIRED');
});

test('an optional field with no file is not an error', async () => {
  const req = fakeRequest(multiBody([], { title: 'No attachment' }));
  const { err, req: out } = await run(receiveUploads({ fields: ['attachment'], maxFiles: 1, required: false }), req);

  assert.equal(err, undefined);
  assert.equal(out.upload, null);
  assert.equal(out.file, null);
  assert.deepEqual(out.uploads, []);
});

test('refuses more files than the route allows', async () => {
  const req = fakeRequest(
    multiBody([
      { field: 'files', filename: 'a.png', contentType: 'image/png', data: png() },
      { field: 'files', filename: 'b.png', contentType: 'image/png', data: png() },
    ])
  );

  const { err } = await run(receiveUploads({ fields: ['files'], maxFiles: 1 }), req);
  assert.ok(err);
  assert.equal(err.code, 'TOO_MANY_FILES');
});
