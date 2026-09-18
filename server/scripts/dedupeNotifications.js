// Removes duplicate notifications, then (re)builds the dedupe index.
//
// WHY THIS EXISTS
//   Notification carries a unique index on {recipient, type, entityType,
//   entityId} — that is what makes a repeated event a no-op. A unique index
//   cannot be built while duplicates already exist, and a failed build is
//   silent: the app keeps running, the index is simply absent, and every retry
//   then writes another copy. The visible symptom is a reminder arriving every
//   minute for as long as its window is open (the reminder engine scans a
//   ±5-minute window, so an unindexed deployment produces ~11 copies per
//   offset per class).
//
//   Run this once on any database that has duplicates. It is safe to re-run:
//   with nothing to remove it just re-asserts the index.
//
// WHICH DATABASE?
//   MONGODB_URI (server/.env) — your LOCAL database — unless you pass --uri.
//   Production is a separate database; point it there explicitly:
//
//     node scripts/dedupeNotifications.js --uri "mongodb+srv://..." --dry-run
//     node scripts/dedupeNotifications.js --uri "mongodb+srv://..."
//
//   Always --dry-run first on production: it reports exactly what would be
//   deleted without deleting anything.

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import Notification from '../src/models/Notification.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

const uri = arg('uri') || env.mongodbUri;
const dryRun = has('dry-run');
// Never print credentials embedded in a URI.
const safeUri = uri.replace(/\/\/[^@]*@/, '//***:***@');

async function main() {
  console.log(`[dedupe] database: ${safeUri}`);
  console.log(`[dedupe] mode: ${dryRun ? 'DRY RUN — nothing will be deleted' : 'LIVE — duplicates will be deleted'}`);

  await mongoose.connect(uri);

  // Group by the exact key the index enforces. `$sort` inside the group puts the
  // oldest first, so the row we keep is the one the user would have seen first
  // (and the one any push already pointed at).
  const groups = await Notification.aggregate([
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: {
          recipient: '$recipient',
          type: '$type',
          entityType: '$entityType',
          entityId: '$entityId',
        },
        count: { $sum: 1 },
        keep: { $first: '$_id' },
        remove: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5000 },
  ]);

  const totalDuplicates = groups.reduce((sum, g) => sum + (g.count - 1), 0);
  console.log(`[dedupe] duplicate groups: ${groups.length}`);
  console.log(`[dedupe] surplus rows:     ${totalDuplicates}`);

  if (!dryRun && totalDuplicates > 0) {
    let removed = 0;
    const byKey = groups.map((g) => g._id);
    for (let i = 0; i < groups.length; i += 500) {
      const batch = groups.slice(i, i + 500);
      const ids = batch.flatMap((g) => g.remove.slice(1)); // everything but the oldest
      if (!ids.length) continue;
      const res = await Notification.deleteMany({ _id: { $in: ids } });
      removed += res.deletedCount || 0;
    }
    console.log(`[dedupe] deleted:          ${removed}`);
    if (byKey.length) {
      console.log('[dedupe] affected keys (first 5):');
      byKey.slice(0, 5).forEach((k) => console.log(`         ${k.type} ${k.entityType} ${k.entityId} -> ${k.recipient}`));
    }
  }

  // Now that the data is clean, assert the schema's indexes.
  try {
    await Notification.syncIndexes();
    console.log('[dedupe] notification indexes synchronised');
  } catch (err) {
    console.error('[dedupe] FAILED to synchronise indexes:', err.message);
    console.error('[dedupe] duplicates remain — re-run without --dry-run and check again');
    process.exitCode = 1;
  }

  const indexes = await Notification.collection.indexes();
  const unique = indexes.find((i) => i.unique && i.key && i.key.recipient && i.key.type);
  console.log(`[dedupe] dedupe index present: ${unique ? 'yes' : 'NO — duplicate notifications will keep being created'}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[dedupe] failed:', err);
  process.exit(1);
});
