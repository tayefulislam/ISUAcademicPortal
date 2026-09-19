import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../../test/dbTestUtils.js';
import { env } from '../../config/env.js';
import ApplicationExport from '../../models/ApplicationExport.js';
import { cleanupExpiredExports } from './exportService.js';

// The export sweep. It removes the temporary file of ANY export past its expiry
// that still claims one — including a row a late download request already
// flipped to EXPIRED — and the application is never touched by it.

const PAST = () => new Date(Date.now() - 60 * 1000);
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
const PRIVATE_ROOT = path.resolve(process.cwd(), 'private-uploads');

before(async () => {
  await connectTestDb('application-export-cleanup');
  // The delete dispatches on the configured provider; the local one is a plain
  // fs.rm, so the sweep is exercised end to end without any object storage.
  env.fileStorageProvider = 'local';
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(ApplicationExport);
});

/** A storageRef under private-uploads whose object really exists on disk. */
async function presentObject() {
  const rel = path.join(
    'application-exports',
    String(new mongoose.Types.ObjectId()),
    `${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
  );
  const abs = path.join(PRIVATE_ROOT, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, '%PDF-1.4');
  return { rel, abs };
}

async function exportRow({
  status = 'ACTIVE',
  expiresAt = PAST(),
  storageRef = '',
  deletedAt = null,
  storageDeletedAt = null,
} = {}) {
  return ApplicationExport.create({
    application: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    fileType: 'PDF',
    status,
    expiresAt,
    storageRef,
    deletedAt,
    storageDeletedAt,
  });
}

describe('cleanupExpiredExports', () => {
  test('an expired export loses its object and records the delete', async () => {
    const { rel, abs } = await presentObject();
    const row = await exportRow({ storageRef: rel });

    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 1);
    assert.equal(result.deferred, 0);

    const after = await ApplicationExport.findById(row._id);
    assert.equal(after.status, 'EXPIRED');
    assert.ok(after.storageDeletedAt);
    assert.ok(after.deletedAt);
    await assert.rejects(fs.access(abs), 'the file should be gone from storage');
  });

  test('a row a late download already marked EXPIRED still has its object removed', async () => {
    const { rel, abs } = await presentObject();
    const expiredAt = new Date(Date.now() - 5 * 60 * 1000);
    const row = await exportRow({ status: 'EXPIRED', deletedAt: expiredAt, storageRef: rel });

    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 1, 'an EXPIRED row must still be swept — status is not the marker');

    const after = await ApplicationExport.findById(row._id);
    assert.ok(after.storageDeletedAt);
    // The original "became unavailable" time is kept, not moved to the sweep's.
    assert.equal(after.deletedAt.getTime(), expiredAt.getTime());
    await assert.rejects(fs.access(abs));
  });

  test('a second sweep finds nothing — the cleanup is idempotent', async () => {
    const { rel } = await presentObject();
    await exportRow({ storageRef: rel });

    await cleanupExpiredExports();
    const second = await cleanupExpiredExports();
    assert.equal(second.cleaned, 0);
  });

  test('a row whose object was already removed is not touched again', async () => {
    await exportRow({ status: 'EXPIRED', storageRef: 'application-exports/x/y.pdf', storageDeletedAt: new Date() });
    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 0);
  });

  test('an export that has not expired is left alone', async () => {
    const { rel } = await presentObject();
    await exportRow({ expiresAt: FUTURE(), storageRef: rel });

    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 0);
    assert.equal(await ApplicationExport.countDocuments({ status: 'ACTIVE' }), 1);
  });

  test('a row with no stored key has nothing to delete', async () => {
    await exportRow({ storageRef: '' });
    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 0);
  });

  test('a failed delete is deferred and retried, never marked done', async () => {
    // Escapes the private root, so the strict delete throws.
    const row = await exportRow({ storageRef: path.join('..', 'escape.pdf') });

    const first = await cleanupExpiredExports();
    assert.equal(first.cleaned, 0);
    assert.equal(first.deferred, 1);
    assert.equal((await ApplicationExport.findById(row._id)).storageDeletedAt, null,
      'a record must never claim its file is gone while it is still there');

    // Still eligible on the next run rather than dropped.
    const again = await cleanupExpiredExports();
    assert.equal(again.deferred, 1);
  });
});
