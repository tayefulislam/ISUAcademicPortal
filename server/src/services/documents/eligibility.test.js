import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isTemplateEligible, filterEligibleTemplates, effectiveAudience } from './eligibility.js';

// A template as the API stores it. `departmentIds`/`courseId` are the only
// eligibility axes; status and availableFor gate on their own.
function template(overrides = {}) {
  return {
    status: 'ACTIVE',
    availableFor: ['student'],
    departmentIds: [],
    courseId: null,
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    audience: 'student',
    departmentIds: new Set(['cse']),
    courseIds: new Set(['cse101']),
    ...overrides,
  };
}

describe('effectiveAudience', () => {
  test('maps the fixed roles and treats a custom admin-tier role as staff', () => {
    assert.equal(effectiveAudience({ role: 'student' }), 'student');
    assert.equal(effectiveAudience({ role: 'faculty' }), 'faculty');
    assert.equal(effectiveAudience({ role: 'admin' }), 'staff');
    assert.equal(effectiveAudience({ role: 'super_admin' }), 'staff');
    assert.equal(effectiveAudience({ role: 'administrator' }), 'staff');
    // A "CR" has no fixed role, only a Role document — the caller tells us.
    assert.equal(effectiveAudience({ role: 'cr' }, { isAdminTierRole: true }), 'staff');
    // Without that hint it falls back to student, which is the safe default.
    assert.equal(effectiveAudience({ role: 'cr' }), 'student');
  });
});

describe('isTemplateEligible — status and audience', () => {
  test('only an ACTIVE template is offered', () => {
    assert.equal(isTemplateEligible(template(), ctx()), true);
    assert.equal(isTemplateEligible(template({ status: 'DRAFT' }), ctx()), false);
    assert.equal(isTemplateEligible(template({ status: 'INACTIVE' }), ctx()), false);
  });

  test('a student-only template is not offered to faculty and vice versa', () => {
    assert.equal(isTemplateEligible(template({ availableFor: ['student'] }), ctx({ audience: 'faculty' })), false);
    assert.equal(
      isTemplateEligible(template({ availableFor: ['faculty'] }), ctx({ audience: 'faculty' })),
      true
    );
  });
});

describe('isTemplateEligible — department scope', () => {
  test('an empty department list means All Departments', () => {
    assert.equal(isTemplateEligible(template({ departmentIds: [] }), ctx({ departmentIds: new Set() })), true);
  });

  test('a specific department only matches that department', () => {
    const t = template({ departmentIds: ['eee'] });
    assert.equal(isTemplateEligible(t, ctx({ departmentIds: new Set(['eee']) })), true);
    assert.equal(isTemplateEligible(t, ctx({ departmentIds: new Set(['cse']) })), false);
    assert.equal(isTemplateEligible(t, ctx({ departmentIds: new Set() })), false);
  });

  test('multiple departments match any one of them', () => {
    const t = template({ departmentIds: ['eee', 'physics'] });
    assert.equal(isTemplateEligible(t, ctx({ departmentIds: new Set(['physics']) })), true);
    assert.equal(isTemplateEligible(t, ctx({ departmentIds: new Set(['cse']) })), false);
  });
});

describe('isTemplateEligible — course scope', () => {
  test('a null courseId means every reachable course', () => {
    assert.equal(isTemplateEligible(template({ courseId: null }), ctx({ courseIds: new Set() })), true);
  });

  test('a course-specific template needs that course to be reachable', () => {
    const t = template({ courseId: 'eee2103' });
    assert.equal(isTemplateEligible(t, ctx({ courseIds: new Set(['eee2103']) })), true);
    assert.equal(isTemplateEligible(t, ctx({ courseIds: new Set(['cse101']) })), false);
  });

  test('a populated course ref is read by its id', () => {
    const t = template({ courseId: { _id: 'eee2103' } });
    assert.equal(isTemplateEligible(t, ctx({ courseIds: new Set(['eee2103']) })), true);
  });
});

describe('isTemplateEligible — staff', () => {
  test('staff preview every active template regardless of scope', () => {
    const restricted = template({ departmentIds: ['eee'], courseId: 'eee2103', availableFor: ['student'] });
    assert.equal(isTemplateEligible(restricted, { audience: 'staff' }), true);
    assert.equal(isTemplateEligible(template({ status: 'DRAFT' }), { audience: 'staff' }), false);
  });
});

describe('filterEligibleTemplates', () => {
  test('keeps only the eligible ones and tolerates null', () => {
    const list = [
      template({ name: 'all' }),
      template({ name: 'eee', departmentIds: ['eee'] }),
      template({ name: 'draft', status: 'DRAFT' }),
    ];
    const kept = filterEligibleTemplates(list, ctx({ departmentIds: new Set(['cse']) }));
    assert.deepEqual(kept.map((t) => t.name), ['all']);
    assert.deepEqual(filterEligibleTemplates(null, ctx()), []);
  });
});
