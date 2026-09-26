import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * End-to-end pipeline test.
 *
 * It needs a database (the pipeline updates a StoredFile row), so it SKIPS when
 * MongoDB is unreachable and runs for real wherever one is available. Everything
 * else — storage, detection, decision, processing, validation, the keep-original
 * rule — is the real production code path, not a stub.
 *
 * Storage is pointed at a throwaway directory so the run never touches the
 * repository's own uploads/ folder. Every override is set BEFORE the modules are
 * imported (hence the dynamic imports) because `env.js` freezes its values on
 * first load.
 */

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'isu-pipeline-'));
process.env.UPLOAD_TEMP_DIR = path.join(root, 'temp');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
process.env.FILE_STORAGE_PROVIDER = 'local';
process.env.UPLOAD_WORKER_ENABLED = 'false';

function canReachMongo() {
  return new Promise((resolve) => {
    const socket = net.connect(27017, '127.0.0.1');
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

const mongoUp = await canReachMongo();
const skip = mongoUp ? false : 'MongoDB is not reachable on 127.0.0.1:27017';

/** A minimal, valid, single-entry zip (stored). */
function buildZip(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14); // crc — not verified by the structure check
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localRec = Buffer.concat([local, nameBuf, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralRec = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRec.length, 12);
  eocd.writeUInt32LE(localRec.length, 16);

  return Buffer.concat([localRec, centralRec, eocd]);
}

async function setup() {
  const { connectTestDb } = await import('../../../test/dbTestUtils.js');
  const storedFileService = await import('../metadata/storedFileService.js');
  const { runProcessingJob } = await import('./processPipeline.js');
  const storage = await import('../../../storage/storageService.js');
  const { buildStorageKey } = await import('../security/filenameSanitizer.js');
  const mongoose = (await import('mongoose')).default;

  await connectTestDb('upload_pipeline');
  return { storedFileService, runProcessingJob, storage, buildStorageKey, mongoose };
}

async function teardown({ storedFileService, storage, mongoose }, fileIds = [], keys = []) {
  for (const key of keys) await storage.deleteObject(key).catch(() => null);
  for (const id of fileIds) await storedFileService.deleteRecord(id).catch(() => null);
  await mongoose.connection.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
}

test('a compressible text file is stored smaller, and the record reports the saving', { skip }, async () => {
  const ctx = await setup();
  const { storedFileService, runProcessingJob, storage, buildStorageKey, mongoose } = ctx;

  try {
    const payload = JSON.stringify({
      students: Array.from({ length: 40000 }, (_, i) => ({ id: i, roll: `ISU-${i}`, name: 'Repeatable Name' })),
    });
    const tempPath = path.join(root, 'data.json');
    await fs.writeFile(tempPath, payload);

    const ownerId = new mongoose.Types.ObjectId();
    const key = buildStorageKey({ purpose: 'test', ownerId, extension: 'json' });

    const record = await storedFileService.createStoredFile({
      ownerId,
      originalName: 'data.json',
      extension: 'json',
      mimeType: 'application/json',
      originalSize: Buffer.byteLength(payload),
      storageKey: key,
      tempPath,
      purpose: 'test',
    });

    await runProcessingJob(String(record._id));

    const fresh = await storedFileService.findById(record._id);
    assert.equal(fresh.processingStatus, 'COMPLETED');
    assert.equal(fresh.processingMethod, 'text-compression');
    assert.equal(fresh.compression, 'brotli');
    assert.equal(fresh.storedOriginal, false);
    assert.ok(fresh.storedSize < fresh.originalSize, `expected a real saving (${fresh.storedSize} < ${fresh.originalSize})`);
    assert.equal(fresh.savedBytes, fresh.originalSize - fresh.storedSize);
    assert.ok(fresh.savedPercentage > 50);

    // The compressed object really is in storage.
    const stored = await storage.getObjectMetadata(fresh.storageKey);
    assert.equal(stored.exists, true);
    assert.equal(stored.contentLength, fresh.storedSize);

    await teardown(ctx, [record._id], [fresh.storageKey]);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});

test('an already-compressed archive is stored byte-for-byte and never rewritten', { skip }, async () => {
  const ctx = await setup();
  const { storedFileService, runProcessingJob, storage, buildStorageKey, mongoose } = ctx;

  try {
    const zipBytes = buildZip('notes.txt', 'some content inside the archive');
    const tempPath = path.join(root, 'notes.zip');
    await fs.writeFile(tempPath, zipBytes);

    const ownerId = new mongoose.Types.ObjectId();
    const key = buildStorageKey({ purpose: 'test', ownerId, extension: 'zip' });

    const record = await storedFileService.createStoredFile({
      ownerId,
      originalName: 'notes.zip',
      extension: 'zip',
      mimeType: 'application/zip',
      originalSize: zipBytes.length,
      storageKey: key,
      tempPath,
      purpose: 'test',
    });

    await runProcessingJob(String(record._id));

    const fresh = await storedFileService.findById(record._id);
    assert.equal(fresh.processingStatus, 'COMPLETED');
    assert.equal(fresh.processingMethod, 'none');
    assert.equal(fresh.storedOriginal, true);
    assert.equal(fresh.storedSize, zipBytes.length, 'the stored size must equal the original');

    // And the stored bytes are identical — nothing was touched.
    const { stream } = await storage.downloadStream(fresh.storageKey);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), zipBytes);

    await teardown(ctx, [record._id], [fresh.storageKey]);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});

test('a dangerous file is refused and nothing is left stored', { skip }, async () => {
  const ctx = await setup();
  const { storedFileService, runProcessingJob, storage, buildStorageKey, mongoose } = ctx;

  try {
    const fake = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 0x40)]);
    const tempPath = path.join(root, 'evil.pdf');
    await fs.writeFile(tempPath, fake);

    const ownerId = new mongoose.Types.ObjectId();
    const key = buildStorageKey({ purpose: 'test', ownerId, extension: 'pdf' });

    const record = await storedFileService.createStoredFile({
      ownerId,
      originalName: 'evil.pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
      originalSize: fake.length,
      storageKey: key,
      tempPath,
      purpose: 'test',
    });

    await assert.rejects(runProcessingJob(String(record._id)), (err) => {
      assert.equal(err.code, 'UNSAFE_FILE_TYPE');
      return true;
    });

    const fresh = await storedFileService.findById(record._id);
    assert.equal(fresh.processingStatus, 'FAILED');
    assert.equal(fresh.errorCode, 'UNSAFE_FILE_TYPE');
    // Nothing was left behind in storage for a refused file.
    assert.equal(await storage.objectExists(fresh.storageKey), false);

    await teardown(ctx, [record._id]);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});
