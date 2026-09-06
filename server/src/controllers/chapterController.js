import Chapter from '../models/Chapter.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listChapters = asyncHandler(async (req, res) => {
  const { course } = req.query;
  const filter = { status: 'active' };
  if (course) filter.course = course;
  const chapters = await Chapter.find(filter).sort({ order: 1, name: 1 });
  res.json({ success: true, data: chapters });
});

export const getChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) throw new ApiError(404, 'Chapter not found');
  res.json({ success: true, data: chapter });
});

export const createChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.create(req.body);
  res.status(201).json({ success: true, data: chapter });
});

export const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!chapter) throw new ApiError(404, 'Chapter not found');
  res.json({ success: true, data: chapter });
});

export const deleteChapter = asyncHandler(async (req, res) => {
  const inUse = await File.exists({ chapter: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a chapter that still has files');

  const chapter = await Chapter.findByIdAndDelete(req.params.id);
  if (!chapter) throw new ApiError(404, 'Chapter not found');
  res.json({ success: true, message: 'Chapter deleted' });
});
