// Typo-tolerant search for the File/material catalog (`GET /files` and
// `GET /search`) — the same engine (server/src/utils/textSearch.js) already
// powering Question Bank search, applied to a different document shape.
// Reuses buildFileQuery's existing scope/access filter unchanged (department/
// course/batch/category/date/visibility/restrictions) — only the free-text
// `q` matching itself is replaced; every other filter still narrows the
// candidate set with a normal indexed Mongo query first.
import File from '../models/File.js';
import { tokenize, scoreDocument, suggestCorrection, sanitizeQuery, CANDIDATE_CAP } from '../utils/textSearch.js';
import { buildFileQuery } from './fileQueryBuilder.js';

// `title` weighted highest so it acts as the "primary" field for
// scoreDocument's whole-phrase bonus (see textSearch.js) — a file's title is
// the File equivalent of a question's questionText.
export const FILE_FIELD_WEIGHTS = {
  title: 10,
  keywords: 8,
  originalName: 6,
  courseName: 6,
  courseId: 6,
  departmentCode: 4,
  categoryName: 4,
  description: 3,
};

function fileSearchFields(doc) {
  return [
    { key: 'title', weight: FILE_FIELD_WEIGHTS.title, value: doc.title },
    { key: 'keywords', weight: FILE_FIELD_WEIGHTS.keywords, value: doc.keywords || [] },
    { key: 'originalName', weight: FILE_FIELD_WEIGHTS.originalName, value: doc.originalName },
    { key: 'courseName', weight: FILE_FIELD_WEIGHTS.courseName, value: doc.courseName },
    { key: 'courseId', weight: FILE_FIELD_WEIGHTS.courseId, value: doc.courseId },
    { key: 'departmentCode', weight: FILE_FIELD_WEIGHTS.departmentCode, value: doc.departmentCode },
    { key: 'categoryName', weight: FILE_FIELD_WEIGHTS.categoryName, value: doc.categoryName },
    { key: 'description', weight: FILE_FIELD_WEIGHTS.description, value: doc.description || '' },
  ];
}

/**
 * Given an already-built Mongo scope filter (any structured/access
 * narrowing — department/course/batch/ownership/etc), fetches up to
 * CANDIDATE_CAP candidates and fuzzy-ranks them against `rawQuery`. This is
 * the low-level primitive — use it directly for a filter that doesn't come
 * from buildFileQuery (e.g. "my own uploads", "my assigned scope"); use
 * `fuzzyRankFiles` below when it does.
 *
 * @returns {Promise<{ranked: Array<{file, score, matchType}>, queryTokens: string[], candidates: object[]}>}
 */
export async function rankFileCandidates(scopeFilter, rawQuery) {
  const candidates = await File.find(scopeFilter).sort({ createdAt: -1 }).limit(CANDIDATE_CAP);

  const queryTokens = tokenize(sanitizeQuery(rawQuery));
  const ranked = [];
  for (const file of candidates) {
    const result = scoreDocument(queryTokens, fileSearchFields(file));
    if (result) ranked.push({ file, score: result.score, matchType: result.matchType });
  }
  ranked.sort((a, b) => b.score - a.score);

  return { ranked, queryTokens, candidates };
}

/** Convenience wrapper for the common case: scope filter comes from buildFileQuery. */
export async function fuzzyRankFiles(query, user, rawQuery, opts = {}) {
  const { q, ...rest } = query;
  const scopeFilter = await buildFileQuery(rest, user, opts);
  return rankFileCandidates(scopeFilter, rawQuery);
}

/** "Did you mean" built from the actual candidate set's own title/keywords text. */
export function suggestFileCorrection(queryTokens, candidates, topMatchType) {
  const corpusText = candidates.flatMap((f) => [f.title, ...(f.keywords || [])]);
  return suggestCorrection(queryTokens, corpusText, topMatchType);
}
