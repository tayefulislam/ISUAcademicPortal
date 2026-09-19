import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApplicationHtml } from './applicationHtml.js';
import { profileRows, signatureRows } from './profileSnapshot.js';

// The letter that is printed. Everything that reaches it is escaped, and the
// wording comes from the recipient/type — never from the AI.

const APPLICATION = {
  subject: 'Application for 50% Tuition Fee Reduction',
  editedContent: 'I am facing financial difficulties.\n\nI request a 50% reduction.',
  recipient: {
    name: 'The Registrar',
    designation: 'Registrar',
    office: 'Office of the Registrar',
    address: 'ISU Campus',
    letterhead: { universityName: 'International Standard University', addressLine: 'Dhaka, Bangladesh', footer: '' },
  },
  profileSnapshot: {
    name: 'Kazi Tayeful Islam',
    studentId: '123456',
    department: 'Computer Science & Engineering',
    batch: 'BATCH-14',
    semester: '6th Semester',
  },
};

describe('buildApplicationHtml', () => {
  test('includes the recipient block, subject, body and signature', () => {
    const html = buildApplicationHtml({ application: APPLICATION });
    assert.ok(html.includes('The Registrar'));
    assert.ok(html.includes('Office of the Registrar'));
    assert.ok(html.includes('Subject: Application for 50% Tuition Fee Reduction'));
    assert.ok(html.includes('I am facing financial difficulties.'));
    assert.ok(html.includes('Kazi Tayeful Islam'));
    assert.ok(html.includes('Student ID: 123456'));
    assert.ok(html.includes('International Standard University'));
  });

  test('escapes everything a user could type', () => {
    const html = buildApplicationHtml({
      application: {
        ...APPLICATION,
        subject: '<script>alert(1)</script>',
        editedContent: '<img src=x onerror=alert(2)>',
      },
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('a type template supplies the salutation and closing', () => {
    const html = buildApplicationHtml({
      application: APPLICATION,
      typeTemplate: { salutation: 'Dear Sir,', closing: 'Thank you.' },
    });
    assert.ok(html.includes('Dear Sir,'));
    assert.ok(html.includes('Thank you.'));
  });

  test('the signature block carries identity only — never section, email or phone', () => {
    const html = buildApplicationHtml({
      application: {
        ...APPLICATION,
        profileSnapshot: {
          ...APPLICATION.profileSnapshot,
          group: 'A2',
          email: 'student@example.com',
          phone: '01724364698',
        },
      },
    });
    assert.ok(html.includes('Batch: BATCH-14'));
    assert.ok(!html.includes('Section: A2'));
    assert.ok(!html.includes('Email: student@example.com'));
    assert.ok(!html.includes('Phone: 01724364698'));
    // The letterhead still carries the university name and its rule.
    assert.ok(html.includes('International Standard University'));
    assert.ok(html.includes('<div class="rule"></div>'));
  });

  test('never emits a date the caller did not supply', () => {
    const html = buildApplicationHtml({ application: { ...APPLICATION, editedContent: 'Body' }, now: new Date('2026-09-19T00:00:00Z') });
    assert.ok(html.includes('19 September 2026'));
  });
});

describe('profileRows', () => {
  test('omits every field the record does not actually have', () => {
    const rows = profileRows({ name: 'A', email: 'a@x.com' });
    const labels = rows.map((r) => r.label);
    assert.deepEqual(labels, ['Name', 'Email']);
    // No "Program"/"Section" invented from nothing.
    assert.ok(!labels.includes('Program'));
    assert.ok(!labels.includes('Section'));
  });

  test('includes a section only when the group is not BOTH', () => {
    assert.ok(!profileRows({ name: 'A', group: 'BOTH' }).some((r) => r.label === 'Section'));
    assert.ok(profileRows({ name: 'A', group: 'A1' }).some((r) => r.label === 'Section'));
  });
});

describe('signatureRows', () => {
  test('signs off with identity only — no section, email or phone', () => {
    const rows = signatureRows({
      name: 'Kazi Tayeful Islam',
      studentId: '123456',
      department: 'Computer Science & Engineering',
      batch: 'BATCH-14',
      semester: '2nd Semester',
      group: 'A2',
      email: 'student@example.com',
      phone: '01724364698',
    });
    assert.deepEqual(rows.map((r) => r.label),
      ['Name', 'Student ID', 'Department', 'Batch', 'Semester']);
  });

  test('omits values the profile does not have', () => {
    assert.deepEqual(signatureRows({ name: 'A' }).map((r) => r.label), ['Name']);
    assert.deepEqual(signatureRows(null), []);
  });
});
