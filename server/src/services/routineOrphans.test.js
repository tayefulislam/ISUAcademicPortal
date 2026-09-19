import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isOrphanRoutine } from './routineOrphans.js';

// The rule that decides which routine rows are wreckage: a course or department
// that no longer resolves (a re-created course/department), or an occurrence
// whose rule is gone. Getting this wrong either leaves broken rows behind or
// deletes healthy ones.
const SETS = {
  courses: new Set(['c1']),
  departments: new Set(['d1']),
  templates: new Set(['t1']),
};

describe('isOrphanRoutine', () => {
  test('a rule whose course and department both resolve is healthy', () => {
    assert.equal(isOrphanRoutine({ course: 'c1', department: 'd1' }, SETS), false);
  });

  test('a course that no longer exists is an orphan', () => {
    assert.equal(isOrphanRoutine({ course: 'gone', department: 'd1' }, SETS), true);
  });

  test('a department that no longer exists is an orphan', () => {
    assert.equal(isOrphanRoutine({ course: 'c1', department: 'gone' }, SETS), true);
  });

  test('an occurrence whose rule is gone is an orphan even with a live course', () => {
    assert.equal(isOrphanRoutine({ course: 'c1', department: 'd1', template: 'gone' }, SETS), true);
    assert.equal(isOrphanRoutine({ course: 'c1', department: 'd1', template: 't1' }, SETS), false);
  });

  test('a rule has no template field, so that check is skipped for it', () => {
    assert.equal(isOrphanRoutine({ course: 'c1', department: 'd1', template: undefined }, SETS), false);
  });
});
