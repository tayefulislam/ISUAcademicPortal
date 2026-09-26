import test from 'node:test';
import assert from 'node:assert/strict';
import { fileJobId, FILE_CLEANUP_SCHEDULE_ID, FILE_QUEUE_NAME } from './fileProcessingQueue.js';

/**
 * The queue's custom ids.
 *
 * <p>Pinned because getting one wrong is invisible in a way that matters: BullMQ
 * throws `Custom Id cannot contain :` from `add()`, the caller treats that as
 * "the queue is unavailable", the upload still succeeds — and the file is simply
 * never optimized. That was a real bug here (`upload:${fileId}`), found only by
 * running the enqueue against a real BullMQ.
 */

test('a file job id is stable, unique per file, and colon-free', () => {
  const id = fileJobId('64abc123');

  // Stable: re-enqueueing a retry must upsert the pending job, not add a second.
  assert.equal(id, fileJobId('64abc123'));
  // Unique: two different files must not share a job.
  assert.notEqual(id, fileJobId('64abc124'));
  // Colon-free: BullMQ refuses a colon in a custom id, and refuses it by throwing.
  assert.equal(id.includes(':'), false, `BullMQ rejects a colon in a job id: ${id}`);
});

test('the repeatable scheduler id is colon-free too', () => {
  assert.equal(FILE_CLEANUP_SCHEDULE_ID.includes(':'), false);
});

test('the queue name is colon-free — BullMQ uses it as a Redis key prefix', () => {
  assert.equal(FILE_QUEUE_NAME.includes(':'), false);
});
