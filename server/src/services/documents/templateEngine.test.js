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
