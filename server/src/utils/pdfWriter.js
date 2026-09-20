/**
 * A tiny, dependency-free PDF writer.
 *
 * <p>The Document Generator renders PDFs with headless Chromium, but that path
 * needs Redis/BullMQ and a Playwright browser on the host — far too much to ask
 * of every deployment just to print a timetable. This writes the small subset of
 * PDF a table needs (absolute-positioned text in the two standard Helvetica
 * fonts, filled/stroked rectangles and lines, several pages) directly, so the
 * routine PDF works everywhere the API itself runs.
 *
 * <p>Coordinates are given from the TOP-LEFT of the page, which is how layout
 * code naturally reads; they are flipped to PDF's bottom-left origin internally.
 * Text is limited to printable ASCII (transliterated where possible) because the
 * standard fonts use WinAnsi encoding and a stray character would render as
 * mojibake.
 */

const A4_PORTRAIT = [595.28, 841.89];

const BLACK = [0.13, 0.15, 0.19];
const GREY = [0.45, 0.48, 0.53];

/** Three decimals is plenty for points, and keeps the file small. */
function n(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return String(rounded);
}

function rgb(color) {
  const [r, g, b] = color;
  return `${n(r)} ${n(g)} ${n(b)}`;
}

/** Printable ASCII only — the standard fonts cannot render anything else. */
function toAscii(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00b7|\u2022/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '');
}

function escapeString(value) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * An approximate advance width (in multiples of the font size) for one
 * character of Helvetica. Only used to centre and to fit text inside a cell —
 * never to render — so the small inaccuracies are invisible.
 */
function charWidth(ch, bold) {
  const scale = bold ? 1.06 : 1;
  if (ch === ' ') return 0.278 * scale;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return 0.556 * scale; // digits
  if (ch >= 'A' && ch <= 'Z') {
    if (ch === 'I' || ch === 'J') return 0.278 * scale;
    if (ch === 'M' || ch === 'W') return 0.833 * scale;
    return 0.667 * scale;
  }
  if (ch >= 'a' && ch <= 'z') {
    if (ch === 'i' || ch === 'l' || ch === 'j') return 0.222 * scale;
    if (ch === 'f' || ch === 't' || ch === 'r') return 0.333 * scale;
    if (ch === 'm') return 0.833 * scale;
    if (ch === 'w') return 0.722 * scale;
    return 0.556 * scale;
  }
  if (ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === '!' || ch === '|') return 0.278 * scale;
  if (ch === '-' || ch === '/') return 0.333 * scale;
  return 0.5 * scale;
}

export class PdfDocument {

  constructor({ landscape = false, margin = 32 } = {}) {
    const [w, h] = A4_PORTRAIT;
    this.width = landscape ? h : w;
    this.height = landscape ? w : h;
    this.margin = margin;
    this.pages = [];
    this._ops = null;
    this.addPage();
  }

  get contentWidth() {
    return this.width - this.margin * 2;
  }

  get contentHeight() {
    return this.height - this.margin * 2;
  }

  /** The number of pages written so far. */
  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this._ops = [];
    this.pages.push(this._ops);
    return this.pageCount;
  }

  /**
   * Points later drawing at an existing page. Used to stamp something that needs
   * the finished document — a "Page 3 of 5" footer, which cannot be written while
   * the page count is still unknown.
   */
  selectPage(index) {
    if (index >= 0 && index < this.pages.length) {
      this._ops = this.pages[index];
    }
    return this;
  }

  /** The measured width of `text` at `size` points. */
  textWidth(text, size, bold = false) {
    let total = 0;
    for (const ch of toAscii(text)) {
      total += charWidth(ch, bold);
    }
    return total * size;
  }

  /** Truncates with a trailing "..." so it fits `maxWidth`. */
  fit(text, size, bold, maxWidth) {
    const clean = toAscii(text);
    if (maxWidth <= 0 || this.textWidth(clean, size, bold) <= maxWidth) {
      return clean;
    }
    let out = clean;
    while (out.length > 1 && this.textWidth(`${out}...`, size, bold) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  }

  /** Wraps into lines no wider than `maxWidth` (word-aware, hard-breaks long words). */
  wrap(text, size, bold, maxWidth) {
    const words = toAscii(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.textWidth(candidate, size, bold) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (this.textWidth(word, size, bold) <= maxWidth) {
        line = word;
      } else {
        let rest = word;
        while (rest.length > 1 && this.textWidth(rest, size, bold) > maxWidth) {
          let cut = rest.length;
          while (cut > 1 && this.textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  /**
   * Draws one line of text. `x`,`y` is the text baseline's left edge measured
   * from the page's top-left; `align` may be 'left' | 'center' | 'right'.
   */
  text(text, x, y, { size = 10, bold = false, color = BLACK, align = 'left', maxWidth = 0 } = {}) {
    const value = maxWidth > 0 ? this.fit(text, size, bold, maxWidth) : toAscii(text);
    if (!value) return this;
    let drawX = x;
    if (align === 'center') drawX = x - this.textWidth(value, size, bold) / 2;
    else if (align === 'right') drawX = x - this.textWidth(value, size, bold);

    this._ops.push(`${rgb(color)} rg`);
    this._ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(drawX)} ${n(this.height - y)} Td (${escapeString(value)}) Tj ET`
    );
    return this;
  }

  /** Fills and/or strokes a rectangle. `y` is the TOP edge. */
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.6 } = {}) {
    const bottom = this.height - y - h;
    if (fill) {
      this._ops.push(`${rgb(fill)} rg ${n(x)} ${n(bottom)} ${n(w)} ${n(h)} re f`);
    }
    if (stroke) {
      this._ops.push(`${rgb(stroke)} RG ${n(lineWidth)} w ${n(x)} ${n(bottom)} ${n(w)} ${n(h)} re S`);
    }
    return this;
  }

  line(x1, y1, x2, y2, { color = GREY, width = 0.6 } = {}) {
    this._ops.push(
      `${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`
    );
    return this;
  }

  /** The finished file. */
  toBuffer() {
    const firstPageObj = 5; // 1 catalog, 2 pages, 3/4 fonts
    const kids = [];
    for (let i = 0; i < this.pageCount; i += 1) {
      kids.push(`${firstPageObj + i * 2} 0 R`);
    }

    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${this.pageCount} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    this.pages.forEach((ops, i) => {
      const pageObj = firstPageObj + i * 2;
      const contentObj = pageObj + 1;
      const stream = ops.join('\n');
      objects[pageObj] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
      objects[contentObj] =
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    });

    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < objects.length; i += 1) {
      offsets[i] = Buffer.byteLength(out, 'latin1');
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(out, 'latin1');
    const count = objects.length;
    out += `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i += 1) {
      out += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(out, 'latin1');
  }
}

export { BLACK, GREY };
