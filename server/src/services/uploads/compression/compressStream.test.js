import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { compressStream, decompressStream, compressFile, decompressFileToStream, resolveCodec } from './compressStream.js';

/** Collects a readable into one Buffer. */
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Round-trips a buffer through a codec. */
function roundTrip(buffer, codec) {
  return collect(Readable.from([buffer]).pipe(compressStream(codec)).pipe(decompressStream(codec)));
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'isu-compress-'));
}

test('resolveCodec maps every input to a streamable codec', () => {
  assert.equal(resolveCodec('brotli'), 'brotli');
  assert.equal(resolveCodec('gzip'), 'gzip');
  assert.equal(resolveCodec('none'), 'none');
  // Node 22 has no streaming zstd, and the available npm modules are
  // buffer-based — which would break "never load the whole file into RAM". So
  // both 'auto' and an explicit 'zstd' resolve to brotli.
  assert.equal(resolveCodec('auto'), 'brotli');
  assert.equal(resolveCodec('zstd'), 'brotli');
  assert.equal(resolveCodec('nonsense'), 'brotli');
});

test('brotli round-trip reproduces the exact bytes', async () => {
  const input = Buffer.from(
    JSON.stringify({ students: Array.from({ length: 5000 }, (_, i) => ({ i, name: `Student ${i}` })) })
  );
  assert.deepEqual(await roundTrip(input, 'brotli'), input);
});

test('gzip round-trip reproduces the exact bytes', async () => {
  const input = Buffer.from('hello world '.repeat(1000));
  assert.deepEqual(await roundTrip(input, 'gzip'), input);
});

test("codec 'none' is a pass-through", async () => {
  const input = Buffer.from('plain');
  assert.deepEqual(await collect(Readable.from([input]).pipe(compressStream('none'))), input);
});

test('brotli actually shrinks repetitive JSON', async () => {
  const input = Buffer.from('a,b,c\n' + '1,2,3\n'.repeat(20000));
  const compressed = await collect(Readable.from([input]).pipe(compressStream('brotli')));
  assert.ok(compressed.length < input.length / 4, 'text should compress well');
  assert.deepEqual(await collect(Readable.from([compressed]).pipe(decompressStream('brotli'))), input);
});

test('compressFile reports honest sizes', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'big.json');
  const dest = path.join(dir, 'big.json.br');
  const payload = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, value: 'repeatable-content' })));
  await fs.writeFile(src, payload);

  const result = await compressFile(src, dest, 'brotli');
  assert.equal(result.codec, 'brotli');
  assert.equal(result.originalSize, Buffer.byteLength(payload));
  assert.ok(result.compressedSize < result.originalSize);

  await fs.rm(dir, { recursive: true, force: true });
});

test('decompressFileToStream yields the original content', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'data.csv');
  const dest = path.join(dir, 'data.csv.br');
  const payload = 'a,b,c\n' + '1,2,3\n'.repeat(5000);
  await fs.writeFile(src, payload);

  await compressFile(src, dest, 'brotli');
  const restored = await collect(decompressFileToStream(dest, 'brotli'));
  assert.equal(restored.toString(), payload);

  await fs.rm(dir, { recursive: true, force: true });
});

test('decompressing a truncated file surfaces an error rather than corrupt data', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'x.txt');
  const dest = path.join(dir, 'x.txt.br');
  await fs.writeFile(src, 'x'.repeat(100000));
  await compressFile(src, dest, 'brotli');

  const truncated = path.join(dir, 'truncated.br');
  const full = await fs.readFile(dest);
  await fs.writeFile(truncated, full.subarray(0, Math.floor(full.length / 2)));

  await assert.rejects(async () => {
    await collect(decompressFileToStream(truncated, 'brotli'));
  });

  await fs.rm(dir, { recursive: true, force: true });
});
