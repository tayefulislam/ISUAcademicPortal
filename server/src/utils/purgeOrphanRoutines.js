import mongoose from 'mongoose';
import { purgeOrphanRoutines } from '../services/routineOrphans.js';

// One-off cleanup for routine rules/occurrences left pointing at a course or
// department that no longer exists — the state a course/department re-import
// leaves behind, where the class silently vanishes from every timetable.
//
//   npm --prefix server run routine:purge-orphans
//
// Safe to re-run. Only rows whose course/department does not resolve are
// touched; every healthy rule is left alone.
if (process.argv[1] && process.argv[1].endsWith('purgeOrphanRoutines.js')) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  try {
    const { templates, instances } = await purgeOrphanRoutines();
    console.log(`[routine] removed ${templates} orphaned rule(s) and ${instances} orphaned occurrence(s)`);
  } finally {
    await mongoose.disconnect();
  }
}

export default { purgeOrphanRoutines };
