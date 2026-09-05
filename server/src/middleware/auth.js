import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Verifies the JWT, then re-loads the user straight from the database on
// every request — role and status are never trusted from the token alone.
// Returns { user: null } if the token is structurally invalid/expired, or
// { user, stale: true } if it decoded fine but was issued before a
// password change / block / role change (tokenVersion mismatch) — callers
// use `stale` to still report a specific reason (e.g. "blocked") instead of
// a generic invalid-token message.
async function resolveUserFromToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  const user = await User.findById(payload.sub);
  if (!user) return { user: null };

  const stale = typeof payload.tokenVersion === 'number' && payload.tokenVersion !== user.tokenVersion;
  return { user, stale };
}

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw new ApiError(401, 'Authentication required', null, 'UNAUTHORIZED');
  }

  let resolved;
  try {
    resolved = await resolveUserFromToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token', null, 'UNAUTHORIZED');
  }

  const { user, stale } = resolved;
  if (!user) {
    throw new ApiError(401, 'Invalid or expired token', null, 'UNAUTHORIZED');
  }
  if (user.status === 'blocked') {
    throw new ApiError(403, 'Your account has been blocked', null, 'FORBIDDEN');
  }
  if (stale) {
    throw new ApiError(401, 'Your session has expired, please sign in again', null, 'UNAUTHORIZED');
  }

  req.user = user;
  next();
});

// Attaches req.user if a valid token is present, but never rejects the request.
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  try {
    const { user, stale } = await resolveUserFromToken(token);
    if (user && !stale && user.status !== 'blocked') req.user = user;
  } catch {
    // ignore invalid token for optional auth
  }
  next();
});

// requireRole('admin', 'super_admin') — usable as requireRoles too, same check.
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'Insufficient permissions', null, 'FORBIDDEN'));
  }
  next();
};

export const requireRoles = requireRole;
