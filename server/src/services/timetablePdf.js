import { PdfDocument, BLACK, GREY } from '../utils/pdfWriter.js';

// Renders the weekly grid: days across the top, class-time slots down the side,
// and each class sitting in its day/slot cell.
//
// Landscape A4, because a timetable is wide and short. The grid is drawn from
// the top down; a row that does not fit starts a new page and repeats the column
// header, so a slot is never split across a page break.

const HEADER_FILL = [0.93, 0.95, 0.97];
const ROW_FILL = [0.98, 0.985, 0.99];
const GRID = [0.78, 0.81, 0.85];
const BORDER = [0.55, 0.6, 0.66];

const TIME_COLUMN_WIDTH = 104;
const HEADER_HEIGHT = 22;
const LINE_HEIGHT = 9.4;
const CELL_PADDING = 5;
const MAX_CLASSES_PER_CELL = 3;

/** "Rm 301 - A. Rahim" (plus a group, when the class is for only part of a batch). */
function cellDetail(entry) {
  const where = entry.roomNumber
    ? `Rm ${entry.roomNumber}`
    : entry.deliveryMode === 'ONLINE' || entry.deliveryMode === 'HYBRID'
      ? 'Online'
      : '';
  const parts = [where, entry.facultyName].filter(Boolean);
  if (entry.group && entry.group !== 'BOTH') {
    parts.push(`Grp ${entry.group}`);
  }
  return parts.join(' - ');
}

/** The number of text lines a cell needs (two per class, plus an overflow line). */
function cellLines(entries) {
  if (!entries || !entries.length) return 0;
  const shown = Math.min(entries.length, MAX_CLASSES_PER_CELL);
  const overflow = entries.length > shown ? 1 : 0;
  return shown * 2 + overflow;
}

function scopeLine(scope) {
  const parts = [];
  if (scope.department) {
    parts.push(scope.department.code
      ? `${scope.department.name} (${scope.department.code})`
      : scope.department.name);
  }
  parts.push(scope.batch ? `Batch ${scope.batch.code || scope.batch.name}` : 'All batches');
  parts.push(scope.semester ? scope.semester.name : 'All semesters');
  return parts.filter(Boolean).join('  -  ');
}

function generatedLine(timetable) {
  const stamp = timetable.generatedAt.toLocaleString('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const classes = timetable.classCount === 1 ? '1 class' : `${timetable.classCount} classes`;
  return `Generated ${stamp} (Asia/Dhaka)  -  ${classes}`;
}

export function renderTimetablePdf(timetable) {
  const doc = new PdfDocument({ landscape: true, margin: 32 });
  const { days, slots, cells } = timetable;

  const left = doc.margin;
  const right = doc.width - doc.margin;
  const contentWidth = right - left;
  const dayColumnWidth = days.length
    ? (contentWidth - TIME_COLUMN_WIDTH) / days.length
    : contentWidth - TIME_COLUMN_WIDTH;

  const bottomLimit = doc.height - doc.margin - 18;

  // ----- Header block (first page only) -----
  doc.text('CLASS ROUTINE', doc.width / 2, 52, { size: 17, bold: true, align: 'center' });
  doc.text(scopeLine(timetable.scope), doc.width / 2, 70, { size: 11, align: 'center', color: BLACK });
  doc.text(generatedLine(timetable), doc.width / 2, 84, { size: 7.5, align: 'center', color: GREY });

  let y = 100;

  const drawColumnHeader = () => {
    doc.rect(left, y, contentWidth, HEADER_HEIGHT, { fill: HEADER_FILL, stroke: GRID, lineWidth: 0.5 });
    doc.text('CLASS TIME', left + CELL_PADDING, y + 14, { size: 8, bold: true });
    days.forEach((day, i) => {
      const cellX = left + TIME_COLUMN_WIDTH + i * dayColumnWidth;
      doc.line(cellX, y, cellX, y + HEADER_HEIGHT, { color: GRID, width: 0.5 });
      doc.text(day.short, cellX + dayColumnWidth / 2, y + 14, { size: 8.5, bold: true, align: 'center' });
    });
    y += HEADER_HEIGHT;
  };

  drawColumnHeader();

  if (!slots.length) {
    doc.text('No classes are scheduled for this scope yet.', doc.width / 2, y + 26, {
      size: 10,
      align: 'center',
      color: GREY,
    });
  }

  // ----- One row per time slot -----
  slots.forEach((slot, slotIndex) => {
    const perDay = days.map((day) => cells.get(`${day.index}|${slot.key}`) || []);
    const lines = Math.max(1, ...perDay.map(cellLines));
    const rowHeight = CELL_PADDING * 2 + lines * LINE_HEIGHT;

    // Start a new page when the row would not fit, repeating the header so the
    // table can be read on its own.
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = doc.margin;
      drawColumnHeader();
    }

    if (slotIndex % 2 === 1) {
      doc.rect(left, y, contentWidth, rowHeight, { fill: ROW_FILL });
    }
    doc.rect(left, y, TIME_COLUMN_WIDTH, rowHeight, { fill: HEADER_FILL });
    doc.rect(left, y, contentWidth, rowHeight, { stroke: GRID, lineWidth: 0.5 });

    doc.text(slot.label, left + CELL_PADDING, y + CELL_PADDING + LINE_HEIGHT - 1.5, {
      size: 8,
      bold: true,
      maxWidth: TIME_COLUMN_WIDTH - CELL_PADDING * 2,
    });

    perDay.forEach((entries, dayIndex) => {
      const cellX = left + TIME_COLUMN_WIDTH + dayIndex * dayColumnWidth;
      doc.line(cellX, y, cellX, y + rowHeight, { color: GRID, width: 0.5 });
      if (!entries.length) return;

      const textX = cellX + CELL_PADDING;
      const maxTextWidth = dayColumnWidth - CELL_PADDING * 2;
      let lineY = y + CELL_PADDING + LINE_HEIGHT - 1.5;

      entries.slice(0, MAX_CLASSES_PER_CELL).forEach((entry) => {
        doc.text(entry.courseCode || entry.courseName || 'Class', textX, lineY, {
          size: 8,
          bold: true,
          maxWidth: maxTextWidth,
        });
        doc.text(cellDetail(entry), textX, lineY + LINE_HEIGHT, {
          size: 7,
          color: GREY,
          maxWidth: maxTextWidth,
        });
        lineY += LINE_HEIGHT * 2;
      });

      const hidden = entries.length - MAX_CLASSES_PER_CELL;
      if (hidden > 0) {
        doc.text(`+${hidden} more`, textX, lineY, { size: 7, color: GREY, maxWidth: maxTextWidth });
      }
    });

    y += rowHeight;
  });

  // ----- Footers, now that the page count is known -----
  const total = doc.pageCount;
  for (let i = 0; i < total; i += 1) {
    doc.selectPage(i);
    const footerY = doc.height - doc.margin + 4;
    doc.line(left, footerY, right, footerY, { color: GRID, width: 0.5 });
    doc.text('ISU Academic Portal - Class Routine', left, footerY + 10, { size: 7, color: GREY });
    doc.text(`Page ${i + 1} of ${total}`, right, footerY + 10, { size: 7, color: GREY, align: 'right' });
  }
  doc.selectPage(total - 1);

  return doc.toBuffer();
}
