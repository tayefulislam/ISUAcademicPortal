import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertDesignation, cleanDesignation } from './designations.js';

// A faculty designation is admin-managed vocabulary that prints on documents, so
// this is the boundary that decides what a request may store.

const SETTINGS = { facultyDesignations: ['Lecturer', 'Assistant Professor', 'Professor'] };

describe('cleanDesignation', () => {
  test('trims and collapses whitespace, keeping the spelling', () => {
    assert.equal(cleanDesignation('  Assistant   Professor '), 'Assistant Professor');
    assert.equal(cleanDesignation(null), '');
    assert.equal(cleanDesignation(undefined), '');
  });
});

describe('assertDesignation', () => {
  test('an empty value clears the designation', () => {
    assert.equal(assertDesignation('', SETTINGS), '');
    assert.equal(assertDesignation(undefined, SETTINGS), '');
    assert.equal(assertDesignation('   ', SETTINGS), '');
  });

  test('a configured rank is accepted', () => {
    assert.equal(assertDesignation('Lecturer', SETTINGS), 'Lecturer');
    assert.equal(assertDesignation(' Professor ', SETTINGS), 'Professor');
  });

  test('the CONFIGURED spelling wins, so a client cannot lowercase a rank', () => {
    assert.equal(assertDesignation('assistant professor', SETTINGS), 'Assistant Professor');
    assert.equal(assertDesignation('LECTURER', SETTINGS), 'Lecturer');
  });

  test('anything not on the list is refused', () => {
    assert.throws(() => assertDesignation('Head of Department', SETTINGS), (err) => err.statusCode === 422);
    assert.throws(() => assertDesignation('Professor; drop table', SETTINGS), (err) => err.statusCode === 422);
  });

  test('with no list configured, only an empty value is allowed', () => {
    assert.equal(assertDesignation('', {}), '');
    assert.throws(() => assertDesignation('Professor', {}), (err) => err.statusCode === 422);
    assert.throws(() => assertDesignation('Professor', null), (err) => err.statusCode === 422);
  });
});
