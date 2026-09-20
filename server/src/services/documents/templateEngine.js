import { escapeHtml, escapeCssValue } from './sanitize.js';

// A4/LETTER in millimetres. The page is laid out absolutely in mm, which maps
// cleanly to print, so the same numbers drive both the on-screen A4 canvas in
// the admin editor and the PDF Chromium renders.
const PAGE_MM = {
  A4: { w: 210, h: 297 },
  LETTER: { w: 215.9, h: 279.4 },
};

/** The physical page size for a template, honouring orientation. */
export function pageSizeMm(pageSize = 'A4', orientation = 'portrait') {
  const base = PAGE_MM[String(pageSize || 'A4').toUpperCase()] || PAGE_MM.A4;
  return orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

// Only a genuine base64 raster/SVG data URI is ever embedded — it is
// server-generated, but this keeps a malformed value from breaking the CSS.
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// `none` is in the list so an explicitly borderless box is honoured rather than
// falling through to the `solid` default.
const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** Where a box sits and how it is painted — everything but its border. */
function positionStyles(field) {
  const background = HEX_COLOR.test(String(field.backgroundColor || '')) ? field.backgroundColor : '';
  const radius = num(field.borderRadius, 0);

  return [
    `left:${num(field.x, 20)}mm`,
    `top:${num(field.y, 20)}mm`,
    `width:${num(field.width, 100)}mm`,
    `z-index:${Math.round(num(field.zIndex, 0))}`,
    radius > 0 ? `border-radius:${radius}mm` : '',
    background ? `background-color:${background}` : '',
  ].filter(Boolean);
}

/** The box every element occupies, in mm: position, borders, shading, paint order. */
function boxStyles(field) {
  const borderWidth = num(field.borderWidth, 0);
  const borderStyle = BORDER_STYLES.includes(field.borderStyle) ? field.borderStyle : 'solid';

  return [
    ...positionStyles(field),
    // A border only when there is a width AND a style — Word's "no border".
    borderWidth > 0 && borderStyle !== 'none'
      ? `border:${borderWidth}mm ${borderStyle} ${escapeCssValue(field.borderColor, '#111111')}`
      : '',
  ].filter(Boolean);
}

function renderText(field, value) {
  const decorations = [
    field.underline ? 'underline' : '',
    field.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ');

  const spacing = num(field.letterSpacing, 0);

  const styles = [
    ...boxStyles(field),
    `min-height:${num(field.height, 8)}mm`,
    `font-size:${num(field.fontSize, 12)}pt`,
    `line-height:${num(field.lineHeight, 1.25)}`,
    `text-align:${['left', 'center', 'right'].includes(field.align) ? field.align : 'left'}`,
    `color:${escapeCssValue(field.color, '#111111')}`,
    field.bold ? 'font-weight:700' : '',
    field.italic ? 'font-style:italic' : '',
    decorations ? `text-decoration:${decorations}` : '',
    spacing ? `letter-spacing:${spacing}pt` : '',
    field.fontFamily ? `font-family:${escapeCssValue(field.fontFamily, '')}` : '',
  ].filter(Boolean).join(';');

  return `    <div class="doc-field" style="${styles}">${escapeHtml(value)}</div>`;
}

/**
 * An image element: the university logo, or any other file in the server's
 * `img/` folder. Only an asset the server actually resolved is drawn — a missing
 * file prints nothing rather than a broken box.
 */
function renderImage(field, assets) {
  const uri = field.asset ? assets[field.asset] : '';
  if (!uri || !DATA_IMAGE.test(uri)) return '';

  const styles = [
    ...boxStyles(field),
    `height:${num(field.height, 25)}mm`,
  ].join(';');

  return `    <div class="doc-field" style="${styles}"><img src="${uri}" alt="" `
    + 'style="width:100%;height:100%;object-fit:contain"></div>';
}

/**
 * A rule/divider. Its `height` is read as the line's thickness in mm (a line has
 * no height of its own), so one number drives both the editor and the print.
 * A background colour turns it into a shaded band; a border draws a second rule.
 */
function renderLine(field) {
  const thickness = clamp(num(field.height, 0.4), 0.1, 5);
  const styles = [
    ...boxStyles(field),
    `height:0`,
    `border-top:${thickness}mm solid ${escapeCssValue(field.color, '#111111')}`,
  ].join(';');

  return `    <div class="doc-field" style="${styles}"></div>`;
}

/**
 * A box: border and/or shading only, with no text of its own. This is what an
 * admin uses to frame the page (an A4 border) or draw a rectangle — a text field
 * cannot do it, because a text field with no value prints nothing.
 */
function renderBox(field) {
  const styles = [
    ...boxStyles(field),
    `height:${num(field.height, 20)}mm`,
  ].join(';');

  return `    <div class="doc-field" style="${styles}"></div>`;
}

const MAX_TABLE_ROWS = 40;
const MAX_TABLE_COLS = 12;

/** Column/row weights padded to `count`, each at least 0.1. */
function tableWeights(raw, count) {
  const list = Array.isArray(raw)
    ? raw.slice(0, count).map((value) => clamp(num(value, 1), 0.1, 100))
    : [];
  while (list.length < count) list.push(1);
  return list;
}

/**
 * The grid a table draws. The resolved values (from fieldResolver) are the
 * source of truth — they already carry any official cell values — and the
 * field's own flat `cells` are the fallback for a render handed no resolved
 * data (a unit test, or any caller that skips buildRenderData).
 *
 * @returns {{grid:string[][], rows:number, cols:number}|null}
 */
function tableGrid(field, raw) {
  const table = field.table && typeof field.table === 'object' ? field.table : {};

  let parsed = raw;
  if (typeof raw === 'string' && raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const cols = clamp(Math.round(num(table.cols, 0)), 0, MAX_TABLE_COLS);
  const rows = clamp(Math.round(num(table.rows, 0)), 0, MAX_TABLE_ROWS);
  const width = cols || (Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0].length : 0);
  const height = rows || (Array.isArray(parsed) ? parsed.length : 0);
  if (!width || !height) return null;

  const grid = [];
  for (let r = 0; r < height; r += 1) {
    const row = [];
    for (let c = 0; c < width; c += 1) {
      const resolved = Array.isArray(parsed) && Array.isArray(parsed[r]) ? parsed[r][c] : undefined;
      const stored = Array.isArray(table.cells) ? table.cells[r * width + c] : undefined;
      row.push(String(resolved != null ? resolved : (stored != null ? stored : '')));
    }
    grid.push(row);
  }
  return { grid, rows: height, cols: width };
}

/**
 * A table element: rows and columns of cells, like a Word table. The borders
 * live on the cells (the wrapper stays borderless, so the outer edge is not
 * drawn twice), and the grid fills the element's own width and height.
 */
function renderTable(field, raw) {
  const parsed = tableGrid(field, raw);
  if (!parsed) return '';
  const { grid, rows, cols } = parsed;
  const table = field.table && typeof field.table === 'object' ? field.table : {};

  const widths = tableWeights(table.columnWidths, cols);
  const totalWidth = widths.reduce((sum, value) => sum + value, 0) || cols;
  const rowWeights = tableWeights(table.rowHeights, rows);
  const totalRowWeight = rowWeights.reduce((sum, value) => sum + value, 0) || rows;

  const heightMm = num(field.height, 40);
  const borderWidth = num(field.borderWidth, 0);
  const borderStyle = BORDER_STYLES.includes(field.borderStyle) ? field.borderStyle : 'solid';
  const cellBorder = borderWidth > 0 && borderStyle !== 'none'
    ? `border:${borderWidth}mm ${borderStyle} ${escapeCssValue(field.borderColor, '#111111')};`
    : '';
  const padding = clamp(num(table.cellPadding, 1.5), 0, 10);

  const cellStyle = [
    cellBorder,
    `padding:${padding}mm`,
    'vertical-align:top',
    `text-align:${['left', 'center', 'right'].includes(field.align) ? field.align : 'left'}`,
    `font-size:${num(field.fontSize, 11)}pt`,
    `line-height:${num(field.lineHeight, 1.25)}`,
    field.fontFamily ? `font-family:${escapeCssValue(field.fontFamily, '')}` : '',
    num(field.letterSpacing, 0) ? `letter-spacing:${num(field.letterSpacing, 0)}pt` : '',
    `color:${escapeCssValue(field.color, '#111111')}`,
    field.bold ? 'font-weight:700' : '',
    field.italic ? 'font-style:italic' : '',
  ].filter(Boolean).join(';');

  const headerBackground = table.headerRow && HEX_COLOR.test(String(table.headerBackground || ''))
    ? table.headerBackground
    : '';

  const colgroup = widths
    .map((weight) => `<col style="width:${((weight / totalWidth) * 100).toFixed(4)}%">`)
    .join('');

  const body = grid.map((row, r) => {
    const isHeader = Boolean(table.headerRow) && r === 0;
    const rowMm = (heightMm * (rowWeights[r] ?? 1)) / totalRowWeight;
    const background = isHeader && headerBackground ? `background-color:${headerBackground};` : '';
    const weight = isHeader ? 'font-weight:700;' : '';
    const tds = row
      .map((cell) => `<td style="${cellStyle};${background}${weight}">${escapeHtml(cell)}</td>`)
      .join('');
    return `      <tr style="height:${rowMm.toFixed(3)}mm">${tds}</tr>`;
  }).join('\n');

  const styles = [
    ...positionStyles(field),
    `height:${heightMm}mm`,
  ].join(';');

  return `    <div class="doc-field" style="${styles}">`
    + '<table class="doc-table" style="width:100%;height:100%;table-layout:fixed;border-collapse:collapse">'
    + `<colgroup>${colgroup}</colgroup><tbody>\n${body}\n      </tbody></table></div>`;
}

function renderField(field, values, assets) {
  if (!field) return '';

  // Elements that draw without a resolved value.
  if (field.type === 'LINE') return renderLine(field);
  if (field.type === 'BOX') return renderBox(field);
  if (field.type === 'IMAGE') return renderImage(field, assets);
  if (field.type === 'TABLE') return renderTable(field, values[field.key]);

  const value = values[field.key];
  // An unfilled optional field prints nothing at all, rather than an empty box.
  if (value === undefined || value === null || value === '') return '';
  return renderText(field, value);
}

/**
 * Renders a template version plus its resolved values to a complete A4 HTML
 * document.
 *
 * <p>This one function is used by BOTH the live preview and the PDF worker, so
 * what the student reviews can never diverge from what is generated. Every value
 * is HTML-escaped here; the template's own HTML/CSS is admin-authored and never
 * built from student input.
 *
 * @param {object} version template version (page, styleConfig, fields)
 * @param {Record<string,string>} values resolved field values
 * @param {{title?:string, backgroundDataUri?:string, assets?:Record<string,string>}} [options]
 *   `assets` maps an IMAGE element's file name to an embedded data URI.
 */
export function renderHtml(version, values = {}, { title = 'Document', backgroundDataUri = '', assets = {} } = {}) {
  const page = pageSizeMm(version?.pageSize, version?.orientation);
  const style = version?.styleConfig || {};
  const fontFamily = escapeCssValue(style.fontFamily, 'Helvetica, Arial, sans-serif');
  const textColor = escapeCssValue(style.textColor, '#111111');

  const hasBackground = style.background?.type === 'image' && DATA_IMAGE.test(backgroundDataUri);
  const background = hasBackground
    ? `background-image:url('${backgroundDataUri}');background-size:${page.w}mm ${page.h}mm;background-repeat:no-repeat;`
    : '';

  // Painted in z order, so what the editor shows (where a "bring to front"
  // element wins) is what the PDF contains.
  const ordered = [...(version?.fields || [])].sort(
    (a, b) => num(a?.zIndex, 0) - num(b?.zIndex, 0)
  );

  const fields = ordered
    .map((field) => renderField(field, values, assets))
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: ${page.w}mm ${page.h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body {
      font-family: ${fontFamily};
      color: ${textColor};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-page { position: relative; width: ${page.w}mm; height: ${page.h}mm; overflow: hidden; ${background} }
    .doc-field { position: absolute; box-sizing: border-box; line-height: 1.25; white-space: pre-wrap; overflow: hidden; }
    .doc-field img { display: block; }
    .doc-table { border-collapse: collapse; }
    .doc-table td { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <div class="doc-page">
${fields}
  </div>
</body>
</html>`;
}

export default { renderHtml, pageSizeMm };
