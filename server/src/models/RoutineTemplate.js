import mongoose from 'mongoose';
import { GROUP_BOTH } from './Settings.js';
import { CLASS_TYPES, DELIVERY_MODES } from '../utils/academicEventTypes.js';
import { isDateOnly, isTimeOnly, normalizeTime, weekdayOf, combineDhakaDateTime } from '../utils/academicSchedule.js';

// A recurring class rule: "CSE 101, every Sunday 10:00–11:30, Room 501, for
// Batch 14 / Semester 1 / Group A1, between these two dates". Materialising
// this into ScheduleInstance documents is what lets one date be cancelled or
// moved without disturbing the rest of the series.
//
// Nothing here denormalises a name — department/batch/semester/course/faculty
// are refs only, so a renamed course or a faculty member changing department
// updates every view at once.

export const TEMPLATE_STATUSES = ['ACTIVE', 'ARCHIVED'];

const routineTemplateSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },

    // Which slice of the batch this class is for. BOTH = the whole batch.
    group: { type: String, default: GROUP_BOTH, uppercase: true, trim: true },

    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    roomNumber: { type: String, default: '', trim: true },

    // 0 = Sunday … 6 = Saturday, matching JavaScript's getUTCDay().
    days: {
      type: [Number],
      required: true,
      validate: {
        validator: (days) => Array.isArray(days) && days.length > 0 && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'days must contain at least one weekday (0=Sunday … 6=Saturday)',
      },
    },

    // Dhaka wall-clock date range and times — see utils/academicSchedule.js.
    startDate: { type: String, required: true, trim: true },
    endDate: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },

    classType: { type: String, enum: CLASS_TYPES, default: 'REGULAR' },
    deliveryMode: { type: String, enum: DELIVERY_MODES, default: 'OFFLINE' },
    onlineLink: { type: String, default: '', trim: true },

    status: { type: String, enum: TEMPLATE_STATUSES, default: 'ACTIVE' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

routineTemplateSchema.pre('validate', function normalize(next) {
  if (this.startTime) this.startTime = normalizeTime(this.startTime);
  if (this.endTime) this.endTime = normalizeTime(this.endTime);

  if (!isDateOnly(this.startDate)) this.invalidate('startDate', 'startDate must be YYYY-MM-DD');
  if (!isDateOnly(this.endDate)) this.invalidate('endDate', 'endDate must be YYYY-MM-DD');
  if (!isTimeOnly(this.startTime)) this.invalidate('startTime', 'startTime must be HH:mm');
  if (!isTimeOnly(this.endTime)) this.invalidate('endTime', 'endTime must be HH:mm');

  if (isDateOnly(this.startDate) && isDateOnly(this.endDate) && this.endDate < this.startDate) {
    this.invalidate('endDate', 'endDate cannot be before startDate');
  }
  if (isTimeOnly(this.startTime) && isTimeOnly(this.endTime) && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'endTime must be after startTime');
  }
  // An ONLINE/HYBRID slot without a link is unusable in the UI.
  if (this.deliveryMode !== 'OFFLINE' && !this.onlineLink) {
    this.invalidate('onlineLink', 'An online link is required for an online or hybrid class');
  }
  next();
});

// The audience lookup every "what can this user see" query starts from.
routineTemplateSchema.index({ department: 1, batch: 1, semester: 1, group: 1, status: 1 });
routineTemplateSchema.index({ faculty: 1, status: 1 });
routineTemplateSchema.index({ course: 1, status: 1 });

/** The weekday of the first occurrence on/after startDate — used by the generator. */
routineTemplateSchema.methods.matchesDate = function matchesDate(dateStr) {
  return this.days.includes(weekdayOf(dateStr));
};

/** The UTC instant of this rule's window on a given date. */
routineTemplateSchema.methods.windowFor = function windowFor(dateStr) {
  return {
    startAt: combineDhakaDateTime(dateStr, this.startTime),
    endAt: combineDhakaDateTime(dateStr, this.endTime),
  };
};

export default mongoose.model('RoutineTemplate', routineTemplateSchema);
