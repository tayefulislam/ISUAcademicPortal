import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resizeBox, MIN_WIDTH_MM, MIN_HEIGHT_MM, MIN_THICKNESS_MM } from './resizeBox.js';

const BOX = { x: 40, y: 60, width: 100, height: 20 };

describe('resizeBox — the dragged edge moves, the opposite one stays', () => {
  test('east/south grow the box', () => {
    assert.deepEqual(resizeBox(BOX, 'se', 10, 5), { x: 40, y: 60, width: 110, height: 25 });
    assert.deepEqual(resizeBox(BOX, 'e', 10, 0), { x: 40, y: 60, width: 110, height: 20 });
    assert.deepEqual(resizeBox(BOX, 's', 0, 5), { x: 40, y: 60, width: 100, height: 25 });
  });

  test('west/north move the origin and keep the far edge fixed', () => {
    const west = resizeBox(BOX, 'w', -10, 0);
    assert.equal(west.width, 110);
    assert.equal(west.x + west.width, BOX.x + BOX.width);

    const north = resizeBox(BOX, 'n', 0, -5);
    assert.equal(north.height, 25);
    assert.equal(north.y + north.height, BOX.y + BOX.height);
  });

  test('a corner moves both axes', () => {
    const out = resizeBox(BOX, 'nw', -10, -5);
    assert.equal(out.width, 110);
    assert.equal(out.height, 25);
    assert.equal(out.x + out.width, BOX.x + BOX.width);
    assert.equal(out.y + out.height, BOX.y + BOX.height);
  });
});

describe('resizeBox — minimum size', () => {
  test('a box never shrinks below the floor', () => {
    const out = resizeBox(BOX, 'se', -500, -500);
    assert.equal(out.width, MIN_WIDTH_MM);
    assert.equal(out.height, MIN_HEIGHT_MM);
  });

  test('dragging the west edge past the floor pins the right edge', () => {
    const out = resizeBox(BOX, 'w', 500, 0);
    assert.equal(out.width, MIN_WIDTH_MM);
    assert.equal(out.x + out.width, BOX.x + BOX.width);
  });

  test('a rule keeps a sub-millimetre thickness', () => {
    const rule = { x: 20, y: 50, width: 170, height: 0.5 };
    assert.equal(resizeBox(rule, 's', 0, -10, { line: true }).height, MIN_THICKNESS_MM);
    // …and can be made thicker, still with the fine default of 0.5 mm steps.
    assert.equal(resizeBox(rule, 's', 0, 1, { line: true }).height, 1.5);
    // A text box, by contrast, is floored at 2 mm.
    assert.equal(resizeBox({ ...rule, height: 8 }, 's', 0, -10).height, MIN_HEIGHT_MM);
  });
});

describe('resizeBox — modifiers', () => {
  test('keepShape on a corner preserves the aspect ratio', () => {
    const square = { x: 10, y: 10, width: 40, height: 20 };
    const out = resizeBox(square, 'se', 40, 0, { keepShape: true });
    assert.equal(Math.round((out.width / out.height) * 100) / 100, 2);
    assert.equal(out.x, 10);
    assert.equal(out.y, 10);
  });

  test('keepShape is ignored on an edge (only corners have a shape)', () => {
    const out = resizeBox(BOX, 'e', 10, 0, { keepShape: true });
    assert.deepEqual(out, { x: 40, y: 60, width: 110, height: 20 });
  });

  test('fine mode steps in 0.1 mm, the default in 0.5 mm', () => {
    assert.equal(resizeBox(BOX, 'e', 10.26, 0).width, 110.5);
    assert.equal(resizeBox(BOX, 'e', 10.26, 0, { fine: true }).width, 110.3);
  });
});

describe('resizeBox — the page', () => {
  test('a box cannot be dragged off the page', () => {
    const out = resizeBox(BOX, 'w', 500, 0);
    assert.ok(out.x >= 0 && out.y >= 0);
    const grown = resizeBox(BOX, 'se', 500, 500, { pageWidth: 210, pageHeight: 297 });
    assert.ok(grown.x + grown.width <= 210);
    assert.ok(grown.y + grown.height <= 297);
  });

  test('an unknown direction is a no-op apart from rounding', () => {
    assert.deepEqual(resizeBox(BOX, '', 0, 0), BOX);
  });
});
