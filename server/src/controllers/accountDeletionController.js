import { asyncHandler } from '../utils/asyncHandler.js';
import * as deletions from '../services/accountDeletionService.js';

// Account deletion. The user-facing half lives under /profile (it is about the
// caller's own account); the review half under /super-admin, because deciding
// it is an administrative act.

// ----- The caller's own account -----

/** The caller's request, or null when they have never made one. */
export const getMyDeletionRequest = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deletions.myRequest(req.user) });
});

/**
 * Asks for the caller's account to be deleted. Idempotent — a second call
 * returns the same pending request.
 */
export const requestAccountDeletion = asyncHandler(async (req, res) => {
  const data = await deletions.requestDeletion(req.user, req.body?.reason);
  res.status(201).json({
    success: true,
    data,
    message: 'Your deletion request has been submitted. An administrator will review it.',
  });
});

// ----- Review (Super Admin tier) -----

export const listDeletionRequests = asyncHandler(async (req, res) => {
  const result = await deletions.listRequests({
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const approveDeletionRequest = asyncHandler(async (req, res) => {
  const data = await deletions.approveRequest(req.user, req.params.id, req.body?.note);
  res.json({
    success: true,
    data,
    message: 'Account deleted. Identifying data has been erased and the account can no longer sign in.',
  });
});

export const rejectDeletionRequest = asyncHandler(async (req, res) => {
  const data = await deletions.rejectRequest(req.user, req.params.id, req.body?.note);
  res.json({ success: true, data, message: 'Deletion request rejected.' });
});

export default {
  getMyDeletionRequest,
  requestAccountDeletion,
  listDeletionRequests,
  approveDeletionRequest,
  rejectDeletionRequest,
};
