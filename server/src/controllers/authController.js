import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, department, batch } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  // Public registration always creates a student account; admins are
  // provisioned via the seed script or by an existing admin.
  const user = await User.create({
    name,
    email,
    password,
    department: department || null,
    batch: batch || null,
    role: 'student',
  });

  const token = signToken(user);
  res.status(201).json({ success: true, data: { user: user.toSafeObject(), token } });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'Account is deactivated');
  }

  const token = signToken(user);
  res.json({ success: true, data: { user: user.toSafeObject(), token } });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user.toSafeObject() } });
});
