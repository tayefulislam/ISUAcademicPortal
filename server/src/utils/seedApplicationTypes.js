import mongoose from 'mongoose';
import ApplicationType from '../models/ApplicationType.js';
import ApplicationRecipient from '../models/ApplicationRecipient.js';

// The starting set of application types and official recipients. Both are rows,
// not enums — an administrator adds, edits or disables them through the admin
// UI, and this is only what a fresh deployment begins with. Seeding is
// insert-only (`$setOnInsert`), so re-running it never overwrites an admin's work.

const text = (key, label, required = false, placeholder = '') => ({ key, label, type: 'TEXT', required, placeholder });
const area = (key, label, required = false) => ({ key, label, type: 'TEXTAREA', required });
const num = (key, label, required = false) => ({ key, label, type: 'NUMBER', required });
const date = (key, label, required = false) => ({ key, label, type: 'DATE', required });
const bool = (key, label) => ({ key, label, type: 'BOOLEAN', required: false });
const select = (key, label, options, required = false) => ({ key, label, type: 'SELECT', options, required });

export const DEFAULT_APPLICATION_TYPES = [
  {
    key: 'tuition_fee_reduction',
    name: 'Tuition Fee Reduction',
    order: 1,
    description: 'Request a reduction of tuition fees.',
    defaultInstructions: 'State the requested reduction clearly and the reason for it.',
    fields: [
      text('requestedReduction', 'Requested Reduction (e.g. 50%)', true),
      area('reason', 'Reason', true),
      text('semester', 'Current Semester'),
      bool('supportingDocument', 'Supporting Document Attached'),
    ],
  },
  {
    key: 'financial_assistance',
    name: 'Financial Assistance',
    order: 2,
    description: 'Request financial assistance.',
    fields: [area('reason', 'Reason', true), text('semester', 'Current Semester')],
  },
  {
    key: 'leave_application',
    name: 'Leave Application',
    order: 3,
    description: 'Request leave from classes.',
    fields: [date('leaveFrom', 'Leave From', true), date('leaveTo', 'Leave To', true), num('days', 'Number of Days'), area('reason', 'Reason', true)],
  },
  {
    key: 'course_registration',
    name: 'Course Registration',
    order: 4,
    description: 'Request registration for a course.',
    fields: [text('courseName', 'Course Name', true), text('courseCode', 'Course Code', true), text('semester', 'Semester'), area('reason', 'Reason', true)],
  },
  {
    key: 'course_withdrawal',
    name: 'Course Withdrawal',
    order: 5,
    description: 'Request withdrawal from a course.',
    fields: [text('courseName', 'Course Name', true), text('courseCode', 'Course Code', true), text('semester', 'Semester'), area('reason', 'Reason', true)],
  },
  {
    key: 'late_registration',
    name: 'Late Registration',
    order: 6,
    description: 'Request late course registration.',
    fields: [text('semester', 'Semester', true), area('reason', 'Reason', true)],
  },
  {
    key: 'exam_permission',
    name: 'Exam Permission',
    order: 7,
    description: 'Request permission to sit an examination.',
    fields: [text('courseName', 'Course Name', true), text('courseCode', 'Course Code', true), date('examDate', 'Exam Date'), area('reason', 'Reason', true)],
  },
  {
    key: 'retake_permission',
    name: 'Retake Permission',
    order: 8,
    description: 'Request permission to retake a course.',
    fields: [text('courseName', 'Course Name', true), text('courseCode', 'Course Code', true), text('semester', 'Semester'), area('reason', 'Reason', true)],
  },
  {
    key: 'section_change',
    name: 'Section Change',
    order: 9,
    description: 'Request a change of section/group.',
    fields: [text('currentSection', 'Current Section'), text('requestedSection', 'Requested Section', true), area('reason', 'Reason', true)],
  },
  {
    key: 'id_card_request',
    name: 'ID Card Request',
    order: 10,
    description: 'Request a new or replacement Student ID card.',
    fields: [select('reason', 'Reason', ['New', 'Lost', 'Damaged', 'Other'], true)],
  },
  {
    key: 'certificate_request',
    name: 'Certificate Request',
    order: 11,
    description: 'Request a certificate from the university.',
    fields: [select('certificateType', 'Certificate Type', ['Testimonial', 'Character Certificate', 'Provisional Certificate', 'Other'], true), area('purpose', 'Purpose')],
  },
  {
    key: 'transcript_request',
    name: 'Transcript Request',
    order: 12,
    description: 'Request an academic transcript.',
    fields: [area('purpose', 'Purpose', true), num('copies', 'Number of Copies')],
  },
  {
    key: 'scholarship_request',
    name: 'Scholarship Request',
    order: 13,
    description: 'Apply for a scholarship.',
    fields: [text('scholarshipName', 'Scholarship Name'), text('semester', 'Current Semester'), area('reason', 'Reason', true)],
  },
  {
    key: 'internship_permission',
    name: 'Internship Permission',
    order: 14,
    description: 'Request permission for an internship.',
    fields: [text('organization', 'Organization', true), date('from', 'From'), date('to', 'To'), area('reason', 'Reason')],
  },
  {
    key: 'recommendation_request',
    name: 'Recommendation Request',
    order: 15,
    description: 'Request a letter of recommendation.',
    fields: [text('purpose', 'Purpose', true), text('addressedTo', 'Addressed To')],
  },
  {
    key: 'general_application',
    name: 'General Application',
    order: 16,
    description: 'Any other formal application.',
    fields: [],
  },
  {
    key: 'other',
    name: 'Other',
    order: 17,
    description: 'An application type not listed — describe it yourself.',
    fields: [text('customType', 'Your Application Type', true)],
  },
];

// The starting official recipients. Names/offices are intentionally blank for an
// administrator to fill in — an empty one prints nothing rather than a guess.
export const DEFAULT_RECIPIENTS = [
  { name: 'The Registrar', designation: 'Registrar', office: 'Office of the Registrar', type: 'REGISTRAR', order: 1 },
  { name: 'The Head of Department', designation: 'Head of Department', office: '', type: 'HOD', order: 2 },
  { name: 'The Dean', designation: 'Dean', office: 'Faculty Office', type: 'DEAN', order: 3 },
  { name: 'The Accounts Office', designation: 'Accounts Officer', office: 'Accounts / Finance Office', type: 'FINANCE', order: 4 },
  { name: 'The Examination Office', designation: 'Controller of Examinations', office: 'Examination Office', type: 'EXAM', order: 5 },
  { name: 'The Administration', designation: 'Administrator', office: 'Administration Office', type: 'ADMIN', order: 6 },
];

/** Inserts the starting types and recipients. Idempotent; never overwrites. */
export async function seedApplicationTypes() {
  let types = 0;
  for (const type of DEFAULT_APPLICATION_TYPES) {
    // eslint-disable-next-line no-await-in-loop
    const result = await ApplicationType.updateOne(
      { key: type.key },
      { $setOnInsert: type },
      { upsert: true }
    );
    types += result.upsertedCount || 0;
  }

  let recipients = 0;
  if ((await ApplicationRecipient.countDocuments({})) === 0) {
    const created = await ApplicationRecipient.insertMany(DEFAULT_RECIPIENTS);
    recipients = created.length;
  }

  return { types, recipients };
}

// Standalone: `node src/utils/seedApplicationTypes.js`
if (process.argv[1] && process.argv[1].endsWith('seedApplicationTypes.js')) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  try {
    const result = await seedApplicationTypes();
    console.log(`[applications] seeded ${result.types} type(s) and ${result.recipients} recipient(s)`);
  } finally {
    await mongoose.disconnect();
  }
}

export default { seedApplicationTypes, DEFAULT_APPLICATION_TYPES, DEFAULT_RECIPIENTS };
