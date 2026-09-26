import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The DB-free half of the record bridge: the dispatch contract.
 *
 * The per-kind apply handlers need a database and are exercised end-to-end by
 * the material-optimization integration test. What CAN be pinned without one is
 * the contract every handler must honour and the default that keeps a standalone
 * upload working: a missing key is never reported as a successful repoint, and a
 * standalone file — which nothing else references — needs no repoint at all.
 */

const { applyOptimizedRecord, recordDomainOptimization } = await import('./recordBridge.js');

test('a missing storage key is never reported as a successful repoint', async () => {
  const record = { source: { kind: 'material' }, storageProvider: 's3' };
  // Nothing to point at: the caller must keep the original, not delete it.
  assert.equal(await applyOptimizedRecord(record, { storageKey: '' }), false);
  assert.equal(await applyOptimizedRecord(null, { storageKey: 'k' }), false);
});

test('a standalone file needs no repoint', async () => {
  const record = { source: { kind: 'standalone' }, storageProvider: 's3' };
  // The upload screen's own file is referenced by nothing, so "success" is the
  // correct answer without touching the database.
  assert.equal(await applyOptimizedRecord(record, { storageKey: 'uploads/x.png' }), true);
});

test('an absent source is treated as standalone', async () => {
  assert.equal(await applyOptimizedRecord({}, { storageKey: 'uploads/x.png' }), true);
});

test('recording optimization is a no-op without a record id', async () => {
  // Without an owner record there is nothing to repoint later, so nothing is
  // queued — and this returns the zero summary without a database.
  const result = await recordDomainOptimization({ ownerId: 'u1', kind: 'notice', recordId: null, items: [{ storageRef: 'k' }] });
  assert.deepEqual(result, { queued: 0, recorded: 0, skipped: 0 });
});
