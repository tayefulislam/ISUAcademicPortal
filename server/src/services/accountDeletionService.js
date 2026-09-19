import crypto from 'crypto';
import AccountDeletionRequest from '../models/AccountDeletionRequest.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { deleteStudentIdImage, deletePrivateImage } from './storage/storageService.js';

// Account deletion — the flow Google Play requires of an app that lets people
// create accounts, shaped to a university's needs.
//
// A request never deletes anything on its own. An administrator approves it,
// which is what actually erases the person's identifying data and closes the
// account; the academic records the university must retain (submissions,
// results, enrollments, uploaded materials) survive with the account reference
// intact but no longer pointing at an identifiable person.

function shape(request) {
  if (!request) return null;
  const doc = request.toObject ? request.toObject() : request;

  // `user` is populated for the admin queue; for a user's own view it is just
  // an id they already know, so it is only exposed when populated.
  const populated = doc.user && typeof doc.user === 'object' && doc.user.name;

  return {
    id: String(doc._id),
    status: doc.status,
    reason: doc.reason || '',
    requestedAt: doc.requestedAt,
    reviewedAt: doc.reviewedAt,
    reviewNote: doc.reviewNote || '',
    completedAt: doc.completedAt,
    user: populated
      ? {
        id: String(doc.user._id),
        name: doc.user.name,
        email: doc.user.email,
        role: doc.user.role,
        rollNo: doc.user.rollNo || '',
      }
      : undefined,
  };
}

/** The caller's own request, if they have ever made one. */
export async function myRequest(user) {
  const request = await AccountDeletionRequest.findOne({ user: user._id }).sort({ createdAt: -1 });
  return shape(request);
}

/**
 * Submits (or returns the existing) request. Idempotent on purpose: a user who
 * taps the button twice gets the same pending request rather than a queue of
 * duplicates for an admin to wade through.
 */
export async function requestDeletion(user, reason) {
  const existing = await AccountDeletionRequest.findOne({ user: user._id, status: 'pending' });
  if (existing) return shape(existing);

  const request = await AccountDeletionRequest.create({
    user: user._id,
    reason: String(reason || '').trim().slice(0, 1000),
  });
  return shape(request);
}

/** The admin queue. */
export async function listRequests({ status, page, limit } = {}) {
  const { page: safePage, limit: safeLimit, skip } = parsePagination({ page, limit }, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) filter.status = status;

  const [rows, total] = await Promise.all([
    AccountDeletionRequest.find(filter)
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('user', 'name email role rollNo'),
    AccountDeletionRequest.countDocuments(filter),
  ]);

  return {
    items: rows.map(shape),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) },
  };
}

/**
 * Erases the person's identifying data and closes the account.
 *
 * <p>Shared by both approval and a user deleting their own account outright,
 * so the two can never drift apart.
 */
export async function anonymizeAndClose(user) {
  // The Student ID photo is the most sensitive thing this system holds and the
  // only personal item stored outside the database — remove the object first.
  // Best-effort: a storage hiccup must not block closing the account, and the
  // record of what was stored is dropped either way.
  if (user.studentIdImage && user.studentIdImage.key) {
    await deleteStudentIdImage(user.studentIdImage).catch(() => {});
  } else if (user.studentIdImageKey) {
    await deletePrivateImage(user.studentIdImageKey).catch(() => {});
  }

  // Identifying fields are erased. The email becomes a per-account tombstone
  // rather than being cleared: it is required and unique, and a tombstone keeps
  // historical rows resolvable while making the address unusable for sign-in.
  user.name = 'Deleted user';
  user.email = `deleted+${user._id}@deleted.invalid`;
  user.phone = '';
  user.rollNo = '';
  user.designation = '';
  user.studentIdImageKey = '';
  user.studentIdImage = { provider: '', key: '', url: '', bucket: '', size: 0, mimeType: '', uploadedAt: null };
  user.status = 'blocked';
  user.approvalStatus = 'blocked';

  // An unguessable password, so no previously known credential can ever open
  // this account again even if it were later unblocked. The model's pre-save
  // hook hashes this on the way in.
  user.password = crypto.randomBytes(32).toString('hex');

  // Every token already issued to this account stops working immediately.
  user.tokenVersion = (user.tokenVersion || 0) + 1;

  await user.save();
}

/** Approves a request: the account is anonymised and closed. */
export async function approveRequest(admin, requestId, note) {
  const request = await AccountDeletionRequest.findById(requestId);
  if (!request) throw new ApiError(404, 'Deletion request not found');
  if (request.status !== 'pending') throw new ApiError(409, 'That request has already been reviewed');

  const user = await User.findById(request.user);
  if (user) {
    await anonymizeAndClose(user);
  }
  // A missing user is not an error: the account was already removed by other
  // means, and the request is simply closed out rather than left in the queue.

  request.status = 'approved';
  request.reviewedBy = admin._id;
  request.reviewedAt = new Date();
  request.reviewNote = String(note || '').trim().slice(0, 1000);
  request.completedAt = new Date();
  await request.save();

  return shape(request);
}

/** Rejects a request — the account is left exactly as it was. */
export async function rejectRequest(admin, requestId, note) {
  const request = await AccountDeletionRequest.findById(requestId);
  if (!request) throw new ApiError(404, 'Deletion request not found');
  if (request.status !== 'pending') throw new ApiError(409, 'That request has already been reviewed');

  request.status = 'rejected';
  request.reviewedBy = admin._id;
  request.reviewedAt = new Date();
  request.reviewNote = String(note || '').trim().slice(0, 1000);
  await request.save();

  return shape(request);
}

export default { myRequest, requestDeletion, listRequests, anonymizeAndClose, approveRequest, rejectRequest };
