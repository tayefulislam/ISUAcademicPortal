import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { isAdminTierRole } from '../models/Role.js';
import { resolveGroup } from '../utils/groups.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate(POPULATE);
  res.json({ success: true, data: user.toSafeObject() });
});

// Self-service profile update. Deliberately whitelisted — email, role,
// status and tokenVersion can never be changed through this endpoint, no
// matter what the request body contains. The authenticated user can only
// ever update their own document (req.user._id comes from the verified
// token, never from the request body/params).
// Department/Batch are academic-record fields set at registration/enrollment
// time — a Student or a CR (still a student underneath, just promoted with
// extra permissions) must not be able to move themselves to a different
// department/batch through their own profile form. Every other field these
// two roles had before (name/rollNo/phone/semester) stays editable; every
// other role is unaffected.
//
// `group` is NOT locked with them, and the distinction is deliberate: moving
// department or batch moves someone across cohorts, which is why the academic
// office owns those. A class group only decides which half of the student's OWN
// batch's timetable they are shown — the same kind of self-declared placement as
// semester, and useless as data unless the student can state it. It is validated
// against the configured list like every other write of this field.
async function resolveEditableFields(user) {
  const isCustomAdminTierRole = user.role !== 'admin' && (await isAdminTierRole(user.role));
  return editableProfileFields(user.role, isCustomAdminTierRole);
}

/**
 * The fields each role may change through their OWN profile (pure, so the rule
 * is tested without a database or a role lookup).
 *
 * <p>A student — and a CR, who is a student underneath with extra permissions —
 * may keep their own contact details and placement, but not the two values the
 * institution owns: the name and the Student ID. Those are printed on official
 * documents and matched against records, so they are the academic office's to
 * change, not the account holder's. Department/batch move someone across
 * cohorts and are locked for the same reason.
 */
export function editableProfileFields(role, isCustomAdminTierRole = false) {
  const base = ['name', 'rollNo', 'phone', 'department', 'batch', 'semester', 'group'];
  const studentLike = role === 'student' || isCustomAdminTierRole;
  if (!studentLike) return base;
  return base.filter((key) => !['department', 'batch', 'name', 'rollNo'].includes(key));
}

export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = await resolveEditableFields(req.user);
  const update = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    // `group` comes from an admin-editable list and is a plain string, not an
    // ObjectId, so it is validated and normalised rather than passed through —
    // and an empty value means "the whole batch" rather than null.
    if (key === 'group') {
      update.group = await resolveGroup(req.body[key]);
      continue;
    }
    update[key] = key === 'rollNo' || key === 'phone' ? String(req.body[key] || '').trim() : req.body[key] || null;
  }

  // rollNo doubles as the institution's Student ID — globally unique across
  // every department/batch (see models/User.js's unique index).
  if (update.rollNo) {
    const duplicate = await User.findOne({ rollNo: update.rollNo, _id: { $ne: req.user._id } });
    if (duplicate) {
      throw new ApiError(409, 'This Student ID is already registered with another account. Please check your Student ID or contact the administrator.');
    }
  }

  // Phone doubles as a login identifier too (authController.js's login()) —
  // same uniqueness guarantee as rollNo.
  if (update.phone) {
    if (!/^01\d{9}$/.test(update.phone)) {
      throw new ApiError(400, 'Phone number must be exactly 11 digits and start with 01');
    }
    const duplicatePhone = await User.findOne({ phone: update.phone, _id: { $ne: req.user._id } });
    if (duplicatePhone) {
      throw new ApiError(409, 'This phone number is already registered. Please use another phone number or log in to your existing account.');
    }
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, {
    new: true,
    runValidators: true,
  }).populate(POPULATE);

  res.json({ success: true, message: 'Profile updated successfully', data: user.toSafeObject() });
});
