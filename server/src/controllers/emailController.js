import EmailLog from '../models/EmailLog.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import { isAdminTierRole, isSuperAdminTier } from '../models/Role.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { sendEmail } from '../services/email/emailService.js';
import { broadcastEmail } from '../services/email/templates.js';

const POPULATE = [
  { path: 'targeting.departments', select: 'name code' },
  { path: 'targeting.courses', select: 'name courseId' },
  { path: 'targeting.batches', select: 'name code' },
  { path: 'targeting.semesters', select: 'name code' },
  { path: 'targeting.recipientIds', select: 'name email role' },
  { path: 'createdBy', select: 'name role' },
  { path: 'recipients.user', select: 'name email role' },
];

function parseTargeting(body) {
  const everyone = body.everyone === 'true' || body.everyone === true;
  return {
    everyone,
    departments: everyone ? [] : [].concat(body.departments || []).filter(Boolean),
    courses: everyone ? [] : [].concat(body.courses || []).filter(Boolean),
    batches: everyone ? [] : [].concat(body.batches || []).filter(Boolean),
    semesters: everyone ? [] : [].concat(body.semesters || []).filter(Boolean),
    includeFaculty: !everyone && (body.includeFaculty === 'true' || body.includeFaculty === true),
    recipientIds: [].concat(body.recipientIds || []).filter(Boolean),
  };
}

// A student "belongs" to a course if that course's department matches the
// student's department (same heuristic used for targeting/messaging
// elsewhere in the app — there's no real per-student course-enrollment
// collection to check against).
async function isStudentInFacultyScope(student, faculty) {
  const deptIds = new Set((faculty.assignedDepartments || []).map(String));
  if (student.department && deptIds.has(String(student.department))) return true;
  if (!student.department) return false;
  const courseIds = await Course.find({ department: student.department }).distinct('_id');
  const facultyCourseIds = new Set((faculty.assignedCourses || []).map(String));
  return courseIds.some((id) => facultyCourseIds.has(String(id)));
}

// Faculty may only email students within their own assigned scope — never
// "everyone", never other faculty (mass or individual — that stays an
// Admin/Super Admin-only capability), and any individually-picked recipient
// must also be one of their own students.
async function assertFacultyEmailScope(targeting, user, explicitRecipientUsers) {
  if (targeting.everyone) throw new ApiError(403, 'Faculty cannot email "Everyone" — pick your assigned department/course', null, 'FORBIDDEN');
  if (targeting.includeFaculty) throw new ApiError(403, 'Faculty cannot email other Faculty in bulk', null, 'FORBIDDEN');
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));
  const badDept = targeting.departments.find((d) => !deptIds.has(String(d)));
  const badCourse = targeting.courses.find((c) => !courseIds.has(String(c)));
  if (badDept || badCourse) {
    throw new ApiError(403, 'You can only email your own assigned Department(s)/Course(s)', null, 'FORBIDDEN');
  }

  for (const recipient of explicitRecipientUsers) {
    if (recipient.role !== 'student' || !(await isStudentInFacultyScope(recipient, user))) {
      throw new ApiError(403, 'You can only individually email your own students', null, 'FORBIDDEN');
    }
  }

  if (
    !targeting.departments.length &&
    !targeting.courses.length &&
    !targeting.batches.length &&
    !targeting.semesters.length &&
    !explicitRecipientUsers.length
  ) {
    throw new ApiError(400, 'Select at least one department, course, batch, semester, or individual recipient to target');
  }
}

async function resolveRecipients(targeting, explicitRecipientUsers) {
  let students = [];
  if (targeting.everyone) {
    students = await User.find({ role: 'student', status: 'active' }).select('name email role');
  } else {
    const courseDeptIds = targeting.courses.length
      ? await Course.find({ _id: { $in: targeting.courses } }).distinct('department')
      : [];
    const or = [];
    if (targeting.departments.length) or.push({ department: { $in: targeting.departments } });
    if (courseDeptIds.length) or.push({ department: { $in: courseDeptIds } });
    if (targeting.batches.length) or.push({ batch: { $in: targeting.batches } });
    if (targeting.semesters.length) or.push({ semester: { $in: targeting.semesters } });
    if (or.length) {
      students = await User.find({ role: 'student', status: 'active', $or: or }).select('name email role');
    }
  }

  let faculty = [];
  if (targeting.everyone || targeting.includeFaculty) {
    faculty = await User.find({ role: 'faculty', status: 'active' }).select('name email role');
  }

  const byId = new Map();
  for (const u of [...students, ...faculty, ...explicitRecipientUsers]) byId.set(String(u._id), u);
  return [...byId.values()];
}

// GET /emails/contacts — who the current user is allowed to pick as an
// individual recipient. Deliberately independent of the Messaging feature
// toggle (this is the Email system's own picker) even though the scoping
// rules mirror it: Faculty can only reach their own students; Admin/Super
// Admin can reach anyone.
export const listEmailContacts = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const nameFilter = search ? { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};

  let filter;
  if (isSuperAdminTier(req.user.role) || (await isAdminTierRole(req.user.role))) {
    filter = { _id: { $ne: req.user._id }, role: { $in: ['student', 'faculty'] }, ...nameFilter };
  } else {
    const deptIds = req.user.assignedDepartments || [];
    const courseDeptIds = await Course.find({ _id: { $in: req.user.assignedCourses || [] } }).distinct('department');
    filter = { role: 'student', department: { $in: [...deptIds, ...courseDeptIds] }, ...nameFilter };
  }

  const contacts = await User.find(filter).select('name email role department').limit(100).sort({ name: 1 });
  res.json({ success: true, data: contacts });
});

// POST /emails/send
export const sendBroadcastEmail = asyncHandler(async (req, res) => {
  const { subject, body } = req.body;
  const targeting = parseTargeting(req.body);

  const explicitRecipientUsers = targeting.recipientIds.length
    ? await User.find({ _id: { $in: targeting.recipientIds }, status: 'active' }).select('name email role department assignedDepartments assignedCourses')
    : [];

  if (req.user.role === 'faculty') await assertFacultyEmailScope(targeting, req.user, explicitRecipientUsers);
  else if (!targeting.everyone && !targeting.departments.length && !targeting.courses.length && !targeting.batches.length && !targeting.semesters.length && !explicitRecipientUsers.length) {
    throw new ApiError(400, 'Select "Everyone", at least one target group, or an individual recipient');
  }

  const recipients = await resolveRecipients(targeting, explicitRecipientUsers);
  if (!recipients.length) throw new ApiError(400, 'No recipients match this targeting');

  const { subject: emailSubject, html, text } = broadcastEmail(subject, body);

  const results = await Promise.allSettled(
    recipients.map((u) => sendEmail({ to: u.email, subject: emailSubject, html, text }))
  );

  const recipientLog = recipients.map((u, i) => ({
    user: u._id,
    email: u.email,
    status: results[i].status === 'fulfilled' ? 'sent' : 'failed',
    error: results[i].status === 'rejected' ? String(results[i].reason?.message || results[i].reason) : '',
  }));
  const successCount = recipientLog.filter((r) => r.status === 'sent').length;

  const log = await EmailLog.create({
    subject,
    body,
    targeting,
    recipients: recipientLog,
    totalRecipients: recipientLog.length,
    successCount,
    failCount: recipientLog.length - successCount,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `Sent to ${successCount}/${recipientLog.length} recipient(s)`,
    data: { _id: log._id, totalRecipients: log.totalRecipients, successCount: log.successCount, failCount: log.failCount },
  });
});

// GET /emails — send history/dashboard
export const listEmailLogs = asyncHandler(async (req, res) => {
  const filter = isSuperAdminTier(req.user.role) ? {} : { createdBy: req.user._id };
  const logs = await EmailLog.find(filter)
    .select('-recipients')
    .populate(POPULATE.filter((p) => p.path !== 'recipients.user'))
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ success: true, data: logs });
});

// GET /emails/:id — full detail including per-recipient results
export const getEmailLog = asyncHandler(async (req, res) => {
  const log = await EmailLog.findById(req.params.id).populate(POPULATE);
  if (!log) throw new ApiError(404, 'Email log not found');
  if (req.user.role !== 'super_admin' && String(log.createdBy?._id || log.createdBy) !== String(req.user._id)) {
    throw new ApiError(403, 'You can only view emails you sent', null, 'FORBIDDEN');
  }
  res.json({ success: true, data: log });
});
