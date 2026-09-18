// Which templates a user may see and use. Pure on purpose: the caller does the
// (async) course lookup and hands in a plain context, so every branch here is
// unit-testable without a database.

const PRIVILEGED_ROLES = ['super_admin', 'administrator'];

/**
 * "Act as a student" roles that are neither student nor faculty and are not the
 * unrestricted admin — a custom admin-tier role such as "CR". They may use the
 * module (the same precedent as Submit Material / Assignments) but are not
 * treated as staff for eligibility.
 */
export function effectiveAudience(user, { isAdminTierRole = false } = {}) {
  if (!user) return null;
  if (PRIVILEGED_ROLES.includes(user.role) || user.role === 'admin' || isAdminTierRole) return 'staff';
  if (user.role === 'faculty') return 'faculty';
  return 'student';
}

/**
 * @param {object} template
 * @param {object} ctx
 * @param {'student'|'faculty'|'staff'} ctx.audience
 * @param {Set<string>} ctx.departmentIds  ids the audience may use (student's own
 *   department, or a faculty member's assigned departments); ignored for staff.
 * @param {Set<string>} ctx.courseIds       ids the audience may reach; ignored for staff.
 * @param {Set<string>} [ctx.templateDepartments] departments covered, as strings (may be empty = all)
 */
export function isTemplateEligible(template, ctx) {
  if (!template || template.status !== 'ACTIVE') return false;

  // Staff preview every active template; the audience that matters here is the
  // student's or faculty member's.
  if (ctx.audience === 'staff') return true;

  const availableFor = template.availableFor || [];
  if (!availableFor.includes(ctx.audience)) return false;

  const templateDepartments = (template.departmentIds || []).map(String);
  const departmentOk = templateDepartments.length === 0
    || templateDepartments.some((id) => ctx.departmentIds?.has(id));
  if (!departmentOk) return false;

  if (template.courseId) {
    const courseId = String(template.courseId._id || template.courseId);
    if (!ctx.courseIds?.has(courseId)) return false;
  }

  return true;
}

export function filterEligibleTemplates(templates, ctx) {
  return (templates || []).filter((template) => isTemplateEligible(template, ctx));
}

export default { isTemplateEligible, filterEligibleTemplates, effectiveAudience };
