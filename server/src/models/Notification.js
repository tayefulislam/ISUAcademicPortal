import mongoose from 'mongoose';

// Extensible on purpose — adding a new kind of notification later is just:
// add its key here + one entry in services/notifications/notificationTemplates.js.
export const NOTIFICATION_TYPES = [
  'FILE_UPLOADED',
  'FILE_UPDATED',

  'COURSE_MATERIAL',
  'ASSIGNMENT_CREATED',
  'ASSIGNMENT_UPDATED',
  'ASSIGNMENT_SUBMITTED',
  'ASSIGNMENT_RESULT',

  'EXAM_CREATED',
  'EXAM_UPDATED',
  'EXAM_REMINDER',
  'EXAM_RESULT',

  // Class routine. Each reminder offset is its own type, not just its own
  // message: the idempotency index is {recipient,type,entityType,entityId}, so
  // the type is the only thing that keeps "starts in 30 minutes" and "starts
  // now" for the SAME occurrence from collapsing into one row.
  'CLASS_REMINDER',
  'CLASS_STARTING',
  'CLASS_CANCELLED',
  'CLASS_RESCHEDULED',
  'CLASS_ROOM_CHANGED',

  'NOTICE_CREATED',
  'NOTICE_UPDATED',

  'GRADE_PUBLISHED',
  'RESULT_PUBLISHED',

  'MESSAGE_RECEIVED',

  'COURSE_ENROLLED',
  'COURSE_UPDATED',

  'JOIN_REQUEST',
  'JOIN_REQUEST_APPROVED',

  'STUDENT_ID_APPROVED',
  'STUDENT_ID_REJECTED',

  'SYSTEM',
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // null for system-generated events (e.g. auto-graded exam results).
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    // What triggered this notification — lets the client route/render
    // without a second lookup, and lets the idempotency key (below) work
    // for any entity kind without a dedicated field per type.
    entityType: { type: String, default: '' },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },

    // Internal app route the client navigates to on click — never an
    // absolute/external URL, and access is re-checked by that route's own
    // existing authorization when it loads (see recipientResolver.js).
    url: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Idempotency: the same event for the same recipient must never create a
// second row (spec: prevent duplicates on a retried request). A regrade or
// re-upload reusing the same entityId is treated as "already notified" —
// an acceptable simplification; update flows use FILE_UPDATED/EXAM_UPDATED
// (a different `type`) so a genuine update still gets through.
notificationSchema.index({ recipient: 1, type: 1, entityType: 1, entityId: 1 }, { unique: true });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
