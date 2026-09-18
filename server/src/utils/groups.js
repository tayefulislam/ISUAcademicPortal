import { getSettings, DEFAULT_ACADEMIC_GROUPS, GROUP_BOTH } from '../models/Settings.js';
import { ApiError } from './ApiError.js';

export { GROUP_BOTH };

/** Group values are stored/compared upper-cased so "a1" and "A1" are one group. */
export function normalizeGroup(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/**
 * The groups this deployment recognises — read from Settings so a batch can be
 * split further (A3, B1, ...) without a code change. Falls back to the built-in
 * list when unconfigured, and always includes BOTH: an entry stored as BOTH
 * means "the whole batch", so removing it would make group-agnostic entries
 * unaddressable.
 */
export async function getAcademicGroups() {
  const settings = await getSettings();
  const configured = (settings.academicGroups || []).map(normalizeGroup).filter(Boolean);
  const groups = configured.length ? configured : [...DEFAULT_ACADEMIC_GROUPS];
  return groups.includes(GROUP_BOTH) ? groups : [GROUP_BOTH, ...groups];
}

/** The value to store for a caller-supplied group — empty means "whole batch". */
export async function resolveGroup(raw) {
  const group = normalizeGroup(raw) || GROUP_BOTH;
  const allowed = await getAcademicGroups();
  if (!allowed.includes(group)) {
    throw new ApiError(400, `Unknown group "${raw}". Allowed groups: ${allowed.join(', ')}`);
  }
  return group;
}

/**
 * The group constraint for "which entries must reach this user", or `null` when
 * there is none.
 *
 * A student whose own group is BOTH is in the whole batch, so nothing is
 * filtered out for them. A student in A1 matches A1 and BOTH entries — never
 * A2. Returning `null` rather than `{ $in: [every group] }` matters: the set of
 * groups is admin-editable, so "no constraint" must stay expressible without
 * enumerating a list that may have grown.
 */
export function groupFilterFor(user) {
  const own = normalizeGroup(user?.group) || GROUP_BOTH;
  if (own === GROUP_BOTH) return null;
  return { $in: [GROUP_BOTH, own] };
}
