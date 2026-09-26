import { ApiError } from '../../../utils/ApiError.js';
import { isSuperAdminTier } from '../../../models/Role.js';
import { getEffectiveCourseIds } from '../../courseAccessService.js';

/**
 * Authorization for a stored file (§18).
 *
 * The spec's non-negotiable: "a student must never be able to access another
 * student's private file by changing a URL or file ID." That holds because every
 * read goes through `assertCanAccess` against the RECORD fetched from the
 * database — never against anything the client supplied — and the default
 * visibility is `private`, so the absence of a policy denies rather than allows.
 *
 * The policy axes mirror the ones the existing academic-material model already
 * uses (visibility + department/course/batch/role), so an operator reasons about
 * one access model, not two.
 */

/** The uploader. */
export function isOwner(record, user) {
  return Boolean(user && record?.ownerId && String(record.ownerId) === String(user._id));
}

/**
 * Whether `user` may read `record`.
 *
 * @returns {Promise<boolean>}
 */
export async function canAccessStoredFile(record, user) {
  if (!record) return false;

  // The owner always can — including while the file is still processing.
  if (isOwner(record, user)) return true;

  // The super-admin tier bypasses policy entirely, as elsewhere in this app.
  if (user && isSuperAdminTier(user.role)) return true;

  switch (record.visibility) {
    case 'public':
      return true;
    case 'role':
      return Boolean(user && (record.allowedRoles || []).includes(user.role));
    case 'department':
      return Boolean(user && record.department && String(record.department) === String(user.department));
    case 'batch':
      return Boolean(
        user && (record.batches || []).some((batch) => String(batch) === String(user.batch))
      );
    case 'course': {
      if (!user || !record.course) return false;
      // Reuses the same "reachable courses" rule as the rest of the app:
      // the user's own department's courses, plus anything they are enrolled in.
      const effective = await getEffectiveCourseIds(user);
      return effective.includes(String(record.course));
    }
    case 'private':
    default:
      // Deny by default — an unrecognized or absent policy is not a grant.
      return false;
  }
}

/** Throws 403 unless the caller may read the record. */
export async function assertCanAccess(record, user) {
  if (!(await canAccessStoredFile(record, user))) {
    throw new ApiError(403, 'You do not have access to this file', null, 'FORBIDDEN');
  }
}

/**
 * Throws 403 unless the caller owns the record (or is super-admin tier).
 * Used for destructive and mutating operations — reading may be shared, but
 * deleting and retrying are the owner's.
 */
export function assertOwnerOrAdmin(record, user) {
  if (isOwner(record, user)) return;
  if (user && isSuperAdminTier(user.role)) return;
  throw new ApiError(403, 'You can only manage files you uploaded', null, 'FORBIDDEN');
}

export default { isOwner, canAccessStoredFile, assertCanAccess, assertOwnerOrAdmin };
