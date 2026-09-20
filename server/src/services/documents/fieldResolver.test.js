import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderData, applyFormatting, formatDateValue, validateFieldValue } from './fieldResolver.js';

const CONTEXT = {
  'student.name': 'Rahim Uddin',
  'student.studentId': '2210000000000001',
  'student.batch': 'BATCH-15',
  'student.group': 'A1',
  'course.code': 'EEE 2103',
  'course.name': 'Electrical Circuits',
  'faculty.name': 'Dr. Hasan',
};

function assertApiError(fn, status = 422) {
  assert.throws(fn, (err) => err.statusCode === status);
}

describe('buildRenderData — official values are locked', () => {
  test('an AUTO field takes its value from the context, never from inputData', () => {
    const { values, resolved } = buildRenderData({
      fields: [{ key: 'student_name', type: 'AUTO', source: 'student.name' }],
      context: CONTEXT,
      // A student trying to rename themselves. It must be ignored outright.
      inputData: { student_name: 'Someone Else' },
    });
    assert.equal(values.student_name, 'Rahim Uddin');
    assert.deepEqual(resolved.student_name, { type: 'AUTO', source: 'student.name', value: 'Rahim Uddin' });
  });

  test('every official source resolves from context and ignores inputData', () => {
    const fields = [
      { key: 'name', type: 'AUTO', source: 'student.name' },
      { key: 'id', type: 'AUTO', source: 'student.studentId' },
      { key: 'batch', type: 'AUTO', source: 'student.batch' },
      { key: 'course', type: 'AUTO', source: 'course.code' },
      { key: 'teacher', type: 'AUTO', source: 'faculty.name' },
    ];
    const forged = Object.fromEntries(fields.map((f) => [f.key, 'FORGED']));
    const { values } = buildRenderData({ fields, context: CONTEXT, inputData: forged });
    assert.equal(values.name, 'Rahim Uddin');
    assert.equal(values.id, '2210000000000001');
    assert.equal(values.batch, 'BATCH-15');
    assert.equal(values.course, 'EEE 2103');
    assert.equal(values.teacher, 'Dr. Hasan');
  });

  test('an AUTO field with a source missing from the context renders empty', () => {
    const { values } = buildRenderData({
      fields: [{ key: 'dept', type: 'AUTO', source: 'department.name' }],
      context: CONTEXT,
    });
    assert.equal(values.dept, '');
  });

  test('a STATIC field prints its fixed text and is not editable', () => {
    const { values } = buildRenderData({
      fields: [{ key: 'univ', type: 'STATIC', staticValue: 'International Standard University' }],
      inputData: { univ: 'Hacked University' },
    });
    assert.equal(values.univ, 'International Standard University');
  });
});

describe('buildRenderData — editable values', () => {
  const field = { key: 'experiment_no', label: 'Experiment No', type: 'USER_INPUT' };

  test('reads the submitted value', () => {
    const { values } = buildRenderData({ fields: [field], inputData: { experiment_no: '  07  ' } });
    assert.equal(values.experiment_no, '07');
  });

  test('falls back to the default when nothing was submitted', () => {
    const withDefault = { ...field, defaultValue: 'N/A' };
    assert.equal(buildRenderData({ fields: [withDefault], inputData: {} }).values.experiment_no, 'N/A');
    assert.equal(buildRenderData({ fields: [withDefault], inputData: { experiment_no: '' } }).values.experiment_no, 'N/A');
  });

  test('a required field with no value is a 422', () => {
    assertApiError(() => buildRenderData({
      fields: [{ ...field, required: true }],
      inputData: {},
    }));
  });

  test('maxLength truncates', () => {
    const { values } = buildRenderData({
      fields: [{ ...field, validation: { maxLength: 3 } }],
      inputData: { experiment_no: 'abcdef' },
    });
    assert.equal(values.experiment_no, 'abc');
  });

  test('a NUMBER field rejects non-numbers and enforces min/max', () => {
    const numberField = { key: 'n', label: 'No', type: 'NUMBER' };
    assert.equal(buildRenderData({ fields: [numberField], inputData: { n: '12' } }).values.n, '12');
    assertApiError(() => buildRenderData({ fields: [numberField], inputData: { n: 'twelve' } }));
    assertApiError(() => buildRenderData({
      fields: [{ ...numberField, validation: { min: 1, max: 5 } }],
      inputData: { n: '9' },
    }));
  });

  test('a DATE field rejects anything but yyyy-mm-dd', () => {
    const dateField = { key: 'd', label: 'Date', type: 'DATE' };
    assert.equal(buildRenderData({ fields: [dateField], inputData: { d: '2026-09-20' } }).values.d, '2026-09-20');
    assertApiError(() => buildRenderData({ fields: [dateField], inputData: { d: '20/09/2026' } }));
  });

  test('a regex rule is enforced, and a malformed rule is ignored rather than fatal', () => {
    assertApiError(() => buildRenderData({
      fields: [{ key: 'x', label: 'X', type: 'TEXT', validation: { regex: '^[0-9]+$' } }],
      inputData: { x: 'abc' },
    }));
    // An admin typing an invalid pattern must not make every generation fail.
    assert.equal(
      buildRenderData({
        fields: [{ key: 'x', label: 'X', type: 'TEXT', validation: { regex: '([' } }],
        inputData: { x: 'abc' },
      }).values.x,
      'abc'
    );
  });

  test('undeclared input keys are ignored (only fields produce values)', () => {
    const { values } = buildRenderData({
      fields: [field],
      inputData: { experiment_no: '07', __proto__: 'x', evil: 'y' },
    });
    assert.deepEqual(Object.keys(values), ['experiment_no']);
  });
});

describe('formatting', () => {
  test('prefix, suffix and uppercase', () => {
    assert.equal(applyFormatting('07', { prefix: 'No. ', suffix: '!' }), 'No. 07!');
    assert.equal(applyFormatting('abc', { uppercase: true }), 'ABC');
  });

  test('the common date formats', () => {
    assert.equal(formatDateValue('2026-09-20', 'DD/MM/YYYY'), '20/09/2026');
    assert.equal(formatDateValue('2026-09-20', 'DD MMM YYYY'), '20 Sep 2026');
    assert.equal(formatDateValue('2026-09-20', 'MMMM D, YYYY'), 'September 20, 2026');
    assert.equal(formatDateValue('2026-09-20', ''), '2026-09-20');
    assert.equal(formatDateValue('', 'DD/MM/YYYY'), '');
  });
});

describe('validateFieldValue', () => {
  test('a required field with an empty value throws', () => {
    assertApiError(() => validateFieldValue({ label: 'Name', required: true }, ''));
  });

  test('an optional empty field is fine', () => {
    assert.doesNotThrow(() => validateFieldValue({ label: 'Name' }, ''));
  });
});

describe('buildRenderData — table elements', () => {
  const table = {
    key: 'info',
    type: 'TABLE',
    table: {
      rows: 2,
      cols: 2,
      cells: ['Name', 'ID', '', ''],
      // The second row is bound to official sources, so a table can print real
      // record data without the student being able to type it.
      cellSources: ['', '', 'student.name', 'student.studentId'],
    },
  };

  test('resolves a row-major grid, official sources included', () => {
    const { values, resolved } = buildRenderData({ fields: [table], context: CONTEXT, inputData: {} });
    assert.deepEqual(resolved.info.value, [['Name', 'ID'], ['Rahim Uddin', '2210000000000001']]);
    assert.deepEqual(JSON.parse(values.info), [['Name', 'ID'], ['Rahim Uddin', '2210000000000001']]);
  });

  test('a student cannot supply a cell value through inputData', () => {
    const { resolved } = buildRenderData({
      fields: [table],
      context: CONTEXT,
      inputData: { info: 'FORGED', 'student.name': 'Someone Else' },
    });
    assert.deepEqual(resolved.info.value[1], ['Rahim Uddin', '2210000000000001']);
  });

  test('an unknown cell source is ignored and the typed text prints instead', () => {
    const { resolved } = buildRenderData({
      fields: [{ key: 't', type: 'TABLE', table: { rows: 1, cols: 1, cells: ['Kept'], cellSources: ['student.password'] } }],
      context: CONTEXT,
      inputData: {},
    });
    assert.deepEqual(resolved.t.value, [['Kept']]);
  });
});
