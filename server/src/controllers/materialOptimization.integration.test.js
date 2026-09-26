import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Upload Material / Submit Material → optimized in storage → served smaller.
 *
 * <p>This is the integration the whole system exists for, so it is tested
 * against the REAL controller and the REAL worker rather than around them: a
 * file goes in through `uploadFiles`, and the assertions are on what the material
 * document and the bucket look like afterwards.
 *
 * <p>Needs a database, so it SKIPS when MongoDB is unreachable and runs for real
 * wherever one is available (CI points TEST_MONGODB_URI at a test cluster).
 * Storage is forced to the LOCAL provider over a throwaway directory, so the run
 * never touches the repository's own uploads/ and needs no S3 credentials.
 *
 * <p>Everything is imported dynamically, after the environment overrides below,
 * because `env.js` freezes its values on first load.
 */

const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'isu-material-'));
process.env.FILE_STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIR = path.join(storageRoot, 'uploads');
process.env.UPLOAD_TEMP_DIR = path.join(storageRoot, 'temp');
process.env.UPLOADS_ENABLED = 'true';
process.env.UPLOAD_WORKER_ENABLED = 'false';

function canReachMongo() {
  const target = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
  let host = '127.0.0.1';
  let port = 27017;
  try {
    const url = new URL(target);
    host = url.hostname;
    port = Number(url.port) || 27017;
  } catch {
    // Fall back to localhost.
  }

  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

const mongoUp = await canReachMongo();
const skip = mongoUp ? false : 'MongoDB is not reachable';

/** A PDF of `pages` pages, each drawing one large noisy JPEG. */
async function imageHeavyPdf({ pages = 4, width = 2600, height = 3400 } = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const sharp = (await import('sharp')).default;

  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 7 + y * 13) % 256;
      raw[i + 1] = (x * 29 + y * 3) % 256;
      raw[i + 2] = (x * 11 + y * 97) % 256;
    }
  }
  const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();

  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  for (let p = 0; p < pages; p += 1) {
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}

/** A PDF with no images — nothing for the optimizer to re-encode. */
async function textOnlyPdf(pages = 2) {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let p = 0; p < pages; p += 1) {
    doc.addPage([595, 842]).drawText(`Page ${p + 1}`, { x: 40, y: 800, size: 12 });
  }
  return Buffer.from(await doc.save());
}

/** A minimal valid single-entry zip. */
function zipBytes(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
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
  const centralRec = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRec.length, 12);
  eocd.writeUInt32LE(localRec.length, 16);

  return Buffer.concat([localRec, centralRec, eocd]);
}

async function waitFor(fn, { timeoutMs = 4000, everyMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function setup() {
  const { connectTestDb } = await import('../test/dbTestUtils.js');
  const mongoose = (await import('mongoose')).default;

  const models = {
    Department: (await import('../models/Department.js')).default,
    Course: (await import('../models/Course.js')).default,
    Category: (await import('../models/Category.js')).default,
    Batch: (await import('../models/Batch.js')).default,
    Semester: (await import('../models/Semester.js')).default,
    User: (await import('../models/User.js')).default,
    File: (await import('../models/File.js')).default,
    StoredFile: (await import('../models/StoredFile.js')).default,
  };

  await connectTestDb('material_optimization');

  const department = await models.Department.create({ name: 'CSE', code: 'CSE' });
  const course = await models.Course.create({
    name: 'Algorithms',
    courseId: 'CSE-203',
    department: department._id,
  });
  const category = await models.Category.create({ name: 'Lecture Notes', slug: 'lecture-notes' });
  const batch = await models.Batch.create({ name: 'BATCH-14', code: 'BATCH-14', department: department._id });
  const semester = await models.Semester.create({ name: '3rd Semester', code: 'SEM-3' });
  const admin = await models.User.create({
    name: 'Admin One',
    email: `admin-${Date.now()}@example.com`,
    password: 'secret123',
    role: 'admin',
  });

  return { mongoose, models, department, course, category, batch, semester, admin };
}

/** Drives the real controller with an Express-shaped req/res. */
async function callUploadFiles({ admin, department, course, category, file }) {
  const { uploadFiles } = await import('./fileController.js');

  const req = {
    user: admin,
    body: {
      departmentId: String(department._id),
      courseIdRef: String(course._id),
      categoryId: String(category._id),
      title: 'Scanned Lecture Notes',
      description: '',
      semester: '3rd Semester',
      visibility: 'login_required',
    },
    files: [file],
    headers: {},
    protocol: 'http',
    get: () => 'localhost',
  };

  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  let failure = null;
  await uploadFiles(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return res;
}

/**
 * Tears the run down, whatever happened.
 *
 * <p>Takes no context on purpose: a test that threw inside `setup()` never got
 * one, and a connection left open makes the runner HANG rather than fail — which
 * is far harder to diagnose than an error.
 */
async function teardown() {
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect().catch(() => null);
  } catch {
    // The run is already failing; nothing useful to add.
  }
  await fs.rm(storageRoot, { recursive: true, force: true }).catch(() => null);
}

test('Upload Material stores the file, optimizes it, and repoints the material at the smaller object', { skip }, async () => {
  const ctx = await setup();
  const { models } = ctx;

  try {
    const pdf = await imageHeavyPdf({ pages: 4 });
    const res = await callUploadFiles({
      ...ctx,
      file: { buffer: pdf, originalname: 'scan.pdf', mimetype: 'application/pdf', size: pdf.length },
    });

    assert.equal(res.statusCode, 201, 'the upload itself must succeed');
    const fileId = res.payload.data._id;
    const originalKey = res.payload.data.attachments[0].storageRef;
    const originalUrl = res.payload.data.fileUrl;

    // The material is immediately valid and points at the original — that is what
    // makes the asynchronous optimization safe.
    assert.ok(originalKey, 'the original object is stored');
    assert.equal(res.payload.data.fileSize, pdf.length);

    // The optimization job was recorded against this exact attachment.
    const job = await waitFor(() =>
      models.StoredFile.findOne({ 'source.fileId': fileId }).lean()
    );
    assert.ok(job, 'a StoredFile record was created for the material');
    assert.equal(job.source.kind, 'material');
    assert.equal(String(job.source.attachmentId), String(res.payload.data.attachments[0]._id));
    assert.equal(job.storageKey, originalKey, 'the job starts from the object the material points at');

    // Run the worker's own entry point.
    const { runProcessingJob } = await import('../services/uploads/processing/processPipeline.js');
    const storage = await import('../services/storage/storageService.js');
    await runProcessingJob(String(job._id));

    const material = await models.File.findById(fileId);
    const attachment = material.attachments[0];

    // The material now points at a SMALLER object, and the original is gone.
    assert.notEqual(attachment.storageRef, originalKey, 'the attachment was repointed');
    assert.ok(
      attachment.storageRef.startsWith('academic-material/'),
      `expected an optimized key, got ${attachment.storageRef}`
    );
    assert.ok(attachment.fileSize < pdf.length, `expected a smaller file, got ${attachment.fileSize} vs ${pdf.length}`);
    assert.equal(String(attachment.storedFileId), String(job._id));

    // The top-level mirror fields must follow, or every listing keeps advertising
    // the old object and the old total size.
    assert.notEqual(material.fileUrl, originalUrl);
    assert.equal(material.storageRef, attachment.storageRef);
    assert.equal(material.fileSize, attachment.fileSize);

    // And the storage agrees: the new object is there, the old one is not.
    assert.equal(await storage.objectExists(attachment.storageRef), true);
    assert.equal(await storage.objectExists(originalKey), false, 'the superseded original was removed');

    const finished = await models.StoredFile.findById(job._id).lean();
    assert.equal(finished.processingStatus, 'COMPLETED');
    assert.ok(finished.savedBytes > 0);
    assert.equal(finished.storedOriginal, false);

    await teardown(ctx);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});

test('a file with nothing to optimize leaves the material exactly as uploaded', { skip }, async () => {
  const ctx = await setup();
  const { models } = ctx;

  try {
    const pdf = await textOnlyPdf(2);
    const res = await callUploadFiles({
      ...ctx,
      file: { buffer: pdf, originalname: 'notes.pdf', mimetype: 'application/pdf', size: pdf.length },
    });

    const fileId = res.payload.data._id;
    const originalKey = res.payload.data.attachments[0].storageRef;

    const job = await waitFor(() => models.StoredFile.findOne({ 'source.fileId': fileId }).lean());
    assert.ok(job);

    const { runProcessingJob } = await import('../services/uploads/processing/processPipeline.js');
    const storage = await import('../services/storage/storageService.js');
    await runProcessingJob(String(job._id));

    const material = await models.File.findById(fileId);
    // A PDF with no re-encodable images is declined, not rebuilt — so the
    // material must still point at the object it was uploaded as.
    assert.equal(material.attachments[0].storageRef, originalKey);
    assert.equal(material.attachments[0].fileSize, pdf.length);
    assert.equal(await storage.objectExists(originalKey), true, 'the original must survive');

    const finished = await models.StoredFile.findById(job._id).lean();
    assert.equal(finished.processingStatus, 'COMPLETED');
    assert.equal(finished.processingMethod, 'none');
    assert.equal(finished.storedOriginal, true);

    await teardown(ctx);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});

test('an already-compressed archive is recorded but never downloaded by a worker', { skip }, async () => {
  const ctx = await setup();
  const { models } = ctx;

  try {
    const zip = zipBytes('notes.txt', 'content');
    const res = await callUploadFiles({
      ...ctx,
      file: { buffer: zip, originalname: 'archive.zip', mimetype: 'application/zip', size: zip.length },
    });

    const record = await waitFor(() => models.StoredFile.findOne({ 'source.fileId': res.payload.data._id }).lean());
    assert.ok(record, 'the bytes are still accounted for in the dashboard');
    // No job: the decision engine would only say "store it as it is", so the
    // worker must not be made to download a video-sized archive to find that out.
    assert.equal(record.processingStatus, 'COMPLETED');
    assert.equal(record.processingMethod, 'none');
    assert.equal(record.storedOriginal, true);

    const material = await models.File.findById(res.payload.data._id);
    assert.equal(material.attachments[0].storageRef, record.storageKey);

    await teardown(ctx);
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
});

test('the storage scope used for pipeline objects is consistent on the local provider', { skip }, async () => {
  const ctx = await setup();

  try {
    const storage = await import('../services/storage/storageService.js');
    const key = `scope-check/${Date.now()}.txt`;
    const { Readable } = await import('node:stream');

    // uploadStream writes under the public root; metadata and delete must resolve
    // there too. They previously defaulted to the PRIVATE root, which made the
    // pipeline's own verification report every optimized object as missing.
    await storage.uploadStream(key, Readable.from([Buffer.from('hello')]), 'text/plain', { contentLength: 5 });

    const meta = await storage.getObjectMetadata(key);
    assert.equal(meta.exists, true, 'a written object must be findable');
    assert.equal(meta.contentLength, 5);

    await storage.deleteObject(key);
    assert.equal(await storage.objectExists(key), false, 'and deletable');

    await teardown({ ...ctx, storageRoot });
  } catch (err) {
    await teardown({ ...ctx, storageRoot });
    throw err;
  }
});
