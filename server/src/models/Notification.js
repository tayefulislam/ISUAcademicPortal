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

  // Class routine. The offsets share a settings toggle but must not share an
  // idempotency row: the notification id is {recipient,type,entityType,entityId,slot},
  // and `slot` carries the offset plus the occurrence's effective start instant —
  // see services/reminderService.js. So "starts in 30 minutes" and "starts in 10
  // minutes" for the same occurrence are two rows, and a class that is moved gets
  // a fresh reminder for its new time instead of colliding with the old one.
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

  // Content moderation (the Report/Flag system). CONTENT_REPORTED goes to the
  // moderators (CR/Admin/Administrator/Super Admin); REPORT_UPDATE goes back to
  // the reporter when a moderator changes their report's status.
  'CONTENT_REPORTED',
  'REPORT_UPDATE',

  // A generated document (cover page etc.) finished rendering and is ready to
  // download. Carries the document id, never a URL — the client asks for a fresh
  // signed URL after authorization.
  'DOCUMENT_READY',

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

    // A further discriminator within one (recipient, type, entity) — currently
    // only class/exam reminders use it, to tell one reminder offset apart from
    // another and to supersede an offset once the occurrence has moved. Empty
    // for everything else, which keeps those deduped exactly as before.
    slot: { type: String, default: '' },

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
//
// `slot` extends the same idea to recurring reminders, where one entity
// legitimately produces several notifications over time: the offset is part of
// its value, so re-running a cron tick inside the same window is still a no-op
// while a moved occurrence produces a new row rather than being swallowed.
notificationSchema.index({ recipient: 1, type: 1, entityType: 1, entityId: 1, slot: 1 }, { unique: true });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
