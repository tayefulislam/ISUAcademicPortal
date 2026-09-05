import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;
  const filter = {};
  if (role) filter.role = role;

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.json({ success: true, data: users, pagination: { page: Number(page), limit: Number(limit), total } });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['student', 'admin'].includes(role)) throw new ApiError(400, 'Invalid role');

  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: user });
});

export const setUserActive = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: Boolean(isActive) }, { new: true });
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: user });
});

export const toggleFavorite = asyncHandler(async (req, res) => {
  const user = req.user;
  const fileId = req.params.fileId;
  const idx = user.favorites.findIndex((f) => f.toString() === fileId);

  if (idx >= 0) {
    user.favorites.splice(idx, 1);
  } else {
    user.favorites.push(fileId);
  }
  await user.save();

  res.json({ success: true, data: { favorites: user.favorites } });
});

export const listFavorites = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('favorites');
  res.json({ success: true, data: user.favorites });
});
