import mongoose from 'mongoose';

export const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'];
export const TEMPLATE_AUDIENCES = ['student', 'faculty'];

// The template's identity and eligibility rules — the things an admin edits in
// place (name, who it is for, which department/course it covers, active or not).
//
// The *design* (fields, page size, source file) lives on DocumentTemplateVersion
// instead, because that is the part that must never change under a document that
// has already been generated. Splitting the two is what lets an admin fix a
// typo in a name or widen a department scope without creating a new version,
// while a change to the page itself always does.
const documentTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // The DocumentCategory key — a free string rather than an enum so a
    // newly-added category is immediately usable.
    category: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },

    // Empty array means "All Departments" (the spec's default for a general
    // cover). A non-empty array narrows the template to exactly those
    // departments. Same idea for courseId: null means "every course in scope".
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    availableFor: [{ type: String, enum: TEMPLATE_AUDIENCES }],

    pageSize: { type: String, default: 'A4' },
    orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },

    // DRAFT/INACTIVE templates are never offered to students — see eligibility.js.
    status: { type: String, enum: TEMPLATE_STATUSES, default: 'DRAFT' },
    // Points at the newest DocumentTemplateVersion. Only ever moved forward.
    currentVersion: { type: Number, default: 1 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

documentTemplateSchema.index({ category: 1, status: 1 });
documentTemplateSchema.index({ departmentIds: 1, status: 1 });
documentTemplateSchema.index({ courseId: 1 });

export default mongoose.model('DocumentTemplate', documentTemplateSchema);
