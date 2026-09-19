// The geometry behind dragging a resize grip. Pure, so the edge cases that are
// easy to get subtly wrong — the pinned edge, the minimum size, the aspect lock,
// the fine step — can be tested without a browser.

export const MIN_WIDTH_MM = 5;
export const MIN_HEIGHT_MM = 2;
/** A rule's `height` is its thickness, so it needs a sub-millimetre floor. */
export const MIN_THICKNESS_MM = 0.1;

const roundTo = (value, step) => Math.round(value / step) * step;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// `1103 * 0.1` is 110.30000000000001; a design should not store that, so every
// value is trimmed to three decimals (finer than the 0.1 mm step it can take).
const tidy = (value) => Math.round(value * 1000) / 1000;

/**
 * Applies a resize drag to a box.
 *
 * @param {{x:number,y:number,width:number,height:number}} box the box as it was when the drag started
 * @param {string} dir one of nw, n, ne, w, e, sw, s, se
 * @param {number} dx millimetres moved horizontally since the drag started
 * @param {number} dy millimetres moved vertically since the drag started
 * @param {{line?:boolean, keepShape?:boolean, fine?:boolean, pageWidth?:number, pageHeight?:number}} [options]
 *   `keepShape` (Shift on a corner) preserves the aspect ratio; `fine` (Ctrl)
 *   steps in 0.1 mm instead of 0.5 mm.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function resizeBox(box, dir, dx, dy, options = {}) {
  const {
    line = false,
    keepShape = false,
    fine = false,
    pageWidth = 210,
    pageHeight = 297,
  } = options;

  let { x, y } = box;
  let width = box.width;
  let height = box.height;

  // Each axis follows the edge being dragged; the OPPOSITE edge stays put, which
  // is what makes the grip feel attached to the corner you grabbed.
  if (dir.includes('e')) width = box.width + dx;
  if (dir.includes('w')) {
    width = box.width - dx;
    x = box.x + dx;
  }
  if (dir.includes('s')) height = box.height + dy;
  if (dir.includes('n')) {
    height = box.height - dy;
    y = box.y + dy;
  }

  // Never smaller than a usable element — and when dragging the top/left edge,
  // pin the opposite edge rather than letting the box slide.
  const minHeight = line ? MIN_THICKNESS_MM : MIN_HEIGHT_MM;
  if (width < MIN_WIDTH_MM) {
    if (dir.includes('w')) x = box.x + (box.width - MIN_WIDTH_MM);
    width = MIN_WIDTH_MM;
  }
  if (height < minHeight) {
    if (dir.includes('n')) y = box.y + (box.height - minHeight);
    height = minHeight;
  }

  // Shift on a corner keeps the shape — so a logo stays square.
  if (keepShape && dir.length === 2 && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    if (width / height > ratio) {
      width = height * ratio;
      if (dir.includes('w')) x = box.x + (box.width - width);
    } else {
      height = width / ratio;
      if (dir.includes('n')) y = box.y + (box.height - height);
    }
  }

  const step = fine ? 0.1 : 0.5;
  return {
    x: tidy(clamp(roundTo(x, step), 0, pageWidth)),
    y: tidy(clamp(roundTo(y, step), 0, pageHeight)),
    width: tidy(Math.max(MIN_WIDTH_MM, Math.min(pageWidth - x, roundTo(width, step)))),
    height: tidy(Math.max(minHeight, Math.min(pageHeight - y, roundTo(height, step)))),
  };
}

export default { resizeBox };
