import mongoose from 'mongoose';

export const LOG_LEVELS = ['info', 'warn', 'error'];

// Persisted counterpart to the app's console logging — every logger.error/
// warn/info call (see utils/logger.js) writes one of these, fire-and-forget,
// so Super Admin / Administrator can review what happened (and where)
// without SSH access to server stdout. `source` is a short label identifying
// the code path that logged it (e.g. 'errorHandler', 'app:syncIndexes'),
// not a strict enum — new call sites don't need a schema change.
const logSchema = new mongoose.Schema(
  {
    level: { type: String, enum: LOG_LEVELS, default: 'info' },
    message: { type: String, required: true },
    source: { type: String, default: '' },
    stack: { type: String, default: '' },
    statusCode: { type: Number, default: null },
    method: { type: String, default: '' },
    url: { type: String, default: '' },
    ip: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userAgent: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

logSchema.index({ level: 1, createdAt: -1 });
logSchema.index({ createdAt: -1 });

export default mongoose.model('Log', logSchema);
