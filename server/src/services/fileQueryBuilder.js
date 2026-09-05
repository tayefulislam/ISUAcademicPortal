/**
 * Builds a MongoDB filter for the File collection from search/list query params.
 * Shared by GET /api/files and GET /api/search so both honor the same filters.
 */
export function buildFileQuery(query) {
  const {
    q,
    department,
    course,
    courseId,
    batch,
    semester,
    academicYear,
    fileType,
    category,
    dateFrom,
    dateTo,
  } = query;

  const filter = { status: 'active' };

  if (q) filter.$text = { $search: String(q) };
  if (department) filter.department = department;
  if (course) filter.course = course;
  if (courseId) filter.courseId = new RegExp(`^${escapeRegex(courseId)}$`, 'i');
  if (batch) filter.$or = [{ batches: batch }, { batchCodes: new RegExp(`^${escapeRegex(batch)}$`, 'i') }, { allBatches: true }];
  if (semester) filter.semester = semester;
  if (academicYear) filter.academicYear = academicYear;
  if (fileType) filter.fileType = fileType;
  if (category) filter.category = category;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  return filter;
}

export function buildSortOption(sort, hasTextSearch) {
  if (hasTextSearch && !sort) return { score: { $meta: 'textScore' }, createdAt: -1 };

  switch (sort) {
    case 'oldest':
      return { createdAt: 1 };
    case 'popular':
      return { views: -1, downloads: -1 };
    case 'downloads':
      return { downloads: -1 };
    case 'name':
      return { title: 1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
