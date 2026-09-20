import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFields, normalizeStyleConfig } from './normalizeFields.js';

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
});

describe('normalizeFields — Word-like styling', () => {
  test('text decoration flags are kept', () => {
    const [field] = normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', bold: true, italic: true, underline: true, strikethrough: true }]);
    assert.equal(field.bold, true);
    assert.equal(field.italic, true);
    assert.equal(field.underline, true);
    assert.equal(field.strikethrough, true);
  });

  test('line height and character spacing are bounded', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', lineHeight: 9 }])[0].lineHeight, 3);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', lineHeight: 0 }])[0].lineHeight, 0.8);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', letterSpacing: -9 }])[0].letterSpacing, -2);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', letterSpacing: 99 }])[0].letterSpacing, 10);
  });

  test('a highlight must be a real colour, and "none" is empty', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', backgroundColor: '#fff3bf' }])[0].backgroundColor, '#fff3bf');
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', backgroundColor: 'red;}bad' }])[0].backgroundColor, '');
  });

  test('border width, style and radius are validated', () => {
    const [field] = normalizeFields([{
      key: 'a', label: 'A', type: 'TEXT', borderWidth: 99, borderStyle: 'wavy', borderColor: '#dc2626', borderRadius: -5,
    }]);
    assert.equal(field.borderWidth, 5);
    assert.equal(field.borderStyle, 'solid'); // unknown style falls back
    assert.equal(field.borderColor, '#dc2626');
    assert.equal(field.borderRadius, 0);
  });

  test('an explicit "none" border style is preserved', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', borderWidth: 1, borderStyle: 'none' }])[0].borderStyle, 'none');
  });

  test('an element can be locked', () => {
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT', locked: true }])[0].locked, true);
    assert.equal(normalizeFields([{ key: 'a', label: 'A', type: 'TEXT' }])[0].locked, false);
  });
});

describe('normalizeStyleConfig — the page defaults', () => {
  test('defaults when nothing is supplied', () => {
    assert.deepEqual(normalizeStyleConfig(undefined), { fontFamily: '', baseFontSize: 12, textColor: '#111111' });
    assert.deepEqual(normalizeStyleConfig(''), { fontFamily: '', baseFontSize: 12, textColor: '#111111' });
  });

  test('accepts an object or a JSON string (a multipart field)', () => {
    const fromObject = normalizeStyleConfig({ fontFamily: 'Georgia, serif', baseFontSize: 14, textColor: '#2038ab' });
    const fromString = normalizeStyleConfig(JSON.stringify({ fontFamily: 'Georgia, serif', baseFontSize: 14, textColor: '#2038ab' }));
    assert.deepEqual(fromObject, fromString);
    assert.equal(fromObject.fontFamily, 'Georgia, serif');
  });

  test('clamps the size and rejects a bad colour', () => {
    const config = normalizeStyleConfig({ baseFontSize: 999, textColor: 'not-a-colour' });
    assert.equal(config.baseFontSize, 96);
    assert.equal(config.textColor, '#111111');
  });

  test('malformed JSON is a 422, not a crash', () => {
    assert.throws(() => normalizeStyleConfig('{not json'), (err) => err.statusCode === 422);
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

describe('normalizeFields — table elements', () => {
  test('a grid is normalised to exactly rows × cols flat cells', () => {
    const [field] = normalizeFields([{
      key: 'info', label: 'Info', type: 'TABLE',
      table: { rows: 2, cols: 3, cells: ['a', 'b'], cellSources: ['student.name'] },
    }]);
    assert.equal(field.table.rows, 2);
    assert.equal(field.table.cols, 3);
    assert.deepEqual(field.table.cells, ['a', 'b', '', '', '', '']);
    assert.deepEqual(field.table.columnWidths, [1, 1, 1]);
    assert.deepEqual(field.table.rowHeights, [1, 1]);
    // Only the whitelisted source survives — the rest print their own text.
    assert.deepEqual(field.table.cellSources, ['student.name', '', '', '', '', '']);
  });

  test('rows and columns are clamped, and default to a 3×3 grid', () => {
    const [huge] = normalizeFields([{ key: 't', label: 'T', type: 'TABLE', table: { rows: 999, cols: 999 } }]);
    assert.equal(huge.table.rows, 40);
    assert.equal(huge.table.cols, 12);

    const [fallback] = normalizeFields([{ key: 't', label: 'T', type: 'TABLE' }]);
    assert.equal(fallback.table.rows, 3);
    assert.equal(fallback.table.cols, 3);
  });

  test('a cell source outside the allowlist is dropped, and cell text is capped', () => {
    const [field] = normalizeFields([{
      key: 't', label: 'T', type: 'TABLE',
      table: { rows: 1, cols: 2, cells: ['x'.repeat(600), 'y'], cellSources: ['student.password', 'course.code'] },
    }]);
    assert.equal(field.table.cells[0].length, 500);
    assert.equal(field.table.cellSources[0], '');
    assert.equal(field.table.cellSources[1], 'course.code');
  });

  test('a table is never an editable field', () => {
    assert.equal(normalizeFields([{ key: 't', label: 'T', type: 'TABLE' }])[0].editable, false);
  });

  test('only a TABLE carries a grid; every other type leaves the path unset', () => {
    assert.equal(normalizeFields([{ key: 't', label: 'T', type: 'STATIC' }])[0].table, undefined);
    assert.equal(normalizeFields([{ key: 'b', label: 'B', type: 'BOX' }])[0].table, undefined);
  });
});
