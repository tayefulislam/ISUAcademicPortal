import Log from '../models/Log.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /super-admin/logs — the app-wide log viewer (Super Admin/Administrator
// only, see superAdminRoutes.js). `counts` gives the level breakdown across
// the *filtered* set so the UI can show "12 errors" tabs without a second
// round-trip per tab.
export const listLogs = asyncHandler(async (req, res) => {
  const { level, source, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });

  const baseFilter = {};
  if (source) baseFilter.source = new RegExp(escapeRegex(source), 'i');
  if (q) baseFilter.message = new RegExp(escapeRegex(q), 'i');
  const filter = level ? { ...baseFilter, level } : baseFilter;

  const [logs, total, counts] = await Promise.all([
    Log.find(filter).populate('userId', 'name email role').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Log.countDocuments(filter),
    Log.aggregate([{ $match: baseFilter }, { $group: { _id: '$level', count: { $sum: 1 } } }]),
  ]);

  res.json({
    success: true,
    data: logs,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getLog = asyncHandler(async (req, res) => {
  const log = await Log.findById(req.params.id).populate('userId', 'name email role');
  if (!log) throw new ApiError(404, 'Log not found');
  res.json({ success: true, data: log });
});

export const deleteLog = asyncHandler(async (req, res) => {
  const log = await Log.findByIdAndDelete(req.params.id);
  if (!log) throw new ApiError(404, 'Log not found');
  res.json({ success: true, message: 'Log deleted' });
});

// DELETE /super-admin/logs?level=info — clears matching logs (all logs if no
// level given). Manual cleanup — there's no automatic retention/TTL, so this
// is how the collection stays from growing unbounded over time.
export const clearLogs = asyncHandler(async (req, res) => {
  const { level } = req.query;
  const filter = level ? { level } : {};
  const result = await Log.deleteMany(filter);
  res.json({ success: true, message: `${result.deletedCount} log(s) cleared` });
});
