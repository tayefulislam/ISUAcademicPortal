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

// Only a genuine base64 raster data URI is ever embedded as a background — it
// is server-generated, but this keeps a malformed value from breaking the CSS.
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderField(field, values) {
  const value = values[field.key];
  // An unfilled optional field prints nothing at all, rather than an empty box.
  if (value === undefined || value === null || value === '') return '';

  const width = num(field.width, 100);
  const height = num(field.height, 8);
  const styles = [
    `left:${num(field.x, 20)}mm`,
    `top:${num(field.y, 20)}mm`,
    `width:${width}mm`,
    `min-height:${height}mm`,
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
 * Renders a template version plus its resolved values to a complete A4 HTML
 * document.
 *
 * <p>This one function is used by BOTH the live preview and the PDF worker, so
 * what the student reviews can never diverge from what is generated. Every value
 * is HTML-escaped here; the template's own HTML/CSS is admin-authored and never
 * built from student input.
 */
export function renderHtml(version, values = {}, { title = 'Document', backgroundDataUri = '' } = {}) {
  const page = pageSizeMm(version?.pageSize, version?.orientation);
  const style = version?.styleConfig || {};
  const fontFamily = escapeCssValue(style.fontFamily, 'Helvetica, Arial, sans-serif');
  const textColor = escapeCssValue(style.textColor, '#111111');

  const hasBackground = style.background?.type === 'image' && DATA_IMAGE.test(backgroundDataUri);
  const background = hasBackground
    ? `background-image:url('${backgroundDataUri}');background-size:${page.w}mm ${page.h}mm;background-repeat:no-repeat;`
    : '';

  const fields = (version?.fields || [])
    .map((field) => renderField(field, values))
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
