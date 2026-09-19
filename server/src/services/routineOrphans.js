import Course from '../models/Course.js';
import Department from '../models/Department.js';
import RoutineTemplate from '../models/RoutineTemplate.js';
import ScheduleInstance from '../models/ScheduleInstance.js';

/**
 * Routine rows whose `course`/`department` no longer resolves.
 *
 * <p>A rule holds its course and department by id. If either document is deleted
 * and re-created (a course re-import, a reseed), the rule keeps pointing at the
 * old id: the class loses its course name, and the audience filter — which
 * matches on `department` or a reachable `course` — can no longer match it, so
 * the class silently disappears from every timetable. These are the leftovers
 * that detection cleans up.
 *
 * <p>Pure, so the matching rule is unit-tested without a database.
 */
export function isOrphanRoutine(row, { courses, departments, templates }) {
  if (!row) return true;
  if (!courses.has(String(row.course))) return true;
  if (!departments.has(String(row.department))) return true;
  // Only occurrences carry a template; a missing one is an orphan too.
  if (row.template !== undefined && !templates.has(String(row.template))) return true;
  return false;
}

/** The orphaned rules and occurrences currently in the database. */
export async function findOrphanRoutines() {
  const [courseIds, departmentIds] = await Promise.all([
    Course.distinct('_id'),
    Department.distinct('_id'),
  ]);
  const courses = new Set(courseIds.map(String));
  const departments = new Set(departmentIds.map(String));

  const templates = await RoutineTemplate.find({}).select('_id course department').lean();
  const templatesSet = new Set(templates.map((t) => String(t._id)));

  const instances = await ScheduleInstance.find({}).select('_id course department template').lean();

  return {
    orphanTemplates: templates.filter((t) => isOrphanRoutine(t, { courses, departments, templates: templatesSet })),
    orphanInstances: instances.filter((i) => isOrphanRoutine(i, { courses, departments, templates: templatesSet })),
  };
}

/**
 * Removes them. Occurrences first, then the rules they belonged to, so nothing
 * is ever left orphaned mid-way. Safe to re-run — it finds nothing once clean.
 */
export async function purgeOrphanRoutines() {
  const { orphanTemplates, orphanInstances } = await findOrphanRoutines();

  if (orphanInstances.length) {
    await ScheduleInstance.deleteMany({ _id: { $in: orphanInstances.map((i) => i._id) } });
  }
  if (orphanTemplates.length) {
    await RoutineTemplate.deleteMany({ _id: { $in: orphanTemplates.map((t) => t._id) } });
  }

  return { templates: orphanTemplates.length, instances: orphanInstances.length };
}

export default { isOrphanRoutine, findOrphanRoutines, purgeOrphanRoutines };
