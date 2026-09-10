import mongoose from 'mongoose';

export const NOTICE_TYPES = ['notice', 'announcement', 'update', 'exam', 'assignment'];
export const NOTICE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const noticeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    type: { type: String, enum: NOTICE_TYPES, default: 'notice' },
    priority: { type: String, enum: NOTICE_PRIORITIES, default: 'normal' },

    // At most one attachment — a notice is a message, not a material upload
    // (which already has its own richer flow). Reuses the same storage
    // pipeline (storageService.js) as everything else.
    attachmentUrl: { type: String, default: '' },
    attachmentName: { type: String, default: '' },
    storageProvider: { type: String, default: '' },
    storageRef: { type: String, default: '' },

    publishDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, default: null },

    // Targeting — `everyone: true` overrides the arrays. Otherwise a notice
    // is visible to a user if ANY targeted axis matches (unlike File
    // restrictions, which AND non-empty axes together — a notice is meant
    // to reach anyone in any of the listed groups, not the intersection).
    targeting: {
      everyone: { type: Boolean, default: false },
      departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
      courses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
      batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
      semesters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Semester' }],
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['draft', 'published'], default: 'published' },
  },
  { timestamps: true }
);

noticeSchema.index({ publishDate: -1 });
noticeSchema.index({ expiryDate: 1 });
noticeSchema.index({ 'targeting.departments': 1 });
noticeSchema.index({ 'targeting.batches': 1 });
noticeSchema.index({ 'targeting.courses': 1 });
noticeSchema.index({ 'targeting.semesters': 1 });

export default mongoose.model('Notice', noticeSchema);
