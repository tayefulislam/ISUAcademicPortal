import mongoose from 'mongoose';
import Bookmark from '../models/Bookmark.js';
import BookmarkFolder from '../models/BookmarkFolder.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  CANDIDATE_CAP,
  sanitizeQuery,
  scoreDocument,
  suggestCorrection,
  tokenize,
} from '../utils/textSearch.js';

const FILE_POPULATE =
  'title originalName fileType mimeType fileSize fileUrl fileCount departmentCode courseName courseId batchCodes allBatches semester academicYear categoryName views downloads createdAt';

// 'default' is the reserved name of the built-in bucket (bookmarks with no
// folder document), so a query can select it without a fake folder document
// existing for every user.
const DEFAULT_FOLDER = 'default';

// The same typo-tolerant, weighted engine the Question Bank search uses, so a
// mistyped bookmark lookup ("algortihm" for "algorithms", "qeustion" for
// "question") behaves like every other search in the app instead of a second,
// weaker implementation. Order matters: the highest weight is treated as the
// primary field by the scorer's whole-phrase bonus.
export const SEARCH_FIELDS = [
  { key: 'title', weight: 10 },
  { key: 'originalName', weight: 8 },
  { key: 'courseName', weight: 6 },
  { key: 'courseId', weight: 6 },
  { key: 'categoryName', weight: 4 },
  { key: 'departmentCode', weight: 3 },
];

/**
 * Translates the `?folder=` parameter into a Mongo clause.
 *   absent / 'all'      -> no filter (the whole bookmarks list)
 *   'default' / 'none'  -> the built-in bucket (folder: null)
 *   <objectId>          -> that folder
 */
function folderClause(raw) {
  if (raw === undefined || raw === '' || raw === 'all') return null;
  if (raw === DEFAULT_FOLDER || raw === 'none') return { folder: null };
  if (!mongoose.isValidObjectId(raw)) throw new ApiError(400, 'Invalid folder');
  return { folder: raw };
}

/**
 * Resolves a client-supplied folder id to the value to store.
 * Returns `undefined` when the caller said nothing about the folder (so a
 * fresh bookmark falls to the schema default instead of being forced to null),
 * `null` for the default folder, or the folder's id.
 */
async function resolveFolderId(raw, userId) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '' || raw === DEFAULT_FOLDER) return null;
  if (!mongoose.isValidObjectId(raw)) throw new ApiError(400, 'Invalid folder');
  const folder = await BookmarkFolder.findOne({ _id: raw, user: userId }).select('_id');
  if (!folder) throw new ApiError(400, 'Folder not found');
  return folder._id;
}

/** One bookmarked file as the clients consume it: the file plus its bookmark state. */
function toBookmarkItem(bookmark) {
  return {
    ...bookmark.file.toObject(),
    bookmarkedAt: bookmark.createdAt,
    folder: bookmark.folder ? String(bookmark.folder._id) : null,
    folderName: bookmark.folder ? bookmark.folder.name : null,
  };
}

// GET /bookmarks?q=&folder=
export const listBookmarks = asyncHandler(async (req, res) => {
  const q = sanitizeQuery(req.query.q);
  const filter = { user: req.user._id, ...(folderClause(req.query.folder) || {}) };

  const bookmarks = await Bookmark.find(filter)
    .populate({ path: 'file', select: FILE_POPULATE })
    .populate({ path: 'folder', select: 'name' })
    .sort({ createdAt: -1 })
    .limit(CANDIDATE_CAP);

  // A bookmarked file may have since been deleted — drop those rather than
  // surfacing a null entry to the frontend.
  const live = bookmarks.filter((b) => b.file);

  // Under two characters there is nothing worth fuzzy-matching, and the
  // per-token scoring would match far too much — the whole list is the answer.
  if (q.length < 2) {
    return res.json({ success: true, query: q, suggestion: null, data: live.map(toBookmarkItem) });
  }

  const tokens = tokenize(q);
  const scored = [];
  for (const bookmark of live) {
    const match = scoreDocument(
      tokens,
      SEARCH_FIELDS.map((field) => ({ ...field, value: bookmark.file[field.key] }))
    );
    if (match) {
      scored.push({ item: toBookmarkItem(bookmark), score: match.score, matchType: match.matchType });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // "Did you mean" is drawn from words that actually exist in this user's own
  // bookmarks — never a fabricated term.
  const corpus = live.flatMap((b) => SEARCH_FIELDS.map((field) => b.file[field.key]));
  const suggestion = suggestCorrection(tokens, corpus, scored[0]?.matchType || 'none');

  res.json({
    success: true,
    query: q,
    suggestion,
    data: scored.map((entry) => entry.item),
  });
});

// POST /bookmarks/:fileId  (optional body { folderId })
export const addBookmark = asyncHandler(async (req, res) => {
  const folderId = await resolveFolderId(req.body ? req.body.folderId : undefined, req.user._id);

  try {
    const bookmark = await Bookmark.create({
      user: req.user._id,
      file: req.params.fileId,
      ...(folderId === undefined ? {} : { folder: folderId }),
    });
    res.status(201).json({ success: true, message: 'Bookmarked', data: bookmark });
  } catch (err) {
    if (err.code === 11000) {
      // Re-bookmarking is a no-op, not a conflict. When a folder was named,
      // though, the caller clearly wants it there — so treat that as a move,
      // and "save into folder X" is always true afterwards.
      if (folderId !== undefined) {
        await Bookmark.updateOne({ user: req.user._id, file: req.params.fileId }, { $set: { folder: folderId } });
        return res.json({ success: true, message: 'Already bookmarked — moved to the folder' });
      }
      return res.json({ success: true, message: 'Already bookmarked' });
    }
    throw err;
  }
});

// DELETE /bookmarks/:fileId
export const removeBookmark = asyncHandler(async (req, res) => {
  const result = await Bookmark.findOneAndDelete({ user: req.user._id, file: req.params.fileId });
  if (!result) throw new ApiError(404, 'Bookmark not found');
  res.json({ success: true, message: 'Removed from bookmarks' });
});

// PATCH /bookmarks/:fileId  { folderId }  — move between folders ('default' = no folder).
export const moveBookmark = asyncHandler(async (req, res) => {
  const raw = req.body ? req.body.folderId : undefined;
  if (raw === undefined) throw new ApiError(400, 'folderId is required');

  const folderId = await resolveFolderId(raw, req.user._id);
  const bookmark = await Bookmark.findOne({ user: req.user._id, file: req.params.fileId });
  if (!bookmark) throw new ApiError(404, 'Bookmark not found');

  bookmark.folder = folderId;
  await bookmark.save();
  res.json({
    success: true,
    message: 'Bookmark moved',
    data: { file: bookmark.file, folder: bookmark.folder },
  });
});

// Legacy toggle endpoint kept for the existing /users/me/favorites/:fileId
// route — now backed by the Bookmark collection instead of User.favorites.
export const toggleBookmark = asyncHandler(async (req, res) => {
  const existing = await Bookmark.findOneAndDelete({ user: req.user._id, file: req.params.fileId });
  if (existing) {
    return res.json({ success: true, message: 'Removed from bookmarks', data: { bookmarked: false } });
  }
  await Bookmark.create({ user: req.user._id, file: req.params.fileId });
  res.json({ success: true, message: 'Bookmarked', data: { bookmarked: true } });
});

// ----- Folders -----

// GET /bookmark-folders — the user's folders, each with a live count, plus the
// default bucket's count so a client can render the whole selector from one call.
export const listFolders = asyncHandler(async (req, res) => {
  const [folders, bookmarks] = await Promise.all([
    BookmarkFolder.find({ user: req.user._id }).sort({ name: 1 }),
    Bookmark.find({ user: req.user._id }).select('file folder'),
  ]);

  // Counts follow the same "a bookmark whose file is gone does not exist" rule
  // the list endpoint applies, so the numbers always match what is listed.
  const liveFileIds = await File.find({ _id: { $in: bookmarks.map((b) => b.file) } }).distinct('_id');
  const live = new Set(liveFileIds.map(String));

  const counts = new Map();
  let defaultCount = 0;
  let total = 0;
  for (const bookmark of bookmarks) {
    if (!live.has(String(bookmark.file))) continue;
    total += 1;
    if (!bookmark.folder) {
      defaultCount += 1;
      continue;
    }
    const key = String(bookmark.folder);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  res.json({
    success: true,
    data: {
      folders: folders.map((folder) => ({
        _id: folder._id,
        name: folder.name,
        createdAt: folder.createdAt,
        fileCount: counts.get(String(folder._id)) || 0,
      })),
      defaultCount,
      total,
    },
  });
});

// POST /bookmark-folders  { name }
export const createFolder = asyncHandler(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) throw new ApiError(400, 'A folder name is required');

  try {
    const folder = await BookmarkFolder.create({ user: req.user._id, name });
    res.status(201).json({ success: true, message: 'Folder created', data: folder });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'You already have a folder with that name');
    throw err;
  }
});

// PATCH /bookmark-folders/:id  { name }
export const renameFolder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Folder not found');
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) throw new ApiError(400, 'A folder name is required');

  const folder = await BookmarkFolder.findOne({ _id: req.params.id, user: req.user._id });
  if (!folder) throw new ApiError(404, 'Folder not found');

  folder.name = name;
  try {
    await folder.save();
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'You already have a folder with that name');
    throw err;
  }
  res.json({ success: true, message: 'Folder renamed', data: folder });
});

// DELETE /bookmark-folders/:id — the folder's bookmarks fall back to the default
// bucket. Deleting a folder must never lose a saved file.
export const deleteFolder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Folder not found');

  const folder = await BookmarkFolder.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!folder) throw new ApiError(404, 'Folder not found');

  const moved = await Bookmark.updateMany(
    { user: req.user._id, folder: folder._id },
    { $set: { folder: null } }
  );

  res.json({
    success: true,
    message: 'Folder deleted',
    data: { movedToDefault: moved.modifiedCount },
  });
});
