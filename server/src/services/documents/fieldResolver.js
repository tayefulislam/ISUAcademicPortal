import { ApiError } from '../../utils/ApiError.js';
import { EDITABLE_TYPES, FIELD_SOURCES } from './fieldSources.js';
import { cleanText } from './sanitize.js';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Renders a yyyy-mm-dd value in the template's chosen format, if it has one. */
export function formatDateValue(value, format) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text; // already free text — leave it alone
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  switch (String(format || '').toUpperCase()) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'DD MMM YYYY':
      return `${day} ${MONTHS_SHORT[monthIndex] || month} ${year}`;
    case 'MMMM D, YYYY':
      return `${MONTHS_LONG[monthIndex] || month} ${Number(day)}, ${year}`;
    case 'YYYY-MM-DD':
    default:
      return `${year}-${month}-${day}`;
  }
}

/** Applies a field's prefix/suffix/uppercase/date-format rules. */
export function applyFormatting(value, formatting = {}) {
  let text = String(value == null ? '' : value);
  if (!text) return '';
  if (formatting.dateFormat) text = formatDateValue(text, formatting.dateFormat);
  if (formatting.uppercase) text = text.toUpperCase();
  if (formatting.prefix) text = `${formatting.prefix}${text}`;
  if (formatting.suffix) text = `${text}${formatting.suffix}`;
  return text;
}

/**
 * Throws a 422 for a value that does not satisfy its field's rules, naming the
 * field so the student sees which box to fix.
 */
export function validateFieldValue(field, value) {
  const label = field.label || field.key;
  const rules = field.validation || {};

  if (field.required && !value) {
    throw new ApiError(422, `${label} is required`);
  }
  if (!value) return; // optional and empty — nothing further to check

  if (field.type === 'NUMBER') {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      throw new ApiError(422, `${label} must be a number`);
    }
    const number = Number(value);
    if (rules.min != null && number < rules.min) {
      throw new ApiError(422, `${label} must be at least ${rules.min}`);
    }
    if (rules.max != null && number > rules.max) {
      throw new ApiError(422, `${label} must be at most ${rules.max}`);
    }
  }

  if (field.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(422, `${label} must be a valid date`);
  }

  if (rules.maxLength && value.length > rules.maxLength) {
    throw new ApiError(422, `${label} must be at most ${rules.maxLength} characters`);
  }

  if (rules.regex) {
    let pattern;
    try {
      pattern = new RegExp(rules.regex);
    } catch {
      // A malformed admin-supplied pattern must not make every generation fail;
      // treat it as "no rule" rather than throwing at the student.
      return;
    }
    if (!pattern.test(value)) {
      throw new ApiError(422, `${label} is not in the expected format`);
    }
  }
}

/**
 * A TABLE element's resolved grid (row-major, 2D). A cell whose matching
 * `cellSources` entry names an official source prints that source's value;
 * every other cell prints its own stored text. The source is validated against
 * the same allowlist an AUTO field uses, so a cell can never read anything else.
 */
function resolveTableGrid(table, context) {
  const source = table && typeof table === 'object' ? table : {};
  const rows = Math.max(0, Math.round(Number(source.rows) || 0));
  const cols = Math.max(0, Math.round(Number(source.cols) || 0));
  const cells = Array.isArray(source.cells) ? source.cells : [];
  const sources = Array.isArray(source.cellSources) ? source.cellSources : [];

  const grid = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      const index = r * cols + c;
      const from = sources[index];
      row.push(from && FIELD_SOURCES.includes(from)
        ? String(context[from] ?? '')
        : String(cells[index] ?? ''));
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Builds the values a template renders with.
 *
 * <p>The security rule lives here: a field's type decides where its value comes
 * from, and only an editable type may read `inputData`. An AUTO or STATIC field
 * is resolved from `context` (the authenticated user's own records, assembled
 * by the caller) and any client-supplied value for that key is ignored — so a
 * student can never forge their name, ID, batch, group, course or teacher.
 *
 * @param {object} args
 * @param {Array<object>} args.fields
 * @param {Record<string,string>} args.context  source path -> resolved value
 * @param {Record<string,unknown>} args.inputData
 * @returns {{values: Record<string,string>, resolved: Record<string,object>}}
 */
export function buildRenderData({ fields = [], context = {}, inputData = {} }) {
  const values = {};
  const resolved = {};
  const provided = inputData && typeof inputData === 'object' ? inputData : {};

  for (const field of fields) {
    if (!field || !field.key) continue;
    const key = field.key;
    let value;

    if (field.type === 'STATIC') {
      value = field.staticValue || field.defaultValue || '';
      resolved[key] = { type: 'STATIC', value };
    } else if (field.type === 'AUTO') {
      value = field.source ? String(context[field.source] ?? '') : '';
      resolved[key] = { type: 'AUTO', source: field.source || '', value };
    } else if (EDITABLE_TYPES.includes(field.type)) {
      const raw = provided[key];
      const source = raw === undefined || raw === null || raw === '' ? field.defaultValue : raw;
      value = cleanText(source, field.validation?.maxLength || 0);
      validateFieldValue(field, value);
      resolved[key] = { type: field.type, value };
    } else if (field.type === 'TABLE') {
      // A table is drawn rather than typed: its grid is resolved here (official
      // cell sources included) and handed to the renderer as a JSON string,
      // which is what the flat `values` map carries. It carries its own value
      // already, so it skips the prefix/suffix formatting step below.
      const grid = resolveTableGrid(field.table, context);
      values[key] = JSON.stringify(grid);
      resolved[key] = { type: 'TABLE', value: grid };
      continue;
    } else if (field.type === 'IMAGE') {
      // Images are modelled but not yet collectable from the student; a static
      // image (the university logo) is supplied by the template itself.
      value = field.staticValue || field.defaultValue || '';
      resolved[key] = { type: 'IMAGE', value: value ? '[image]' : '' };
    } else {
      continue;
    }

    values[key] = applyFormatting(value, field.formatting);
  }

  return { values, resolved };
}

export default { buildRenderData, validateFieldValue, applyFormatting, formatDateValue };
