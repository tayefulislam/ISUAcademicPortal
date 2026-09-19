import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickFaculty, removeDocumentStorageThenRow, documentFileName } from './documentService.js';

// The teacher is the one official value a student chooses, so this is the
// boundary that decides whether the choice is acceptable. A client may pick a
// teacher; it may never invent one.

const OPTIONS = [
  { _id: 'aaa', name: 'Dr. A' },
  { _id: 'bbb', name: 'Dr. B' },
];

describe('pickFaculty', () => {
  test('with no options and no choice, there is nothing to print', () => {
    assert.equal(pickFaculty([], null), null);
  });

  test('with no options, a choice is refused (nothing to validate it against)', () => {
    assert.throws(() => pickFaculty([], 'aaa'), (err) => err.statusCode === 422);
  });

  test('with no choice, the first teacher is used (single-teacher courses need no interaction)', () => {
    assert.equal(pickFaculty(OPTIONS, null)._id, 'aaa');
  });

  test('a choice on the list is honoured — this is the fix', () => {
    assert.equal(pickFaculty(OPTIONS, 'bbb').name, 'Dr. B');
  });

  test('a choice NOT on the list is refused, so a name can never be forged', () => {
    assert.throws(() => pickFaculty(OPTIONS, 'someone-else'), (err) => err.statusCode === 422);
  });

  test('an ObjectId-shaped string is still compared as a string', () => {
    const options = [{ _id: '68a1b2c3d4e5f60718293a4b', name: 'Dr. C' }];
    assert.equal(pickFaculty(options, '68a1b2c3d4e5f60718293a4b').name, 'Dr. C');
  });
});

// Deleting a document must free the object before it drops the row that names
// it — the order is the whole point, so it is asserted here.
describe('removeDocumentStorageThenRow', () => {
  test('removes the stored object before the row', async () => {
    const order = [];
    await removeDocumentStorageThenRow(
      { _id: 'job-1', s3Key: 'generated-documents/2026/01/u/j.pdf' },
      {
        removeStored: async (key) => { order.push(`store:${key}`); },
        removeRow: async (id) => { order.push(`row:${id}`); },
      }
    );
    assert.deepEqual(order, [
      'store:generated-documents/2026/01/u/j.pdf',
      'row:job-1',
    ]);
  });

  test('a document with no stored object still has its row removed', async () => {
    const order = [];
    await removeDocumentStorageThenRow(
      { _id: 'job-2', s3Key: '' },
      {
        removeStored: async () => { order.push('store'); },
        removeRow: async () => { order.push('row'); },
      }
    );
    assert.deepEqual(order, ['row']);
  });
});

// The downloaded PDF is named `Course Name - Course ID - Student Name -
// Student ID - <random>`.
describe('documentFileName', () => {
  test('names the file after the course and the student', () => {
    const name = documentFileName(
      { name: 'Rahim Uddin', rollNo: 'CSE-001' },
      { name: 'Structured Programming Language', courseId: 'CSE06131103' }
    );
    assert.match(name, /^Structured Programming Language - CSE06131103 - Rahim Uddin - CSE-001 - \d{6}\.pdf$/);
  });

  test('two documents never share a name', () => {
    const args = [{ name: 'Rahim', rollNo: 'CSE-001' }, { name: 'SPL', courseId: 'CSE06131103' }];
    assert.notEqual(documentFileName(...args), documentFileName(...args));
  });

  test('folds characters a file name cannot carry', () => {
    const name = documentFileName({ name: 'A/B', rollNo: 'x:1' }, { name: 'C?D', courseId: 'E*1' });
    assert.doesNotMatch(name, /[\\/:*?"<>|]/);
    assert.match(name, /\.pdf$/);
  });

  test('still produces a name when there is no course', () => {
    const name = documentFileName({ name: 'Rahim', rollNo: 'CSE-001' }, null);
    assert.match(name, /^Rahim - CSE-001 - \d{6}\.pdf$/);
  });
});
