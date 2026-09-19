import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickFaculty } from './documentService.js';

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
