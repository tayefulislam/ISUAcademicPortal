import StoredFile from '../../../models/StoredFile.js';
import File from '../../../models/File.js';
import Assignment from '../../../models/Assignment.js';
import Submission from '../../../models/Submission.js';
import Notice from '../../../models/Notice.js';
import Question from '../../../models/Question.js';
import User from '../../../models/User.js';
import * as storage from '../../storage/storageService.js';
import { logger } from '../../../utils/logger.js';

/**
 * The orphaned-object backstop (§21).
 *
 * Deleting a domain record already removes its objects and its `StoredFile`
 * rows. This sweep exists for the paths that CANNOT: a record deleted while
 * MongoDB was unreachable, a row whose write raced a crash, a multipart upload
 * aborted after its object was already completed. Such an object is billed for
 * forever with nothing pointing at it, and nothing else in the system will ever
 * notice.
 *
 * It works by REFERENCE, never by age alone: a row's object is removed only when
 * no live record names its `storageKey` anywhere. A file that is merely old but
 * still referenced — an untouched material, a student's own upload — is left
 * exactly where it is. That is what makes this safe to run on every sweep
 * instead of only after a catastrophe.
 */

/** Kinds whose objects this sweep may reclaim. `standalone` and
 * `document-template` are deliberately excluded — a standalone file is the
 * user's own upload, and a template source lives under a private key this
 * surface does not address. */
const SWEEPABLE_KINDS = ['material', 'assignment', 'submission', 'notice', 'question', 'student-id'];

/** Does any live domain record still name this object? */
async function isReferenced(row) {
  const key = row.storageKey;
  if (!key) return true; // nothing to reclaim

  switch (row.source?.kind) {
    case 'material':
      return Boolean(await File.exists({ 'attachments.storageRef': key }));
    case 'assignment':
      return Boolean(await Assignment.exists({ 'attachments.storageRef': key }));
    case 'submission':
      return Boolean(await Submission.exists({ 'attachments.storageRef': key }));
    case 'notice':
      return Boolean(await Notice.exists({ storageRef: key }));
    case 'question':
      return Boolean(await Question.exists({ imageStorageRef: key }));
    case 'student-id':
      return Boolean(await User.exists({ 'studentIdImage.key': key }));
    default:
      return true;
  }
}

/**
 * Removes objects nothing references any more. Bounded per run so a huge backlog
 * is cleared over several sweeps rather than in one long transaction.
 *
 * @returns {Promise<{removed:number, reclaimedBytes:number}>}
 */
export async function sweepOrphanedObjects({ olderThanMs, limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);

  const candidates = await StoredFile.find({
    storageKey: { $ne: '' },
    updatedAt: { $lt: cutoff },
    $or: [
      // An aborted upload is referenced by definition — nothing ever consumed it.
      { processingStatus: 'CANCELLED' },
      { 'source.kind': { $in: SWEEPABLE_KINDS } },
    ],
  })
    .select('_id storageKey source processingStatus derivatives storedSize')
    .limit(limit);

  let removed = 0;
  let reclaimedBytes = 0;

  for (const row of candidates) {
    try {
      // A cancelled row is unconditionally orphaned; every other kind must prove
      // no live record points at it before anything is deleted.
      // eslint-disable-next-line no-await-in-loop
      if (row.processingStatus !== 'CANCELLED' && (await isReferenced(row))) continue;

      // eslint-disable-next-line no-await-in-loop
      await storage.deleteObject(row.storageKey);
      for (const name of ['thumbnail', 'preview']) {
        const key = row.derivatives?.[name]?.key;
        // eslint-disable-next-line no-await-in-loop
        if (key) await storage.deleteObject(key).catch(() => null);
      }
      // eslint-disable-next-line no-await-in-loop
      await StoredFile.deleteOne({ _id: row._id });

      removed += 1;
      reclaimedBytes += Number(row.storedSize) || 0;
    } catch (err) {
      // One unreclaimable object must not stop the sweep.
      logger.warn(`[uploads] orphan sweep could not reclaim ${row.storageKey}: ${err.message}`, { source: 'cleanup.orphans' });
    }
  }

  return { removed, reclaimedBytes };
}

export default { sweepOrphanedObjects };
