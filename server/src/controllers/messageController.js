import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import { isAdminTierRole, isSuperAdminTier } from '../models/Role.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { emit } from '../services/notifications/notificationService.js';
import { isBlockedByApproval } from '../services/courseAccessService.js';

// Direct messaging is scoped to Faculty <-> Student pairs within the
// faculty's assigned Department/Course (the same heuristic used for
// targeting elsewhere: a student "belongs" to a course if that course's
// department matches the student's department). Admin/Super Admin can
// message anyone, matching their oversight role (e.g. acting as a class CR).
async function studentCourseIds(studentDepartmentId) {
  if (!studentDepartmentId) return [];
  return Course.find({ department: studentDepartmentId }).distinct('_id');
}

async function isFacultyStudentPairInScope(faculty, student) {
  const deptIds = new Set((faculty.assignedDepartments || []).map(String));
  if (student.department && deptIds.has(String(student.department))) return true;
  const courseIds = await studentCourseIds(student.department);
  const facultyCourseIds = new Set((faculty.assignedCourses || []).map(String));
  return courseIds.some((id) => facultyCourseIds.has(String(id)));
}

async function assertCanMessage(me, other) {
  if (isSuperAdminTier(me.role) || (await isAdminTierRole(me.role))) return;
  if (isSuperAdminTier(other.role) || (await isAdminTierRole(other.role))) return;

  const pair = [me, other];
  const faculty = pair.find((u) => u.role === 'faculty');
  const student = pair.find((u) => u.role === 'student');
  if (!faculty || !student || faculty._id.equals(student._id)) {
    throw new ApiError(403, 'Direct messaging is only available between Faculty and Students', null, 'FORBIDDEN');
  }
  const inScope = await isFacultyStudentPairInScope(faculty, student);
  if (!inScope) {
    throw new ApiError(403, 'You can only message Faculty/Students within your own Department/Course', null, 'FORBIDDEN');
  }
}

function pairKeyFor(idA, idB) {
  return [String(idA), String(idB)].sort().join(':');
}

// GET /messages/contacts — who the current user is allowed to start a new
// conversation with.
export const listContacts = asyncHandler(async (req, res) => {
  // A pending/rejected student can't message anyone (Messaging is always
  // login-required) until an Admin approves them — same all-or-nothing gate
  // as file content/Assignments/Quizzes.
  if (await isBlockedByApproval(req.user)) {
    return res.json({ success: true, data: [], blockedByApproval: true });
  }

  const { search } = req.query;
  const nameFilter = search ? { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};

  let filter;
  if (isSuperAdminTier(req.user.role) || (await isAdminTierRole(req.user.role))) {
    filter = { _id: { $ne: req.user._id }, role: { $in: ['student', 'faculty'] }, ...nameFilter };
  } else if (req.user.role === 'faculty') {
    const deptIds = req.user.assignedDepartments || [];
    const courseDeptIds = await Course.find({ _id: { $in: req.user.assignedCourses || [] } }).distinct('department');
    filter = { role: 'student', department: { $in: [...deptIds, ...courseDeptIds] }, ...nameFilter };
  } else if (req.user.role === 'student') {
    const courseIds = await studentCourseIds(req.user.department);
    filter = {
      role: 'faculty',
      $or: [{ assignedDepartments: req.user.department }, { assignedCourses: { $in: courseIds } }],
      ...nameFilter,
    };
  } else {
    filter = { _id: null }; // no valid role reaches here, but stay safe
  }

  const contacts = await User.find(filter).select('name email role department').limit(100).sort({ name: 1 });
  res.json({ success: true, data: contacts });
});

// GET /messages/conversations
export const listConversations = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id })
    .populate('participants', 'name email role')
    .sort({ lastMessageAt: -1 });

  const unreadCounts = await Message.aggregate([
    { $match: { conversation: { $in: conversations.map((c) => c._id) }, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unreadCounts.map((u) => [String(u._id), u.count]));

  const data = conversations.map((c) => ({
    ...c.toObject(),
    otherParticipant: c.participants.find((p) => !p._id.equals(req.user._id)) || null,
    unreadCount: unreadMap.get(String(c._id)) || 0,
  }));

  res.json({ success: true, data });
});

// POST /messages/conversations { recipientId }
export const startConversation = asyncHandler(async (req, res) => {
  if (await isBlockedByApproval(req.user)) {
    throw new ApiError(403, 'Your account is pending admin approval', null, 'FORBIDDEN');
  }

  const { recipientId } = req.body;
  if (!recipientId) throw new ApiError(400, 'recipientId is required');
  if (String(recipientId) === String(req.user._id)) throw new ApiError(400, 'You cannot message yourself');

  const recipient = await User.findById(recipientId);
  if (!recipient) throw new ApiError(404, 'User not found');

  await assertCanMessage(req.user, recipient);

  const pairKey = pairKeyFor(req.user._id, recipient._id);
  let conversation = await Conversation.findOne({ pairKey });
  if (!conversation) {
    conversation = await Conversation.create({
      participants: [req.user._id, recipient._id],
      pairKey,
    });
  }
  await conversation.populate('participants', 'name email role');

  res.status(201).json({ success: true, data: conversation });
});

async function assertParticipant(conversation, user) {
  if (!conversation.participants.some((p) => p.equals(user._id))) {
    throw new ApiError(403, 'You are not part of this conversation', null, 'FORBIDDEN');
  }
}

// GET /messages/conversations/:id/messages
export const listMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw new ApiError(404, 'Conversation not found');
  await assertParticipant(conversation, req.user);

  const { skip, limit } = parsePagination(req.query, { defaultLimit: 50 });

  const messages = await Message.find({ conversation: conversation._id })
    .populate('sender', 'name role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );

  res.json({ success: true, data: messages.reverse() });
});

// POST /messages/conversations/:id/messages { text }
export const sendMessage = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw new ApiError(404, 'Conversation not found');
  await assertParticipant(conversation, req.user);

  // Only the sender's own approval status matters here — a faculty member
  // must still be able to reply to a student even if that student later
  // became pending, so this never blocks based on the *other* participant.
  if (await isBlockedByApproval(req.user)) {
    throw new ApiError(403, 'Your account is pending admin approval', null, 'FORBIDDEN');
  }

  const { text } = req.body;
  if (!text || !text.trim()) throw new ApiError(400, 'Message text is required');

  const message = await Message.create({
    conversation: conversation._id,
    sender: req.user._id,
    text: text.trim(),
    readBy: [req.user._id],
  });

  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessageText = message.text;
  conversation.lastMessageSender = req.user._id;
  await conversation.save();

  await message.populate('sender', 'name role');

  const recipient = conversation.participants.find((p) => !p.equals(req.user._id));
  emit({
    type: 'MESSAGE_RECEIVED',
    actorId: req.user._id,
    entityType: 'MESSAGE',
    entityId: message._id,
    vars: { senderName: req.user.name, preview: message.text.slice(0, 120), conversationId: conversation._id },
    recipients: recipient ? [recipient] : [],
  }).catch((err) => console.error('[notify] message', err));

  res.status(201).json({ success: true, data: message });
});
