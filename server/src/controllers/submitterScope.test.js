import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionScope } from './fileController.js';

/**
 * What a Student/CR submission is filed under.
 *
 * <p>These are the rules that make "the batch and semester come from the
 * submitter's profile" true rather than merely displayed — the clients no longer
 * send either field, and a crafted request cannot set them. Worth pinning here,
 * without a database, because getting it wrong files a student's material under
 * a cohort they are not in.
 */

const COURSE = { department: 'dept-cse' };
const OWN_BATCH = { _id: 'batch-55', code: 'BATCH-55', department: 'dept-cse' };
const OTHER_DEPT_BATCH = { _id: 'batch-9', code: 'BATCH-9', department: 'dept-eee' };

test("a matching batch becomes the submission's own batch", () => {
  const scope = submissionScope(OWN_BATCH, { name: '3rd Semester' }, COURSE);
  assert.deepEqual(scope.batchIds, ['batch-55']);
  assert.deepEqual(scope.batchCodes, ['BATCH-55']);
  assert.equal(scope.allBatches, false);
  assert.equal(scope.semester, '3rd Semester');
});

test("a batch from another department is dropped, not an error", () => {
  // The student is legitimately enrolled in a course from another department
  // (an approved retake). Their own batch is real, but it is not a batch of that
  // course — so the submission carries no batch targeting rather than failing.
  const scope = submissionScope(OTHER_DEPT_BATCH, { name: '1st Semester' }, COURSE);
  assert.deepEqual(scope.batchIds, []);
  assert.deepEqual(scope.batchCodes, []);
  assert.equal(scope.allBatches, false);
  // The semester is unaffected: it is the submitter's own regardless of the course.
  assert.equal(scope.semester, '1st Semester');
});

test('no batch on the profile leaves no batch targeting', () => {
  const scope = submissionScope(null, null, COURSE);
  assert.deepEqual(scope.batchIds, []);
  assert.deepEqual(scope.batchCodes, []);
  assert.equal(scope.allBatches, false);
  assert.equal(scope.semester, '');
});

test('a course with no department matches no batch', () => {
  // Guards the comparison itself: String(undefined) must not accidentally equal
  // a batch whose department is also missing.
  assert.deepEqual(submissionScope({ _id: 'b', code: 'B', department: null }, null, {}).batchIds, []);
  assert.deepEqual(submissionScope({ _id: 'b', code: 'B', department: null }, null, { department: null }).batchIds, []);
});

test('a semester with no name is ignored rather than stored as blank', () => {
  assert.equal(submissionScope(null, { name: '' }, COURSE).semester, '');
  assert.equal(submissionScope(null, { name: null }, COURSE).semester, '');
});

test('the batch is compared by value, not identity', () => {
  // The ids come back from Mongo as different object types on different paths
  // (an ObjectId here, a string there), so the comparison must not be ===.
  const scope = submissionScope(
    { _id: 'batch-55', code: 'BATCH-55', department: { toString: () => 'dept-cse' } },
    null,
    { department: 'dept-cse' }
  );
  assert.deepEqual(scope.batchIds, ['batch-55']);
  assert.deepEqual(scope.batchCodes, ['BATCH-55']);
});

test('allBatches is never turned on by this rule', () => {
  // "All batches" is the ABSENCE of a batch, not a flag this derivation sets —
  // a student cannot widen their own submission to the whole department.
  for (const batch of [null, OWN_BATCH, OTHER_DEPT_BATCH]) {
    assert.equal(submissionScope(batch, null, COURSE).allBatches, false);
  }
});
