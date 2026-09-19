import mongoose from 'mongoose';
import { env } from '../config/env.js';

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
  {
    key: 'phoneLoginEnabled',
    label: 'Login with Phone Number',
    description: 'When ON, users can sign in with their phone number (in addition to email). When OFF, a phone number is never accepted at login, even if one is on file.',
    default: true,
  },
  {
    key: 'studentIdLoginEnabled',
    label: 'Login with Student ID',
    description: 'When ON, users can sign in with their Student ID / Roll No (in addition to email). When OFF, a Student ID is never accepted at login, even if one is on file.',
    default: true,
  },
  {
    key: 'routineSystemEnabled',
    label: 'Class Routine & Academic Calendar',
    description: 'When ON, the class routine, exam calendar and their reminders are available. The mobile app can receive class reminders as push notifications; the web app shows the same schedule in-app.',
  },
  {
    key: 'documentGeneratorEnabled',
    label: 'Document Generator',
    description: 'When ON, students can generate cover pages and other documents from the published templates, and the module appears in the menu. When OFF, it is hidden for everyone.',
    // Safe-by-default: a generated cover page is a convenience with no side
    // effects, so it ships usable rather than requiring an admin to switch it on
    // (same choice as the routine/calendar system above).
    default: true,
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

// Admin-editable single-choice settings — same generic-list pattern as
// FEATURE_FLAGS/NUMERIC_SETTINGS above (add an entry here + a schema field,
// no controller change needed), but for a fixed set of string options
// instead of on/off or a number. Currently just the one setting from the
// Student ID Storage system spec (§2/§3): which provider new Student ID
// photos are uploaded to. Switching it never touches already-stored photos
// (each keeps its own `provider` on User.studentIdImage) — see
// storageService.js's uploadStudentIdImage/deleteStudentIdImage, which
// always dispatch on the per-record provider, never this live setting.
export const STRING_SETTINGS = [
  {
    key: 'studentIdStorageProvider',
    label: 'Student ID Image Storage Provider',
    description: 'Where newly submitted/resubmitted Student ID photos are uploaded. Changing this does not move or affect already-stored photos.',
    options: ['imgbb', 's3'],
    default: env.studentIdStorageProvider,
  },
];

// Free-text admin-editable settings validated by a regex rather than a
// fixed option list — same generic-list contract as FEATURE_FLAGS/
// NUMERIC_SETTINGS/STRING_SETTINGS above.
//
// Kept only for backward compatibility with documents written before
// officialEmailDomains (below) existed — see that field's `default`
// function, which migrates this single value into the new array the first
// time an existing Settings document is read. Nothing in the application
// reads this field directly anymore; it's dead weight kept solely so no
// admin's prior domain configuration is silently lost.
export const TEXT_SETTINGS = [];

// A domain "shape" check: labels of letters/digits/hyphens separated by
// dots, at least one dot — rejects a bare word ("localhost") and guards
// against someone pasting a stray "@" or a full email address into this
// field by mistake.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

// Admin-editable LIST settings — same generic contract as FEATURE_FLAGS/
// NUMERIC_SETTINGS/STRING_SETTINGS/TEXT_SETTINGS above, but the value is an
// array of normalized strings rather than one value. Currently just the set
// of official university email domains: whenever studentApprovalEnabled is
// ON, a student whose verified email ends in ANY of these domains is
// APPROVED automatically the moment their email is verified —
// unconditionally, no separate enable toggle (see authController.js's
// maybeAutoApproveStudent/isOfficialUniversityEmail; a prior separate
// "studentAutoApprovalEnabled" toggle was removed because it was the actual
// cause of official-domain students getting stuck pending Student ID review
// — nobody had turned the second toggle on). Everyone else falls through to
// the normal Student ID submission/approval workflow. Each entry is stored
// WITHOUT the leading '@' (e.g. "isu.ac.bd"), matched by exact host-string
// equality so a subdomain or a deceptive longer domain never matches unless
// explicitly configured to.
export const LIST_SETTINGS = [
  {
    key: 'officialEmailDomains',
    label: 'Official University Email Domains',
    description: 'A student whose verified email ends in any of these domains is approved automatically — no Student ID submission needed. Each stored without the leading "@". Matched exactly (no automatic subdomain matching) and case-insensitively.',
    itemPattern: DOMAIN_PATTERN,
    itemHint: 'e.g. "isu.ac.bd" (without the @)',
  },
  {
    key: 'academicGroups',
    label: 'Academic Groups',
    description: 'The class groups a batch can be split into (e.g. BOTH, A1, A2). "BOTH" means the whole batch and must always be present. Add a value here to make it selectable on routine/exam entries and assignable to students — nothing is hard-coded, so A3/B1/B2 work without a code change.',
    itemPattern: /^[A-Z0-9]{1,10}$/,
    itemHint: 'up to 10 letters or digits, e.g. "A3"',
  },
  {
    key: 'facultyDesignations',
    label: 'Faculty Designations',
    description: 'The academic ranks a Faculty account can be given (e.g. Lecturer, Assistant Professor). Adding one here makes it selectable when creating or editing Faculty, and available to a document template as the "Teacher\'s Designation" field. Spelling is kept exactly as entered — it is what prints on the document.',
    // Letters, spaces and the punctuation that appears in a real rank
    // ("Assistant Professor", "Professor (Adjunct)", "Ph.D.").
    itemPattern: /^[A-Za-z][A-Za-z0-9 .,'&()-]{0,60}$/,
    // Unlike a domain, a rank is a display label: lower-casing it would print
    // "assistant professor" on a cover page.
    preserveCase: true,
    itemHint: 'e.g. "Assistant Professor"',
  },
];

// The ranks every deployment starts with. Only a starting set — the list lives
// in the database, so adding "Senior Lecturer" is an admin edit, not a deploy.
export const DEFAULT_FACULTY_DESIGNATIONS = [
  'Lecturer',
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'Lab Instructor',
  'Adjunct Faculty',
];

// The academic groups every deployment starts with. A student whose group is
// BOTH (the default) is matched by BOTH entries and by entries for any group,
// which is what makes an unsplit batch behave exactly as it does today.
export const DEFAULT_ACADEMIC_GROUPS = ['BOTH', 'A1', 'A2'];

// The group value that means "the whole batch" — matched by every student
// regardless of their own group.
export const GROUP_BOTH = 'BOTH';

export function normalizeDomain(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^@/, '');
}

const schemaFields = { key: { type: String, required: true, unique: true, default: 'global' } };
for (const setting of STRING_SETTINGS) {
  schemaFields[setting.key] = { type: String, enum: setting.options, default: setting.default };
}
// Legacy single-domain field — no longer read by application logic, kept
// only as the migration source for officialEmailDomains below.
schemaFields.studentAutoApprovalDomain = { type: String, default: '', trim: true, lowercase: true };
for (const setting of LIST_SETTINGS) {
  // A plain empty-array default (not a `this`-dependent function — Mongoose
  // computes upsert/insert defaults before any document context exists, so
  // `this` isn't reliably the document being created). The actual migration
  // of a pre-existing single-domain value into this array happens
  // explicitly in getSettings() below instead, where a real document is
  // available to read and write.
  schemaFields[setting.key] = { type: [String], default: [] };
}
for (const flag of FEATURE_FLAGS) {
  // Every flag defaults OFF unless it opts into `default: true` — used for
  // flags gating something that should just work out of the box (e.g. the
  // phone/Student ID login identifiers), rather than an opt-in feature.
  schemaFields[flag.key] = { type: Boolean, default: flag.default ?? false };
}
for (const setting of NUMERIC_SETTINGS) {
  schemaFields[setting.key] = { type: Number, default: 0, min: 0 };
}

const settingsSchema = new mongoose.Schema(schemaFields, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);

export async function getSettings() {
  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { upsert: true, new: true }
  );

  // One-time migration: a document written before officialEmailDomains
  // existed still has its old single-domain value on
  // studentAutoApprovalDomain — carry it forward into the new array rather
  // than silently losing an admin's prior configuration. Brand-new
  // deployments (neither field ever set) fall back to the same 'isu.ac.bd'
  // default this app always had. Runs at most once per deployment: after
  // the first save, officialEmailDomains is non-empty and this is skipped.
  //
  // academicGroups is seeded the same way so the list is never empty — an
  // empty list would make every group value invalid, including "BOTH".
  let dirty = false;
  if (!settings.officialEmailDomains?.length) {
    const legacy = normalizeDomain(settings.studentAutoApprovalDomain);
    settings.officialEmailDomains = [legacy || 'isu.ac.bd'];
    dirty = true;
  }
  if (!settings.academicGroups?.length) {
    settings.academicGroups = [...DEFAULT_ACADEMIC_GROUPS];
    dirty = true;
  }
  // Seeded for the same reason: an empty designation list would leave every
  // Faculty form with nothing to choose.
  if (!settings.facultyDesignations?.length) {
    settings.facultyDesignations = [...DEFAULT_FACULTY_DESIGNATIONS];
    dirty = true;
  }
  if (dirty) await settings.save();

  return settings;
}

export async function updateSettings(patch) {
  return Settings.findOneAndUpdate({ key: 'global' }, { $set: patch }, { upsert: true, new: true });
}

export default Settings;
