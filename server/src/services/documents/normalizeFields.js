import { ApiError } from '../../utils/ApiError.js';
import { FIELD_TYPES, FIELD_SOURCES, EDITABLE_TYPES } from './fieldSources.js';
import { isAssetFileName } from './assets.js';

// Bounds so a template cannot define an unbounded page of fields.
const MAX_FIELDS = 200;
const MAX_TABLE_ROWS = 40;
const MAX_TABLE_COLS = 12;
const MAX_TABLE_CELL_CHARS = 500;
const ALIGNMENTS = ['left', 'center', 'right'];
const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function numOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Column/row weights: one positive number each, padded to `count`. */
function normalizeWeights(raw, count) {
  const list = Array.isArray(raw)
    ? raw.slice(0, count).map((value) => clamp(numOr(value, 1), 0.1, 100))
    : [];
  while (list.length < count) list.push(1);
  return list;
}

/**
 * The grid a TABLE element draws. Cells are stored FLAT (row-major, length
 * rows × cols) rather than as nested arrays: it is easier to keep exactly
 * rows × cols on resize, and it maps cleanly onto the Mongoose schema.
 *
 * <p>Text cells print as typed; a cell with a `cellSources` entry prints the
 * official value for that source instead — validated against the same allowlist
 * an AUTO field uses, so a cell can never read anything else.
 */
function normalizeTable(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rows = clamp(Math.round(numOr(source.rows, 3)), 1, MAX_TABLE_ROWS);
  const cols = clamp(Math.round(numOr(source.cols, 3)), 1, MAX_TABLE_COLS);
  const size = rows * cols;

  const cells = Array.isArray(source.cells)
    ? source.cells.slice(0, size).map((cell) => String(cell ?? '').slice(0, MAX_TABLE_CELL_CHARS))
    : [];
  while (cells.length < size) cells.push('');

  const cellSources = Array.isArray(source.cellSources)
    ? source.cellSources.slice(0, size).map((value) => (FIELD_SOURCES.includes(String(value)) ? String(value) : ''))
    : [];
  while (cellSources.length < size) cellSources.push('');

  return {
    rows,
    cols,
    headerRow: Boolean(source.headerRow),
    headerBackground: COLOR.test(String(source.headerBackground || '')) ? source.headerBackground : '#f1f5f9',
    cellPadding: clamp(numOr(source.cellPadding, 1.5), 0, 10),
    columnWidths: normalizeWeights(source.columnWidths, cols),
    rowHeights: normalizeWeights(source.rowHeights, rows),
    cells,
    cellSources,
  };
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
      // A rule reads `height` as its thickness, so it needs a sub-millimetre
      // range — the 2 mm floor that suits a text box would turn a hairline into
      // a bar. Everything else keeps the box floor.
      height: type === 'LINE'
        ? clamp(numOr(field.height, 0.4), 0.1, 5)
        : clamp(numOr(field.height, 8), 2, 600),
      fontSize: clamp(numOr(field.fontSize, 12), 4, 96),
      fontFamily: String(field.fontFamily || '').slice(0, 120),
      bold: Boolean(field.bold),
      italic: Boolean(field.italic),
      align: ALIGNMENTS.includes(field.align) ? field.align : 'left',
      color: COLOR.test(String(field.color || '')) ? field.color : '#111111',

      // Word-like text styling.
      underline: Boolean(field.underline),
      strikethrough: Boolean(field.strikethrough),
      lineHeight: clamp(numOr(field.lineHeight, 1.25), 0.8, 3),
      letterSpacing: clamp(numOr(field.letterSpacing, 0), -2, 10),
      backgroundColor: COLOR.test(String(field.backgroundColor || '')) ? field.backgroundColor : '',

      // Borders & shading.
      borderWidth: clamp(numOr(field.borderWidth, 0), 0, 5),
      borderColor: COLOR.test(String(field.borderColor || '')) ? field.borderColor : '#111111',
      borderStyle: BORDER_STYLES.includes(field.borderStyle) ? field.borderStyle : 'solid',
      borderRadius: clamp(numOr(field.borderRadius, 0), 0, 30),

      // An IMAGE element's file name in the server's img/ folder. Validated here
      // so a design can never reference a path or a non-image file.
      asset: isAssetFileName(field.asset) ? String(field.asset).trim() : '',
      zIndex: clamp(numOr(field.zIndex, index), -999, 999),
      locked: Boolean(field.locked),
      // Only a TABLE carries a grid; every other type leaves the path unset so a
      // document is not padded with an empty table on each of its elements.
      table: type === 'TABLE' ? normalizeTable(field.table) : undefined,
    };
  });
}

/**
 * The page-level defaults a version carries: the font the whole document is set
 * in, its base size and colour. Kept beside the field normalizer because it is
 * the same kind of input (admin-authored, saved with the version).
 */
export function normalizeStyleConfig(raw) {
  let config = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return { fontFamily: '', baseFontSize: 12, textColor: '#111111' };
    try {
      config = JSON.parse(raw);
    } catch {
      throw new ApiError(422, 'styleConfig must be valid JSON');
    }
  }
  const source = config && typeof config === 'object' ? config : {};
  return {
    fontFamily: String(source.fontFamily || '').slice(0, 120),
    baseFontSize: clamp(numOr(source.baseFontSize, 12), 4, 96),
    textColor: COLOR.test(String(source.textColor || '')) ? source.textColor : '#111111',
  };
}

export default { normalizeFields, normalizeStyleConfig };
