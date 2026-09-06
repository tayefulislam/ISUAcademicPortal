import File from '../models/File.js';
import Course from '../models/Course.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildFileQuery, buildSortOption } from '../services/fileQueryBuilder.js';

const LIST_FIELDS = [
  'title',
  'originalName',
  'fileType',
  'mimeType',
  'fileSize',
  'fileUrl',
  'fileCount',
  'departmentCode',
  'courseName',
  'courseId',
  'batchCodes',
  'allBatches',
  'semester',
  'academicYear',
  'categoryName',
  'views',
  'downloads',
  'createdAt',
];

// GET /api/search — global search across file name, course, course ID, batch, keywords, etc.
// Combines full-text search (?q=) with exact filters (department, course, batch, ...).
export const search = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort, q } = req.query;
  const query = await buildFileQuery(req.query, req.user);

  const projection = Object.fromEntries(LIST_FIELDS.map((f) => [f, 1]));
  if (q) projection.score = { $meta: 'textScore' };

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(query, projection).sort(buildSortOption(sort, q)).skip(skip).limit(Number(limit)),
    File.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// GET /api/search/suggestions?q= — lightweight typeahead over course names/IDs.
export const suggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ success: true, data: [] });

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const courses = await Course.find({ $or: [{ name: regex }, { courseId: regex }] })
    .select('name courseId')
    .limit(8);

  res.json({ success: true, data: courses });
});
