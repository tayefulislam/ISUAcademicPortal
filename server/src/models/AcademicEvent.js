import mongoose from 'mongoose';
import { GROUP_BOTH } from './Settings.js';
import { CLASS_TYPES, DELIVERY_MODES, EVENT_TYPES, eventTypeForClassType } from '../utils/academicEventTypes.js';
import { isDateOnly, isTimeOnly, normalizeTime, combineDhakaDateTime } from '../utils/academicSchedule.js';

// A one-off dated academic event: a CT, a mid-term, a final, a quiz, an
// assignment deadline or a general event. Unlike a class it has no recurring
// rule behind it, so there is no template/instance split — this document *is*
// the occurrence.
//
// `eventType` (CLASS | EXAM | DEADLINE | EVENT) is derived from `classType`
// rather than accepted from the client: the two are separate concepts for
// filtering and iconography, but a caller only ever supplies the specific one,
// so they cannot drift apart.

const academicEventSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },

    group: { type: String, default: GROUP_BOTH, uppercase: true, trim: true },

    title: { type: String, required: true, trim: true },

    eventType: { type: String, enum: EVENT_TYPES, default: 'EVENT' },
    classType: { type: String, enum: CLASS_TYPES, default: 'OTHER' },

    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    roomNumber: { type: String, default: '', trim: true },

    date: { type: String, required: true, trim: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },

    instructions: { type: String, default: '', trim: true },

    deliveryMode: { type: String, enum: DELIVERY_MODES, default: 'OFFLINE' },
    onlineLink: { type: String, default: '', trim: true },

    // An exam can be called off without being deleted, so the calendar keeps
    // showing that it was scheduled and cancelled.
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

academicEventSchema.pre('validate', function normalize(next) {
  if (this.startTime) this.startTime = normalizeTime(this.startTime);
  if (this.endTime) this.endTime = normalizeTime(this.endTime);

  if (!isDateOnly(this.date)) this.invalidate('date', 'date must be YYYY-MM-DD');
  if (!isTimeOnly(this.startTime)) this.invalidate('startTime', 'startTime must be HH:mm');
  if (!isTimeOnly(this.endTime)) this.invalidate('endTime', 'endTime must be HH:mm');

  if (isDateOnly(this.date) && isTimeOnly(this.startTime) && isTimeOnly(this.endTime)) {
    if (this.endTime <= this.startTime) this.invalidate('endTime', 'endTime must be after startTime');
    this.startAt = combineDhakaDateTime(this.date, this.startTime);
    this.endAt = combineDhakaDateTime(this.date, this.endTime);
  }

  if (this.classType) this.eventType = eventTypeForClassType(this.classType);

  if (this.deliveryMode !== 'OFFLINE' && !this.onlineLink) {
    this.invalidate('onlineLink', 'An online link is required for an online or hybrid event');
  }
  next();
});

// Same audience axes as a routine instance, so the calendar service can run one
// shaped query against both collections.
academicEventSchema.index({ department: 1, batch: 1, semester: 1, group: 1, startAt: 1 });
academicEventSchema.index({ faculty: 1, startAt: 1 });
academicEventSchema.index({ course: 1, startAt: 1 });
// The exam-reminder scan.
academicEventSchema.index({ status: 1, startAt: 1 });

export default mongoose.model('AcademicEvent', academicEventSchema);
