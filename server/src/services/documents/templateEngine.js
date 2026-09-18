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

/** The box every element occupies, in mm, plus its forced paint order. */
function boxStyles(field) {
  return [
    `left:${num(field.x, 20)}mm`,
    `top:${num(field.y, 20)}mm`,
    `width:${num(field.width, 100)}mm`,
    `z-index:${Math.round(num(field.zIndex, 0))}`,
  ];
}

function renderText(field, value) {
  const styles = [
    ...boxStyles(field),
    `min-height:${num(field.height, 8)}mm`,
    `font-size:${num(field.fontSize, 12)}pt`,
    `text-align:${['left', 'center', 'right'].includes(field.align) ? field.align : 'left'}`,
    `color:${escapeCssValue(field.color, '#111111')}`,
    field.bold ? 'font-weight:700' : '',
    field.italic ? 'font-style:italic' : '',
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

function renderField(field, values, assets) {
  if (!field) return '';

  // Elements that draw without a resolved value.
  if (field.type === 'LINE') return renderLine(field);
  if (field.type === 'IMAGE') return renderImage(field, assets);

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
