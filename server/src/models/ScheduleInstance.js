import mongoose from 'mongoose';
import { GROUP_BOTH } from './Settings.js';
import { CLASS_TYPES, DELIVERY_MODES, INSTANCE_STATUSES } from '../utils/academicEventTypes.js';
import { isDateOnly, isTimeOnly, normalizeTime, combineDhakaDateTime } from '../utils/academicSchedule.js';

// One dated occurrence of a class — the thing a student actually sees on a
// given day, and the thing a reminder is fired against. Either materialised
// from a RoutineTemplate (recurring) or created on its own (a one-off).
//
// Materialising is what makes exceptions cheap: cancelling 4 October, or moving
// it to Tuesday, writes to that one instance and leaves the recurring rule and
// every other week untouched.

const scheduleInstanceSchema = new mongoose.Schema(
  {
    // Null for a one-off entry that has no recurring rule behind it.
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutineTemplate', default: null },

    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },

    group: { type: String, default: GROUP_BOTH, uppercase: true, trim: true },

    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    roomNumber: { type: String, default: '', trim: true },

    // Dhaka calendar date, plus the queryable UTC instants for that date.
    date: { type: String, required: true, trim: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },

    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },

    classType: { type: String, enum: CLASS_TYPES, default: 'REGULAR' },
    deliveryMode: { type: String, enum: DELIVERY_MODES, default: 'OFFLINE' },
    onlineLink: { type: String, default: '', trim: true },

    status: { type: String, enum: INSTANCE_STATUSES, default: 'NORMAL' },

    // Set when this occurrence is moved, so the original slot stays visible in
    // the audit trail ("moved from Sunday 10:00").
    originalStartAt: { type: Date, default: null },
    originalStartTime: { type: String, default: '' },
    originalRoomNumber: { type: String, default: '' },

    note: { type: String, default: '', trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

scheduleInstanceSchema.pre('validate', function normalize(next) {
  if (this.startTime) this.startTime = normalizeTime(this.startTime);
  if (this.endTime) this.endTime = normalizeTime(this.endTime);

  if (!isDateOnly(this.date)) this.invalidate('date', 'date must be YYYY-MM-DD');
  if (!isTimeOnly(this.startTime)) this.invalidate('startTime', 'startTime must be HH:mm');
  if (!isTimeOnly(this.endTime)) this.invalidate('endTime', 'endTime must be HH:mm');

  if (isDateOnly(this.date) && isTimeOnly(this.startTime) && isTimeOnly(this.endTime)) {
    if (this.endTime <= this.startTime) this.invalidate('endTime', 'endTime must be after startTime');
    // Derive the instants from the Dhaka wall-clock rather than trusting a
    // client-supplied Date, so every instance is on the institution's clock.
    this.startAt = combineDhakaDateTime(this.date, this.startTime);
    this.endAt = combineDhakaDateTime(this.date, this.endTime);
  }

  if (this.deliveryMode !== 'OFFLINE' && !this.onlineLink) {
    this.invalidate('onlineLink', 'An online link is required for an online or hybrid class');
  }
  next();
});

// The four audience axes + the time window: every "my routine" and "what is on
// room 501 today" query starts here, so the index leads with the axes that
// narrow the scan hardest.
scheduleInstanceSchema.index({ department: 1, batch: 1, semester: 1, group: 1, startAt: 1 });
// A faculty member's own timetable, and the faculty-conflict check.
scheduleInstanceSchema.index({ faculty: 1, startAt: 1 });
scheduleInstanceSchema.index({ course: 1, startAt: 1 });
// The reminder scan: everything starting in a window, regardless of audience.
scheduleInstanceSchema.index({ status: 1, startAt: 1 });
// One occurrence per template per date — guards the generator against running
// twice and duplicating a series.
scheduleInstanceSchema.index(
  { template: 1, date: 1 },
  { unique: true, partialFilterExpression: { template: { $type: 'objectId' } } }
);

export default mongoose.model('ScheduleInstance', scheduleInstanceSchema);
