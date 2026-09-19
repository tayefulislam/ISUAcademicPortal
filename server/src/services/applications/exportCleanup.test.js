import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../../test/dbTestUtils.js';
import ApplicationExport from '../../models/ApplicationExport.js';
import { cleanupExpiredExports } from './exportService.js';

// The hourly export sweep. The application is never touched by it — only the
// temporary file's record — and a second run must find nothing to do.

const PAST = () => new Date(Date.now() - 60 * 1000);
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);

before(async () => {
  await connectTestDb('application-export-cleanup');
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(ApplicationExport);
});

async function exportRow({ status = 'ACTIVE', expiresAt = PAST(), storageRef = '' } = {}) {
  return ApplicationExport.create({
    application: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    fileType: 'PDF',
    status,
    expiresAt,
    // Empty: the strict delete returns early, so no storage provider is needed.
    storageRef,
  });
}

describe('cleanupExpiredExports', () => {
  test('an expired export is marked EXPIRED and stamped', async () => {
    const row = await exportRow();

    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 1);
    assert.equal(result.deferred, 0);

    const after = await ApplicationExport.findById(row._id);
    assert.equal(after.status, 'EXPIRED');
    assert.ok(after.deletedAt);
  });

  test('a second sweep finds nothing — the cleanup is idempotent', async () => {
    await exportRow();
    await cleanupExpiredExports();
    const second = await cleanupExpiredExports();
    assert.equal(second.cleaned, 0);
  });

  test('an export that has not expired is left alone', async () => {
    await exportRow({ expiresAt: FUTURE() });
    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 0);
    assert.equal(await ApplicationExport.countDocuments({ status: 'ACTIVE' }), 1);
  });

  test('an already-expired record is not touched again', async () => {
    await exportRow({ status: 'EXPIRED' });
    const result = await cleanupExpiredExports();
    assert.equal(result.cleaned, 0);
  });
});
