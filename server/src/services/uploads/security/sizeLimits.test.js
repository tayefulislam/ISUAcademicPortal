import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SizeLimitStream, createSizeLimitStream } from './sizeLimits.js';

/** Feeds `total` bytes through a SizeLimitStream and reports what happened. */
async function push(stream, chunks) {
  const out = [];
  stream.on('data', (c) => out.push(c));
  for (const chunk of chunks) stream.write(chunk);
  await new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.end();
  });
  return Buffer.concat(out);
}

test('passes data through and counts the bytes that actually arrived', async () => {
  const stream = new SizeLimitStream(1000);
  const result = await push(stream, [Buffer.alloc(300, 1), Buffer.alloc(300, 2)]);
  assert.equal(result.length, 600);
  assert.equal(stream.bytesCounted, 600);
});

test('aborts the moment the cap is exceeded, mid-stream', async () => {
  const stream = new SizeLimitStream(500, { category: 'image' });
  await assert.rejects(
    push(stream, [Buffer.alloc(300, 1), Buffer.alloc(300, 2)]),
    (err) => {
      assert.equal(err.statusCode, 413);
      assert.equal(err.code, 'FILE_TOO_LARGE');
      assert.equal(err.details.category, 'image');
      // It aborted as soon as the second chunk crossed the line — it did not
      // wait for the whole file.
      assert.equal(err.details.receivedBytes, 600);
      return true;
    }
  );
});

test('a stream exactly at the cap is allowed', async () => {
  const stream = new SizeLimitStream(500);
  const result = await push(stream, [Buffer.alloc(500, 1)]);
  assert.equal(result.length, 500);
});

test('createSizeLimitStream sizes the cap from the file category', () => {
  const image = createSizeLimitStream('image');
  const video = createSizeLimitStream('video');
  // A video may legitimately be far larger than an image.
  assert.ok(video.limitBytes > image.limitBytes);
  assert.equal(image.category, 'image');
});
