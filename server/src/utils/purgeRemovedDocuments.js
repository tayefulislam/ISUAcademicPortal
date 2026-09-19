import mongoose from 'mongoose';
import { purgeRemovedDocuments } from '../services/documents/documentService.js';

// One-off cleanup for documents left behind by the old soft-delete behaviour:
// rows still sitting at `DELETED` or `EXPIRED`, each with its object in storage.
// Deletion is now permanent everywhere, so this only ever has work to do on a
// database that predates that change. Safe to re-run.
//
//   npm --prefix server run documents:purge
//
// Standalone entry: only runs when invoked directly, so importing this module
// from elsewhere is harmless.
if (process.argv[1] && process.argv[1].endsWith('purgeRemovedDocuments.js')) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  try {
    const { purged } = await purgeRemovedDocuments();
    console.log(`[documents] purged ${purged} leftover deleted/expired document(s)`);
  } finally {
    await mongoose.disconnect();
  }
}

export default { purgeRemovedDocuments };
