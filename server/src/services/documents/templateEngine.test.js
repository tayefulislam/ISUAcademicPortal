import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, pageSizeMm } from './templateEngine.js';

const VERSION = {
  pageSize: 'A4',
  orientation: 'portrait',
  styleConfig: { fontFamily: 'Helvetica, Arial, sans-serif', textColor: '#111111' },
  fields: [],
};

describe('pageSizeMm', () => {
  test('A4 portrait and landscape', () => {
    assert.deepEqual(pageSizeMm('A4', 'portrait'), { w: 210, h: 297 });
    assert.deepEqual(pageSizeMm('A4', 'landscape'), { w: 297, h: 210 });
  });

  test('an unknown size falls back to A4', () => {
    assert.deepEqual(pageSizeMm('POSTER', 'portrait'), { w: 210, h: 297 });
  });
});

describe('renderHtml', () => {
  test('emits a complete A4 document with the page box', () => {
    const html = renderHtml(VERSION, {});
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /@page \{ size: 210mm 297mm/);
    assert.match(html, /\.doc-page/);
    assert.match(html, /<div class="doc-page">/);
  });

  test('places a field at its absolute A4 position with its own font', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'course_code', x: 40, y: 60, width: 80, height: 10, fontSize: 14, bold: true, align: 'center', color: '#000000' }] },
      { course_code: 'EEE 2103' }
    );
    assert.match(html, /left:40mm/);
    assert.match(html, /top:60mm/);
    assert.match(html, /width:80mm/);
    assert.match(html, /font-size:14pt/);
    assert.match(html, /text-align:center/);
    assert.match(html, /font-weight:700/);
    assert.match(html, /EEE 2103/);
  });

  test('escapes a value so it cannot inject markup', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'experiment_name', x: 10, y: 10 }] },
      { experiment_name: '<script>alert(1)</script><img src=x onerror=alert(2)>' }
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  });

  test('an unfilled optional field prints nothing at all', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'blank', x: 20, y: 20 }] },
      {}
    );
    assert.doesNotMatch(html, /class="doc-field"/);
  });

  test('landscape swaps the page box', () => {
    const html = renderHtml({ ...VERSION, orientation: 'landscape' }, {});
    assert.match(html, /@page \{ size: 297mm 210mm/);
  });

  test('a background image is embedded only for a genuine base64 raster', () => {
    const withBackground = {
      ...VERSION,
      styleConfig: { ...VERSION.styleConfig, background: { type: 'image', s3Key: 'x' } },
    };
    const good = renderHtml(withBackground, {}, { backgroundDataUri: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.match(good, /background-image:url\('data:image\/png;base64,iVBORw0KGgo='\)/);

    // Anything that is not a plain base64 raster is ignored, so a malformed or
    // hostile value cannot break out of the CSS declaration.
    const bad = renderHtml(withBackground, {}, { backgroundDataUri: "url('x');}</style><script>alert(1)</script>" });
    assert.doesNotMatch(bad, /<script>alert/);
    assert.doesNotMatch(bad, /background-image/);
  });

  test('the title is escaped too', () => {
    const html = renderHtml(VERSION, {}, { title: '<b>x</b>' });
    assert.match(html, /<title>&lt;b&gt;x&lt;\/b&gt;<\/title>/);
  });
});

describe('renderHtml — image elements', () => {
  const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

  test('an image element embeds the resolved asset', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'logo', type: 'IMAGE', asset: 'logo.png', x: 10, y: 10, width: 30, height: 30, zIndex: 0 }] },
      {},
      { assets: { 'logo.png': LOGO } }
    );
    assert.match(html, /<img src="data:image\/png;base64,iVBORw0KGgo="/);
    assert.match(html, /object-fit:contain/);
  });

  test('an image whose file is missing prints nothing (never a broken box)', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'logo', type: 'IMAGE', asset: 'gone.png' }] },
      {},
      { assets: {} }
    );
    assert.doesNotMatch(html, /<img/);
  });

  test('an image element with no asset set prints nothing', () => {
    const html = renderHtml({ ...VERSION, fields: [{ key: 'logo', type: 'IMAGE', asset: '' }] }, {}, { assets: { 'x.png': LOGO } });
    assert.doesNotMatch(html, /<img/);
  });

  test('a non-image data URI is refused', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'logo', type: 'IMAGE', asset: 'evil.png' }] },
      {},
      { assets: { 'evil.png': 'data:text/html;base64,PHNjcmlwdD4=' } }
    );
    assert.doesNotMatch(html, /<img/);
  });
});

describe('renderHtml — rule elements', () => {
  test('a line renders as a border whose width is its thickness', () => {
    const html = renderHtml(
      { ...VERSION, fields: [{ key: 'rule', type: 'LINE', x: 20, y: 50, width: 170, height: 0.5, color: '#1f3288' }] },
      {}
    );
    assert.match(html, /border-top:0\.5mm solid #1f3288/);
    assert.match(html, /height:0/);
  });

  test('a line needs no value', () => {
    const html = renderHtml({ ...VERSION, fields: [{ key: 'rule', type: 'LINE', width: 100 }] }, {});
    assert.match(html, /border-top:/);
  });
});

describe('renderHtml — box elements', () => {
  test('a box draws its border without needing a value', () => {
    const html = renderHtml(
      {
        ...VERSION,
        fields: [{ key: 'frame', type: 'BOX', x: 0, y: 0, width: 210, height: 297, borderWidth: 0.5, borderColor: '#1f3288' }],
      },
      {}
    );
    assert.match(html, /class="doc-field"/);
    assert.match(html, /left:0mm/);
    assert.match(html, /width:210mm/);
    assert.match(html, /height:297mm/);
    assert.match(html, /border:0\.5mm solid #1f3288/);
  });

  test('a shaded box needs no border', () => {
    const html = renderHtml({ ...VERSION, fields: [{ key: 'band', type: 'BOX', backgroundColor: '#eef4ff' }] }, {});
    assert.match(html, /background-color:#eef4ff/);
    assert.doesNotMatch(html, /border:/);
  });
});

describe('renderHtml — draw order', () => {
  test('elements are painted in z order, so "bring to front" wins in the PDF too', () => {
    const html = renderHtml(
      {
        ...VERSION,
        fields: [
          { key: 'front', type: 'STATIC', zIndex: 5 },
          { key: 'back', type: 'STATIC', zIndex: 1 },
        ],
      },
      { front: 'FRONT', back: 'BACK' }
    );
    assert.ok(html.indexOf('BACK') < html.indexOf('FRONT'), 'the lower z-index must be rendered first');
    assert.match(html, /z-index:5/);
  });
});

describe('renderHtml — Word-like styling', () => {
  const text = (overrides) => renderHtml(
    { ...VERSION, fields: [{ key: 'a', type: 'STATIC', ...overrides }] },
    { a: 'Hello' }
  );

  test('font family, size and colour are applied', () => {
    const html = text({ fontFamily: 'Georgia, serif', fontSize: 18, color: '#2038ab' });
    assert.match(html, /font-family:Georgia, serif/);
    assert.match(html, /font-size:18pt/);
    assert.match(html, /color:#2038ab/);
  });

  test('underline and strikethrough combine into one text-decoration', () => {
    assert.match(text({ underline: true }), /text-decoration:underline/);
    assert.match(text({ strikethrough: true }), /text-decoration:line-through/);
    assert.match(text({ underline: true, strikethrough: true }), /text-decoration:underline line-through/);
  });

  test('line height and character spacing are applied', () => {
    const html = text({ lineHeight: 1.5, letterSpacing: 2 });
    assert.match(html, /line-height:1\.5/);
    assert.match(html, /letter-spacing:2pt/);
  });

  test('a highlight is shaded, and an empty one is not', () => {
    assert.match(text({ backgroundColor: '#fff3bf' }), /background-color:#fff3bf/);
    assert.doesNotMatch(text({ backgroundColor: '' }), /background-color/);
  });

  test('borders and shading render on any element', () => {
    const bordered = text({ borderWidth: 0.5, borderStyle: 'dashed', borderColor: '#dc2626', borderRadius: 2 });
    assert.match(bordered, /border:0\.5mm dashed #dc2626/);
    assert.match(bordered, /border-radius:2mm/);
  });

  test('a zero-width or "none" border is not drawn at all', () => {
    assert.doesNotMatch(text({ borderWidth: 0, borderStyle: 'solid' }), /border:/);
    assert.doesNotMatch(text({ borderWidth: 0.5, borderStyle: 'none' }), /border:/);
  });

  test('an image element can carry a border and a highlight too', () => {
    const html = renderHtml(
      {
        ...VERSION,
        fields: [{ key: 'logo', type: 'IMAGE', asset: 'logo.png', borderWidth: 1, borderColor: '#111111', backgroundColor: '#f1f5f9' }],
      },
      {},
      { assets: { 'logo.png': 'data:image/png;base64,iVBORw0KGgo=' } }
    );
    assert.match(html, /border:1mm solid #111111/);
    assert.match(html, /background-color:#f1f5f9/);
  });
});

describe('renderHtml — table elements', () => {
  const TABLE = {
    key: 'info', type: 'TABLE', x: 20, y: 40, width: 150, height: 45, fontSize: 11, borderWidth: 0.25,
    table: {
      rows: 2, cols: 3, headerRow: true, headerBackground: '#f1f5f9', cellPadding: 1.5,
      columnWidths: [1, 1, 1], rowHeights: [1, 1],
      cells: ['Name', 'ID', 'Batch', '', '', ''],
      cellSources: ['', '', '', 'student.name', 'student.studentId', 'student.batch'],
    },
  };

  test('draws a real table with one cell per row × col', () => {
    const html = renderHtml({ ...VERSION, fields: [TABLE] }, {});
    assert.match(html, /<table class="doc-table"/);
    assert.equal((html.match(/<col /g) || []).length, 3);
    assert.equal((html.match(/<td /g) || []).length, 6);
    assert.match(html, />Name</);
    assert.match(html, /left:20mm/);
    assert.match(html, /width:150mm/);
  });

  test('the resolved grid fills the cells, official sources included', () => {
    const values = { info: JSON.stringify([['Name', 'ID', 'Batch'], ['Rahim', '221', 'CSE-1']]) };
    const html = renderHtml({ ...VERSION, fields: [TABLE] }, values);
    assert.match(html, />Rahim</);
    assert.match(html, />CSE-1</);
  });

  test('a header row is shaded and bold', () => {
    const html = renderHtml({ ...VERSION, fields: [TABLE] }, {});
    assert.match(html, /background-color:#f1f5f9/);
    assert.match(html, /font-weight:700/);
  });

  test('cell text cannot inject markup', () => {
    const values = { info: JSON.stringify([['<script>alert(1)</script>']]) };
    const html = renderHtml({ ...VERSION, fields: [TABLE] }, values);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('borders are drawn on the cells, never doubled on the wrapper', () => {
    const html = renderHtml({ ...VERSION, fields: [TABLE] }, {});
    assert.match(html, /<td style="border:0\.25mm solid #111111/);
    // The wrapper div's own style attribute carries no border declaration.
    assert.doesNotMatch(html, /doc-field" style="[^"]*border:/);
  });

  test('a table with no grid draws nothing', () => {
    const html = renderHtml({ ...VERSION, fields: [{ key: 't', type: 'TABLE' }] }, {});
    assert.doesNotMatch(html, /<table/);
  });
});
