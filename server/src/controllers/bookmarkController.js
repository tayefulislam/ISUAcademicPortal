import Bookmark from '../models/Bookmark.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

const FILE_POPULATE =
  'title originalName fileType mimeType fileSize fileUrl fileCount departmentCode courseName courseId batchCodes allBatches semester academicYear categoryName views downloads createdAt';

export const listBookmarks = asyncHandler(async (req, res) => {
  const bookmarks = await Bookmark.find({ user: req.user._id })
    .populate({ path: 'file', select: FILE_POPULATE })
    .sort({ createdAt: -1 });

  // A bookmarked file may have since been deleted — drop those rather than
  // surfacing a null entry to the frontend.
  const files = bookmarks.filter((b) => b.file).map((b) => ({ ...b.file.toObject(), bookmarkedAt: b.createdAt }));

  res.json({ success: true, data: files });
});

export const addBookmark = asyncHandler(async (req, res) => {
  try {
    const bookmark = await Bookmark.create({ user: req.user._id, file: req.params.fileId });
    res.status(201).json({ success: true, message: 'Bookmarked', data: bookmark });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({ success: true, message: 'Already bookmarked' });
    }
    throw err;
  }
});

export const removeBookmark = asyncHandler(async (req, res) => {
  const result = await Bookmark.findOneAndDelete({ user: req.user._id, file: req.params.fileId });
  if (!result) throw new ApiError(404, 'Bookmark not found');
  res.json({ success: true, message: 'Removed from bookmarks' });
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
