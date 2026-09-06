import Topic from '../models/Topic.js';
import Chapter from '../models/Chapter.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listTopics = asyncHandler(async (req, res) => {
  const { chapter, course } = req.query;
  const filter = { status: 'active' };
  if (chapter) filter.chapter = chapter;
  if (course) filter.course = course;
  const topics = await Topic.find(filter).sort({ order: 1, name: 1 });
  res.json({ success: true, data: topics });
});

export const getTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (!topic) throw new ApiError(404, 'Topic not found');
  res.json({ success: true, data: topic });
});

export const createTopic = asyncHandler(async (req, res) => {
  const { chapterId, name, order } = req.body;
  const chapter = await Chapter.findById(chapterId);
  if (!chapter) throw new ApiError(400, 'Invalid chapter');

  const topic = await Topic.create({ name, chapter: chapter._id, course: chapter.course, order });
  res.status(201).json({ success: true, data: topic });
});

export const updateTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!topic) throw new ApiError(404, 'Topic not found');
  res.json({ success: true, data: topic });
});

export const deleteTopic = asyncHandler(async (req, res) => {
  const inUse = await File.exists({ topic: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a topic that still has files');

  const topic = await Topic.findByIdAndDelete(req.params.id);
  if (!topic) throw new ApiError(404, 'Topic not found');
  res.json({ success: true, message: 'Topic deleted' });
});
