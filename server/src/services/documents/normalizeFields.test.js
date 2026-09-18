import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFields } from './normalizeFields.js';

function expectApiError(fn, status = 422) {
  assert.throws(fn, (err) => err.statusCode === status);
}

describe('normalizeFields — shape', () => {
  test('empty input is an empty list', () => {
    assert.deepEqual(normalizeFields(null), []);
    assert.deepEqual(normalizeFields(''), []);
    assert.deepEqual(normalizeFields([]), []);
  });

  test('accepts a JSON string (a multipart field) as well as an array', () => {
    const fields = normalizeFields(JSON.stringify([{ key: 'a', label: 'A', type: 'TEXT' }]));
    assert.equal(fields.length, 1);
    assert.equal(fields[0].key, 'a');
  });

  test('malformed JSON is a 422, not a crash', () => {
    expectApiError(() => normalizeFields('{not json'));
  });

  test('a non-array is rejected', () => {
    expectApiError(() => normalizeFields({ key: 'a' }));
  });

  test('caps the number of fields', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'TEXT' }));
    expectApiError(() => normalizeFields(many));
  });
});

describe('normalizeFields — keys and types', () => {
  test('a key must be a safe identifier', () => {
    expectApiError(() => normalizeFields([{ key: 'Student Name', label: 'X', type: 'TEXT' }]));
    expectApiError(() => normalizeFields([{ key: '', label: 'X', type: 'TEXT' }]));
    assert.equal(normalizeFields([{ key: 'Student_Name', label: 'X', type: 'TEXT' }])[0].key, 'student_name');
  });

  test('duplicate keys are rejected', () => {
    expectApiError(() => normalizeFields([
      { key: 'a', label: 'A', type: 'TEXT' },
      { key: 'a', label: 'A again', type: 'TEXT' },
    ]));
  });

  test('an unknown type falls back to USER_INPUT', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'WAT' }])[0].type, 'USER_INPUT');
  });
});

describe('normalizeFields — editable is derived, never supplied', () => {
  test('an AUTO field can never be marked editable by the request', () => {
    const [field] = normalizeFields([{
      key: 'student_name', label: 'Student Name', type: 'AUTO', source: 'student.name', editable: true,
    }]);
    assert.equal(field.editable, false);
  });

  test('an editable type is editable', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT' }])[0].editable, true);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'DATE' }])[0].editable, true);
  });

  test('a STATIC field is not editable', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'STATIC', staticValue: 'x' }])[0].editable, false);
  });
});

describe('normalizeFields — sources', () => {
  test('an AUTO field with no/unknown source is rejected at save time', () => {
    expectApiError(() => normalizeFields([{ key: 'a', label: 'A', type: 'AUTO' }]));
    expectApiError(() => normalizeFields([{ key: 'a', label: 'A', type: 'AUTO', source: 'student.password' }]));
  });

  test('a whitelisted source is kept', () => {
    assert.equal(
      normalizeFields([{ key: 'a', label: 'A', type: 'AUTO', source: 'course.code' }])[0].source,
      'course.code'
    );
  });
});

describe('normalizeFields — geometry and validation bounds', () => {
  test('coordinates are clamped and font size bounded', () => {
    const [field] = normalizeFields([{
      key: 'a', label: 'A', type: 'TEXT', x: -50, y: 9999, width: 9999, fontSize: 400,
    }]);
    assert.equal(field.x, 0);
    assert.equal(field.y, 600);
    assert.equal(field.width, 400);
    assert.equal(field.fontSize, 96);
  });

  test('an invalid colour and alignment fall back', () => {
    const [field] = normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', color: 'red;}', align: 'justify' }]);
    assert.equal(field.color, '#111111');
    assert.equal(field.align, 'left');
  });

  test('a malformed validation regex is rejected at save time', () => {
    expectApiError(() => normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', validation: { regex: '([' } }]));
  });

  test('a rule keeps a sub-millimetre thickness, while a text box keeps its floor', () => {
    // `height` means thickness for a LINE and box height for everything else.
    assert.equal(normalizeFields([{ key: 'r', label: 'Rule', type: 'LINE', height: 0.5 }])[0].height, 0.5);
    assert.equal(normalizeFields([{ key: 't', label: 'Text', type: 'STATIC', height: 0.5 }])[0].height, 2);
    // A rule can never become a bar, nor collapse to nothing.
    assert.equal(normalizeFields([{ key: 'r', label: 'Rule', type: 'LINE', height: 99 }])[0].height, 5);
    assert.equal(normalizeFields([{ key: 'r', label: 'Rule', type: 'LINE', height: 0 }])[0].height, 0.1);
  });

  test('an image element keeps only a real file name for its asset', () => {
    assert.equal(normalizeFields([{ key: 'l', label: 'Logo', type: 'IMAGE', asset: 'logo.png' }])[0].asset, 'logo.png');
    // A path, a traversal, or a non-image is dropped rather than stored.
    assert.equal(normalizeFields([{ key: 'l', label: 'Logo', type: 'IMAGE', asset: '../secret.png' }])[0].asset, '');
    assert.equal(normalizeFields([{ key: 'l', label: 'Logo', type: 'IMAGE', asset: 'evil.exe' }])[0].asset, '');
  });

  test('z-order is kept and bounded', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', zIndex: 7 }])[0].zIndex, 7);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', zIndex: 100000 }])[0].zIndex, 999);
  });

  test('a valid regex and numeric bounds are kept', () => {
    const [field] = normalizeFields([{
      key: 'a', label: 'A', type: 'NUMBER', validation: { regex: '^[0-9]+$', min: 1, max: 10, maxLength: 3 },
    }]);
    assert.equal(field.validation.regex, '^[0-9]+$');
    assert.equal(field.validation.min, 1);
    assert.equal(field.validation.max, 10);
    assert.equal(field.validation.maxLength, 3);
  });
});
