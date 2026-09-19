import fs from 'fs/promises';
import mongoose from 'mongoose';
import DocumentCategory from '../models/DocumentCategory.js';
import DocumentTemplate from '../models/DocumentTemplate.js';
import DocumentTemplateVersion from '../models/DocumentTemplateVersion.js';
import { normalizeFields } from '../services/documents/normalizeFields.js';
import { storeTemplateSource } from '../services/storage/storageService.js';

// The six categories the module ships with. They are rows, not an enum, so an
// admin can add a seventh through the UI with no code change — this is just a
// starting set.
export const DEFAULT_CATEGORIES = [
  { key: 'experiment', name: 'Experiment', icon: 'flask-conical', order: 1 },
  { key: 'lab_report', name: 'Lab Report', icon: 'clipboard-list', order: 2 },
  { key: 'assignment', name: 'Assignment', icon: 'file-text', order: 3 },
  { key: 'project', name: 'Project', icon: 'folder-kanban', order: 4 },
  { key: 'presentation', name: 'Presentation', icon: 'presentation', order: 5 },
  { key: 'other', name: 'Other', icon: 'file', order: 6 },
];

/**
 * The first template: the ISU lab-experiment cover page.
 *
 * <p>Positions are A4 millimetres, roughly matching the supplied reference
 * design; the admin can nudge any of them on the A4 canvas in the editor, which
 * is the point of the coordinate model. Labels are carried as a `prefix` on the
 * value so a single field prints "Course Code: EEE 2103" without the renderer
 * needing a label+value pair per line.
 */
export function experimentCoverFields() {
  return normalizeFields([
    // The crest itself, taken from the server's img/ folder — no upload step, and
    // one file shared by every template that wants it.
    { key: 'logo', label: 'University Logo', type: 'IMAGE', asset: 'logo.png', x: 16, y: 14, width: 30, height: 30, zIndex: 0 },
    { key: 'university_name', label: 'University Name', type: 'STATIC', staticValue: 'International Standard University', x: 15, y: 22, width: 180, height: 10, fontSize: 18, bold: true, align: 'center' },
    { key: 'department_label', label: 'Department label', type: 'STATIC', staticValue: 'Department of', x: 15, y: 36, width: 180, height: 8, fontSize: 12, align: 'center' },
    { key: 'department', label: 'Department', type: 'AUTO', source: 'department.name', x: 15, y: 44, width: 180, height: 9, fontSize: 14, bold: true, align: 'center' },
    { key: 'header_rule', label: 'Header rule', type: 'LINE', x: 20, y: 56, width: 170, height: 0.5, color: '#1f3288', zIndex: 1 },
    { key: 'experiment_title', label: 'Experiment', type: 'STATIC', staticValue: 'Experiment', x: 15, y: 62, width: 180, height: 12, fontSize: 22, bold: true, align: 'center' },

    { key: 'course_code', label: 'Course Code', type: 'AUTO', source: 'course.code', formatting: { prefix: 'Course Code: ' }, x: 22, y: 84, width: 166, height: 8, fontSize: 12 },
    { key: 'course_name', label: 'Course Name', type: 'AUTO', source: 'course.name', formatting: { prefix: 'Course Name: ' }, x: 22, y: 92, width: 166, height: 8, fontSize: 12 },
    { key: 'experiment_no', label: 'Experiment No', type: 'USER_INPUT', required: true, formatting: { prefix: 'Experiment No: ' }, x: 22, y: 100, width: 166, height: 8, fontSize: 12 },
    { key: 'experiment_name', label: 'Experiment Name', type: 'USER_INPUT', required: true, formatting: { prefix: 'Experiment Name: ' }, x: 22, y: 108, width: 166, height: 8, fontSize: 12 },

    { key: 'submitted_by', label: 'Submitted by', type: 'STATIC', staticValue: 'Submitted by', x: 22, y: 128, width: 166, height: 9, fontSize: 14, bold: true },
    { key: 'student_name', label: 'Student Name', type: 'AUTO', source: 'student.name', formatting: { prefix: 'Name: ' }, x: 28, y: 138, width: 160, height: 8, fontSize: 12 },
    { key: 'student_id', label: 'Student ID', type: 'AUTO', source: 'student.studentId', formatting: { prefix: 'ID No: ' }, x: 28, y: 146, width: 160, height: 8, fontSize: 12 },
    { key: 'batch', label: 'Batch', type: 'AUTO', source: 'student.batch', formatting: { prefix: 'Batch: ' }, x: 28, y: 154, width: 160, height: 8, fontSize: 12 },
    { key: 'group', label: 'Group', type: 'AUTO', source: 'student.group', formatting: { prefix: 'Group: ' }, x: 28, y: 162, width: 160, height: 8, fontSize: 12 },

    { key: 'submitted_to', label: 'Submitted to', type: 'STATIC', staticValue: 'Submitted to', x: 22, y: 182, width: 166, height: 9, fontSize: 14, bold: true },
    { key: 'teacher_name', label: "Teacher's Name", type: 'AUTO', source: 'faculty.name', formatting: { prefix: "Teacher's Name: " }, x: 28, y: 192, width: 160, height: 8, fontSize: 12 },
    { key: 'teacher_designation', label: "Teacher's Designation", type: 'AUTO', source: 'faculty.designation', formatting: { prefix: 'Designation: ' }, x: 28, y: 200, width: 160, height: 8, fontSize: 12 },

    { key: 'experiment_date', label: 'Date of Experiment', type: 'DATE', required: true, formatting: { prefix: 'Date of Experiment: ', dateFormat: 'DD MMM YYYY' }, x: 22, y: 216, width: 166, height: 8, fontSize: 12 },
    { key: 'submission_date', label: 'Date of Submission', type: 'DATE', required: true, formatting: { prefix: 'Date of Submission: ', dateFormat: 'DD MMM YYYY' }, x: 22, y: 224, width: 166, height: 8, fontSize: 12 },
  ]);
}

/**
 * Seeds the categories and the first template. Idempotent: re-running leaves an
 * existing template (and any edits an admin has made to it) alone.
 *
 * @param {{sourcePath?: string}} [options] optional path to the reference
 *   design (PDF/PNG/JPG) to store as the template's `sourceFile`.
 */
export async function seedDocumentTemplates({ sourcePath = process.env.DOCUMENT_SEED_SOURCE_PATH || '' } = {}) {
  for (const category of DEFAULT_CATEGORIES) {
    // eslint-disable-next-line no-await-in-loop
    await DocumentCategory.findOneAndUpdate(
      { key: category.key },
      { $setOnInsert: category },
      { upsert: true, new: true }
    );
  }

  const slug = 'isu-experiment-cover';
  const existing = await DocumentTemplate.findOne({ slug });
  if (existing) {
    console.log('[seed] document template already exists, skipped');
    return { template: existing, created: false };
  }

  const template = await DocumentTemplate.create({
    name: 'ISU Experiment Cover',
    slug,
    category: 'experiment',
    description: 'Laboratory experiment cover page — department, course, experiment and student details.',
    // All departments and all courses: the intended starting point, narrowed per
    // deployment by an admin (or by duplicating it into a department-specific one).
    departmentIds: [],
    courseId: null,
    availableFor: ['student'],
    pageSize: 'A4',
    orientation: 'portrait',
    status: 'ACTIVE',
    currentVersion: 1,
  });

  // The reference design is optional — without it the template still works, the
  // editor just has no background to position against.
  let sourceFile = {};
  if (sourcePath) {
    try {
      const buffer = await fs.readFile(sourcePath);
      const ext = (sourcePath.split('.').pop() || 'pdf').toLowerCase();
      const mimeType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const { storageRef } = await storeTemplateSource(
        `template-sources/${template._id}/v1.${ext}`,
        buffer,
        mimeType
      );
      sourceFile = {
        type: ext === 'pdf' ? 'pdf' : 'image',
        s3Key: storageRef,
        fileName: sourcePath.split(/[\\/]/).pop(),
        mimeType,
        size: buffer.length,
      };
    } catch (error) {
      console.warn(`[seed] could not read the reference design (${sourcePath}): ${error.message}`);
    }
  }

  await DocumentTemplateVersion.create({
    template: template._id,
    version: 1,
    pageSize: template.pageSize,
    orientation: template.orientation,
    fields: experimentCoverFields(),
    sourceFile,
  });

  console.log(`[seed] document template created: ${template.name} (${template._id})`);
  return { template, created: true };
}

// Standalone entry: `node src/utils/seedDocumentTemplates.js`
if (process.argv[1] && process.argv[1].endsWith('seedDocumentTemplates.js')) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  await seedDocumentTemplates();
  await mongoose.disconnect();
}

export default { seedDocumentTemplates, experimentCoverFields, DEFAULT_CATEGORIES };
