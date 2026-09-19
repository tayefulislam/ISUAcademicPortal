import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_BLOCKS } from './documentBlocks.js';
import { normalizeFields } from './normalizeFields.js';

// The blocks are served straight to the editor and inserted into a version, so a
// malformed one would fail at save time in front of an admin. Normalizing every
// block here turns that into a test failure instead.
describe('FIELD_BLOCKS', () => {
  test('every block normalizes to a valid field', () => {
    for (const block of FIELD_BLOCKS) {
      const [field] = normalizeFields([{ ...block.field }]);
      assert.equal(field.key, block.field.key, block.id);
    }
  });

  test('ids and keys are unique', () => {
    const ids = new Set();
    const keys = new Set();
    for (const block of FIELD_BLOCKS) {
      assert.ok(!ids.has(block.id), `duplicate block id: ${block.id}`);
      ids.add(block.id);
      assert.ok(!keys.has(block.field.key), `duplicate block key: ${block.field.key}`);
      keys.add(block.field.key);
    }
  });

  test('an AUTO block names a real source', () => {
    for (const block of FIELD_BLOCKS) {
      if (block.field.type === 'AUTO') {
        assert.ok(block.field.source, `${block.id} needs a source`);
      }
    }
  });
});
