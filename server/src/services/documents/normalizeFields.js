import { ApiError } from '../../utils/ApiError.js';
import { FIELD_TYPES, FIELD_SOURCES, EDITABLE_TYPES } from './fieldSources.js';

// Bounds so a template cannot define an unbounded page of fields.
const MAX_FIELDS = 200;
const ALIGNMENTS = ['left', 'center', 'right'];
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function numOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates and normalizes an admin-supplied field list, rejecting a definition
 * that could not render (an AUTO field with no source, a duplicate key, a broken
 * validation pattern). Done at save time on purpose — a malformed definition
 * should fail in the editor, not silently at a student's generation.
 *
 * @param {Array|string|null} raw
 * @returns {Array<object>}
 */
export function normalizeFields(raw) {
  if (raw == null || raw === '') return [];

  let fields = raw;
  if (typeof raw === 'string') {
    try {
      fields = JSON.parse(raw);
    } catch {
      throw new ApiError(422, 'fields must be valid JSON');
    }
  }
  if (!Array.isArray(fields)) throw new ApiError(422, 'fields must be an array');
  if (fields.length > MAX_FIELDS) {
    throw new ApiError(422, `A template may define at most ${MAX_FIELDS} fields`);
  }

  const seenKeys = new Set();
  return fields.map((field, index) => {
    if (!field || typeof field !== 'object') {
      throw new ApiError(422, `Field ${index + 1} is not a valid field definition`);
    }

    const key = String(field.key || '').trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw new ApiError(422, `Field "${field.key || index + 1}" needs a key like student_name`);
    }
    if (seenKeys.has(key)) throw new ApiError(422, `Duplicate field key: ${key}`);
    seenKeys.add(key);

    const type = FIELD_TYPES.includes(field.type) ? field.type : 'USER_INPUT';
    const label = String(field.label || '').trim() || key;

    let source = '';
    if (type === 'AUTO') {
      source = String(field.source || '');
      if (!FIELD_SOURCES.includes(source)) {
        throw new ApiError(422, `Field "${label}" is automatic but has no valid source`);
      }
    } else if (type === 'STATIC' && field.source) {
      source = FIELD_SOURCES.includes(field.source) ? field.source : '';
    }

    const validation = field.validation && typeof field.validation === 'object' ? field.validation : {};
    if (validation.regex) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(String(validation.regex));
      } catch {
        throw new ApiError(422, `Field "${label}" has an invalid validation pattern`);
      }
    }

    const formatting = field.formatting && typeof field.formatting === 'object' ? field.formatting : {};

    return {
      key,
      label,
      type,
      source,
      // Editable is derived from the type, never taken from the client: an
      // official AUTO field can never be marked editable by a request.
      editable: EDITABLE_TYPES.includes(type),
      required: Boolean(field.required),
      defaultValue: String(field.defaultValue || '').slice(0, 500),
      staticValue: String(field.staticValue || '').slice(0, 500),
      validation: {
        regex: String(validation.regex || '').slice(0, 300),
        maxLength: clamp(numOr(validation.maxLength, 0), 0, 2000),
        min: validation.min == null || validation.min === '' ? null : numOr(validation.min, null),
        max: validation.max == null || validation.max === '' ? null : numOr(validation.max, null),
      },
      formatting: {
        dateFormat: String(formatting.dateFormat || '').slice(0, 30),
        uppercase: Boolean(formatting.uppercase),
        prefix: String(formatting.prefix || '').slice(0, 100),
        suffix: String(formatting.suffix || '').slice(0, 100),
      },
      x: clamp(numOr(field.x, 20), 0, 400),
      y: clamp(numOr(field.y, 20), 0, 600),
      width: clamp(numOr(field.width, 100), 5, 400),
      height: clamp(numOr(field.height, 8), 2, 600),
      fontSize: clamp(numOr(field.fontSize, 12), 4, 96),
      fontFamily: String(field.fontFamily || '').slice(0, 120),
      bold: Boolean(field.bold),
      italic: Boolean(field.italic),
      align: ALIGNMENTS.includes(field.align) ? field.align : 'left',
      color: COLOR.test(String(field.color || '')) ? field.color : '#111111',
    };
  });
}

export default { normalizeFields };
