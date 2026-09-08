import Feedback, { FEEDBACK_CATEGORIES } from '../models/Feedback.js';
import { getSettings } from '../models/Settings.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// POST /feedback — open to anyone (guest or signed-in); gated by the
// Feedback System toggle so Super Admin can disable it platform-wide.
export const submitFeedback = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.feedbackSystemEnabled) {
    throw new ApiError(400, 'The feedback system is currently disabled');
  }

  const { name, email, category, subject, message, rating } = req.body;
  if (!FEEDBACK_CATEGORIES.includes(category)) {
    throw new ApiError(400, `category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`);
  }

  const feedback = await Feedback.create({
    user: req.user?._id || null,
    name,
    email,
    category,
    subject,
    message,
    rating: rating ? Number(rating) : null,
  });

  res.status(201).json({ success: true, message: 'Thanks for your feedback', data: feedback });
});

// ----- Super Admin management -----

export const listFeedback = asyncHandler(async (req, res) => {
  const { q, category, status, dateFrom, dateTo, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: re }, { email: re }, { subject: re }, { message: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Feedback.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

export const updateFeedbackStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['new', 'reviewed', 'resolved'].includes(status)) {
    throw new ApiError(400, 'status must be "new", "reviewed", or "resolved"');
  }
  const feedback = await Feedback.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!feedback) throw new ApiError(404, 'Feedback not found');
  res.json({ success: true, data: feedback });
});

export const deleteFeedback = asyncHandler(async (req, res) => {
  const feedback = await Feedback.findByIdAndDelete(req.params.id);
  if (!feedback) throw new ApiError(404, 'Feedback not found');
  res.json({ success: true, message: 'Feedback deleted' });
});

// GET /super-admin/feedback/export — CSV export of the (optionally filtered)
// feedback list, matching the same query params as listFeedback.
export const exportFeedback = asyncHandler(async (req, res) => {
  const { q, category, status, dateFrom, dateTo } = req.query;
  const filter = {};
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: re }, { email: re }, { subject: re }, { message: re }];
  }

  const items = await Feedback.find(filter).sort({ createdAt: -1 });

  const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Date', 'Name', 'Email', 'Category', 'Subject', 'Message', 'Rating', 'Status'];
  const rows = items.map((f) =>
    [f.createdAt.toISOString(), f.name, f.email, f.category, f.subject, f.message, f.rating ?? '', f.status]
      .map(escapeCsv)
      .join(',')
  );
  const csv = [header.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="feedback-export.csv"');
  res.send(csv);
});
