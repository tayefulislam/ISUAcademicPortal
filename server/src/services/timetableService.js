import mongoose from 'mongoose';
import Department from '../models/Department.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import RoutineTemplate from '../models/RoutineTemplate.js';
import { ApiError } from '../utils/ApiError.js';
import { dhakaDateString } from '../utils/academicSchedule.js';

// The weekly class routine for one Department + Batch + Semester.
//
// The source is the ACTIVE recurring rules (RoutineTemplate) rather than the
// dated instances: a routine is the recurring pattern, and the rules carry it
// exactly — days, times, course, faculty, room. A single date that was moved or
// cancelled is a change to one occurrence, not to the timetable, so it belongs
// on the calendar rather than on the printed routine.

/** 0 = Sunday … 6 = Saturday, matching the model and the routine manager. */
export const DAY_NAMES = [
  { index: 0, short: 'SUN', long: 'Sunday' },
  { index: 1, short: 'MON', long: 'Monday' },
  { index: 2, short: 'TUE', long: 'Tuesday' },
  { index: 3, short: 'WED', long: 'Wednesday' },
  { index: 4, short: 'THU', long: 'Thursday' },
  { index: 5, short: 'FRI', long: 'Friday' },
  { index: 6, short: 'SAT', long: 'Saturday' },
];

/** "08:00" -> "08:00 AM"; kept local so the PDF never depends on the host's locale. */
export function formatClock(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
  if (!match) return String(time ?? '');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  // Anything that is not a real clock time is passed straight through rather
  // than being turned into a plausible-looking wrong one.
  if (hours > 23 || minutes > 59) return String(time ?? '');
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

async function loadScope({ departmentId, batchId, semesterId }) {
  if (!departmentId || !mongoose.isValidObjectId(departmentId)) {
    throw new ApiError(400, 'A valid department is required');
  }
  if (batchId && !mongoose.isValidObjectId(batchId)) {
    throw new ApiError(400, 'Invalid batch');
  }
  if (semesterId && !mongoose.isValidObjectId(semesterId)) {
    throw new ApiError(400, 'Invalid semester');
  }

  const [department, batch, semester] = await Promise.all([
    Department.findById(departmentId).select('name code'),
    batchId ? Batch.findById(batchId).select('name code') : null,
    semesterId ? Semester.findById(semesterId).select('name code') : null,
  ]);

  if (!department) throw new ApiError(404, 'Department not found');
  if (batchId && !batch) throw new ApiError(404, 'Batch not found');
  if (semesterId && !semester) throw new ApiError(404, 'Semester not found');

  return { department, batch, semester };
}

/**
 * Builds the grid: days across the top, class-time slots down the side, and the
 * classes sitting in each cell.
 *
 * @returns {Promise<{
 *   scope: {department, batch, semester},
 *   days: {index:number, short:string, long:string}[],
 *   slots: {start:string, end:string, label:string}[],
 *   cells: Map<string, object[]>,
 *   classCount: number,
 *   generatedAt: Date,
 * }>}
 */
export async function buildTimetable({ departmentId, batchId, semesterId }) {
  const { department, batch, semester } = await loadScope({ departmentId, batchId, semesterId });

  const filter = { status: 'ACTIVE', department: department._id };
  if (batch) filter.batch = batch._id;
  if (semester) filter.semester = semester._id;
  // A rule whose window has already closed is no longer part of the routine.
  filter.endDate = { $gte: dhakaDateString() };

  const templates = await RoutineTemplate.find(filter)
    .populate('course', 'name courseId')
    .populate('faculty', 'name')
    .sort({ startTime: 1 });

  const dayIndexes = new Set();
  const slotMap = new Map();
  const cells = new Map();
  let classCount = 0;

  for (const template of templates) {
    const slotKey = `${template.startTime}-${template.endTime}`;
    if (!slotMap.has(slotKey)) {
      slotMap.set(slotKey, { start: template.startTime, end: template.endTime });
    }

    const entry = {
      courseCode: template.course?.courseId || '',
      courseName: template.course?.name || '',
      facultyName: template.faculty?.name || '',
      roomNumber: template.roomNumber || '',
      classType: template.classType || 'REGULAR',
      deliveryMode: template.deliveryMode || 'OFFLINE',
      group: template.group || 'BOTH',
      onlineLink: template.onlineLink || '',
    };

    for (const day of template.days || []) {
      dayIndexes.add(day);
      const cellKey = `${day}|${slotKey}`;
      if (!cells.has(cellKey)) cells.set(cellKey, []);
      cells.get(cellKey).push(entry);
    }
    classCount += 1;
  }

  const days = DAY_NAMES.filter((day) => dayIndexes.has(day.index));
  const slots = [...slotMap.entries()]
    .map(([key, value]) => ({ key, ...value, label: `${formatClock(value.start)} - ${formatClock(value.end)}` }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  return {
    scope: { department, batch, semester },
    days: days.length ? days : DAY_NAMES.slice(0, 6),
    slots,
    cells,
    classCount,
    generatedAt: new Date(),
  };
}

/** A filesystem-safe file name for the scope, e.g. "routine-CSE-BATCH-14-2nd-Semester.pdf". */
export function timetableFileName({ department, batch, semester }) {
  const parts = ['routine', department?.code || department?.name];
  if (batch) parts.push(batch.code || batch.name);
  if (semester) parts.push(semester.name);
  const slug = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'routine'}.pdf`;
}
