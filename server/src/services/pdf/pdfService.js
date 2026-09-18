import { chromium } from 'playwright';
import { env } from '../../config/env.js';

// One Chromium for the whole process, launched on first use and reused for every
// render — starting a browser per document would dominate the cost of a page
// that is a single A4 sheet. The promise is cached (not the resolved browser) so
// two jobs racing at startup share one launch instead of starting two.
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        // --no-sandbox is required in most containers, where the browser cannot
        // use the kernel's sandbox; --disable-dev-shm-usage avoids /dev/shm
        // exhaustion, which is the usual cause of a mysterious mid-render crash
        // on a small container.
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        executablePath: env.documents.chromiumPath || undefined,
      })
      .catch((error) => {
        // Do not cache a failed launch — the next attempt should try again.
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

/**
 * Renders one HTML document to an A4 PDF buffer.
 *
 * `preferCSSPageSize` makes the @page size the template declares win, so the
 * geometry the admin positioned on the canvas is the geometry that is printed.
 *
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    const maxBytes = env.documents.maxPdfMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`The generated PDF is larger than the ${env.documents.maxPdfMb} MB limit`);
    }
    return buffer;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Closes the shared browser on shutdown so the process can exit cleanly. */
export async function closePdfBrowser() {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  if (browser) await browser.close().catch(() => {});
}

export default { renderPdf, closePdfBrowser };
