import File from '../models/File.js';
import Course from '../models/Course.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildFileQuery, buildSortOption, buildAccessContext, attachFileLocks } from '../services/fileQueryBuilder.js';
import { fuzzyRankFiles, suggestFileCorrection } from '../services/fuzzyFileSearch.js';
import { sanitizeQuery } from '../utils/textSearch.js';
import { parsePagination } from '../utils/pagination.js';

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

// GET /api/search — global search across file name, course, course ID, batch,
// keywords, etc. Combines typo-tolerant fuzzy matching (?q=) with exact
// filters (department, course, batch, ...) — same engine as Question Bank
// search (server/src/utils/textSearch.js), so "qution" / "photo" / a
// misspelled course name still finds the right file.
export const search = asyncHandler(async (req, res) => {
  const { sort, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const cleanQuery = sanitizeQuery(q);
  const accessCtx = await buildAccessContext(req.user);

  // Below the shortest meaningful fuzzy query, skip scoring entirely and
  // fall back to the plain scope-filtered listing — identical to how
  // Question Bank search treats a <2-char term, and keeps every existing
  // (non-search) caller of GET /search/GET /files behaving exactly as before.
  if (!q || cleanQuery.length < 2) {
    const query = await buildFileQuery(req.query, req.user, { includeLocked: true, accessCtx });
    const [files, total] = await Promise.all([
      File.find(query, Object.fromEntries([...LIST_FIELDS, 'visibility', 'restrictions'].map((f) => [f, 1])))
        .sort(buildSortOption(sort, false))
        .skip(skip)
        .limit(limit),
      File.countDocuments(query),
    ]);
    return res.json({
      success: true,
      data: attachFileLocks(files, accessCtx),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }

  const { ranked, queryTokens, candidates } = await fuzzyRankFiles(req.query, req.user, q, { includeLocked: true, accessCtx });
  const total = ranked.length;
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);

  const projection = new Set(LIST_FIELDS);
  const locked = attachFileLocks(
    pageItems.map(({ file }) => file),
    accessCtx
  );
  const data = pageItems.map(({ score, matchType }, i) => {
    const obj = {};
    for (const key of projection) obj[key] = locked[i][key];
    obj._id = locked[i]._id;
    obj.locked = locked[i].locked;
    obj.score = score;
    obj.matchType = matchType;
    return obj;
  });

  const suggestion = suggestFileCorrection(queryTokens, candidates, pageItems[0]?.matchType || 'none');

  res.json({
    success: true,
    data,
    query: q,
    correctedQuery: suggestion || undefined,
    suggestion: suggestion || undefined,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
