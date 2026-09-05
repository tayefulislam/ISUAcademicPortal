import Batch from '../models/Batch.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listBatches = asyncHandler(async (req, res) => {
  const { department } = req.query;
  const filter = { status: 'active' };
  if (department) filter.department = department;

  const batches = await Batch.find(filter).sort({ name: 1 });
  res.json({ success: true, data: batches });
});

export const getBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw new ApiError(404, 'Batch not found');
  res.json({ success: true, data: batch });
});

export const createBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.create(req.body);
  res.status(201).json({ success: true, data: batch });
});

export const updateBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!batch) throw new ApiError(404, 'Batch not found');
  res.json({ success: true, data: batch });
});

export const deleteBatch = asyncHandler(async (req, res) => {
  const inUse = await File.exists({ batches: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a batch that still has files');

  const batch = await Batch.findByIdAndDelete(req.params.id);
  if (!batch) throw new ApiError(404, 'Batch not found');
  res.json({ success: true, message: 'Batch deleted' });
});
