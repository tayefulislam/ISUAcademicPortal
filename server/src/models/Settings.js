import mongoose from 'mongoose';

// Singleton document (one row, key: 'global') holding system-wide toggles
// managed by Super Admin. Accessed only through getSettings/updateSettings
// below so callers never have to think about the upsert/singleton dance.
//
// FEATURE_FLAGS is the single source of truth for which toggles exist — the
// generic Feature Management panel (GET/PATCH /super-admin/settings) reads
// this list rather than hardcoding each flag, so adding a new feature toggle
// later is just: add the schema field below + one entry here.
export const FEATURE_FLAGS = [
  {
    key: 'studentApprovalEnabled',
    label: 'Student Approval System',
    description:
      'When ON, new student registrations require an ID photo and Admin approval before they can access restricted materials.',
  },
  {
    key: 'studentUploadEnabled',
    label: 'Student Material Upload',
    description: 'When ON, students can submit their own materials for review before publishing.',
  },
  {
    key: 'feedbackSystemEnabled',
    label: 'Feedback System',
    description: 'When ON, the Feedback form is available to users; when OFF it is hidden/disabled.',
  },
  {
    key: 'assignmentSystemEnabled',
    label: 'Assignment System',
    description: 'When ON, Admin/Faculty can create assignments and students can view/submit them. When OFF, the whole assignment system is unavailable.',
  },
  {
    key: 'quizSystemEnabled',
    label: 'Quiz System',
    description: 'When ON, Admin/Faculty can build quizzes from the question bank and students can attempt them. When OFF, the whole quiz system is unavailable.',
  },
  {
    key: 'publicExamsEnabled',
    label: 'Public Exams',
    description: 'When ON, Faculty/Admin can mark a quiz as a Public Exam reachable via a shareable URL, with optional guest (no-login) access. When OFF, existing public exam links stop working until turned back on.',
  },
  {
    key: 'otpVerificationEnabled',
    label: 'Email OTP Verification',
    description: 'When ON, new accounts must verify their email with a one-time code before they can log in.',
  },
  {
    key: 'passwordResetEnabled',
    label: 'Password Reset via Email',
    description: 'When ON, users can request a password-reset email from the login page. When OFF, the forgot-password endpoint is disabled.',
  },
  {
    key: 'messagingSystemEnabled',
    label: 'Faculty-Student Messaging',
    description: 'When ON, the Messages feature is available and shown in the menu. When OFF, it is hidden and unavailable to everyone.',
  },
  {
    key: 'emailSystemEnabled',
    label: 'University Email System',
    description: 'When ON, the Email Center is available and shown in the menu for Faculty/Admin/Super Admin. When OFF, it is hidden and unavailable.',
  },
  {
    key: 'facultyChapterTopicEnabled',
    label: 'Faculty: Create Chapter/Topic',
    description: 'When ON, Faculty can create Chapters and Topics for their own assigned Department(s)/Course(s). Editing/deleting stays Super Admin-only either way.',
  },
  {
    key: 'courseEnrollmentSystemEnabled',
    label: 'Course Enrollment System',
    description: 'Master switch for Additional Course Enrollment (retake/extra/backlog/improvement/advance). When OFF, students cannot request additional courses and the whole feature is hidden.',
  },
  {
    key: 'allowRetakeEnrollment',
    label: 'Allow Retake Enrollment',
    description: 'When ON, students can request to retake a previously failed course.',
  },
  {
    key: 'allowExtraEnrollment',
    label: 'Allow Extra Course Enrollment',
    description: 'When ON, students can request an extra course beyond their regular semester load.',
  },
  {
    key: 'allowBacklogEnrollment',
    label: 'Allow Backlog Enrollment',
    description: 'When ON, students can request to clear a backlog course from an earlier semester.',
  },
  {
    key: 'allowImprovementEnrollment',
    label: 'Allow Improvement Enrollment',
    description: 'When ON, students can request to re-take a passed course to improve their grade.',
  },
  {
    key: 'allowAdvanceEnrollment',
    label: 'Allow Advance Course Enrollment',
    description: 'When ON, students can request a course ahead of their current semester.',
  },
];

// Numeric business-rule limits for the Course Enrollment system — separate
// from FEATURE_FLAGS since these are counts, not on/off switches. 0 means
// "unlimited" (the default — nothing is capped unless Super Admin sets a
// positive number). Same generic-list pattern: add an entry here, no
// controller change needed.
export const NUMERIC_SETTINGS = [
  {
    key: 'maxAdditionalCoursesPerSemester',
    label: 'Max Additional Courses per Semester',
    description: 'Maximum total retake/extra/backlog/improvement/advance enrollments a student may have open at once for one academic year + semester. 0 = unlimited.',
  },
  {
    key: 'maxRetakeCourses',
    label: 'Max Retake Courses',
    description: 'Maximum open retake enrollments a student may have at once. 0 = unlimited.',
  },
  {
    key: 'maxExtraCourses',
    label: 'Max Extra Courses',
    description: 'Maximum open extra-course enrollments a student may have at once. 0 = unlimited.',
  },
];

const schemaFields = { key: { type: String, required: true, unique: true, default: 'global' } };
for (const flag of FEATURE_FLAGS) {
  schemaFields[flag.key] = { type: Boolean, default: false };
}
for (const setting of NUMERIC_SETTINGS) {
  schemaFields[setting.key] = { type: Number, default: 0, min: 0 };
}

const settingsSchema = new mongoose.Schema(schemaFields, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);

export async function getSettings() {
  return Settings.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, new: true });
}

export async function updateSettings(patch) {
  return Settings.findOneAndUpdate({ key: 'global' }, { $set: patch }, { upsert: true, new: true });
}

export default Settings;
