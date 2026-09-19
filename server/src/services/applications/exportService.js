import ApplicationExport from '../../models/ApplicationExport.js';
import ApplicationType from '../../models/ApplicationType.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import { resolveAiConfig } from '../ai/aiConfig.js';
import { renderPdf } from '../pdf/pdfService.js';
import {
  storeGeneratedDocument,
  deletePrivateObjectStrict,
  getGeneratedDocumentStream,
  getApplicationExportUrl,
} from '../storage/storageService.js';
import { buildApplicationHtml } from './applicationHtml.js';
import { buildApplicationDocx } from './docxService.js';
import { ownedApplication, markExported } from './applicationService.js';

// Turns a saved application into a downloadable PDF/DOCX. The file is a
// temporary artefact (24h by default) while the application itself is kept —
// see ApplicationExport for why the two lifetimes are separate.

const MIME = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const EXT = { PDF: 'pdf', DOCX: 'docx' };

function safeFileName(application, fileType) {
  const base = String(application.subject || application.applicationTypeName || 'Application')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'Application'}.${EXT[fileType]}`;
}

function shapeExport(row) {
  if (!row) return null;
  const doc = row.toObject ? row.toObject() : row;
  const expired = doc.status !== 'ACTIVE' || (doc.expiresAt && doc.expiresAt.getTime() <= Date.now());
  return {
    id: String(doc._id),
    applicationId: String(doc.application),
    fileType: doc.fileType,
    fileName: doc.fileName,
    sizeBytes: doc.sizeBytes,
    status: expired ? 'EXPIRED' : doc.status,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    expired,
  };
}

/**
 * Generates and stores one export. No AI credit is involved — an export is not
 * a generation, and can be produced again as often as the user likes.
 */
export async function createExport(user, applicationId, fileTypeInput) {
  const fileType = String(fileTypeInput || '').toUpperCase();
  if (!EXT[fileType]) {
    throw new ApiError(422, 'An export must be a PDF or a DOCX', null, 'EXPORT_TYPE_INVALID');
  }

  const application = await ownedApplication(user, applicationId);
  if (!application.editedContent || !application.editedContent.trim()) {
    throw new ApiError(422, 'There is nothing to export yet — generate or write the application first');
  }

  const appType = await ApplicationType.findOne({ key: application.applicationType }).lean();
  const typeTemplate = appType?.template || {};
  const plain = application.toObject();

  // A row first, so the storage key can carry its id.
  const exportRow = await ApplicationExport.create({
    application: application._id,
    user: user._id,
    fileType,
    status: 'ACTIVE',
  });

  let buffer;
  try {
    if (fileType === 'PDF') {
      const html = buildApplicationHtml({
        application: plain,
        typeTemplate,
        universityName: env.universityName,
      });
      buffer = await renderPdf(html);
    } else {
      buffer = await buildApplicationDocx({
        application: plain,
        typeTemplate,
        universityName: env.universityName,
      });
    }
  } catch (error) {
    await ApplicationExport.deleteOne({ _id: exportRow._id }).catch(() => {});
    console.error('[applications] export render failed:', error.message);
    throw new ApiError(
      503,
      `We couldn't prepare the ${fileType === 'PDF' ? 'PDF' : 'Word document'} right now. Please try again.`,
      null,
      'EXPORT_FAILED'
    );
  }

  const config = await resolveAiConfig();
  const key = `application-exports/${application._id}/${exportRow._id}.${EXT[fileType]}`;

  let storageRef = '';
  try {
    ({ storageRef } = await storeGeneratedDocument(key, buffer, MIME[fileType]));
    exportRow.storageRef = storageRef;
    exportRow.provider = env.fileStorageProvider;
    exportRow.fileName = safeFileName(application, fileType);
    exportRow.sizeBytes = buffer.length;
    exportRow.expiresAt = new Date(Date.now() + config.exportExpirationHours * 60 * 60 * 1000);
    await exportRow.save();
  } catch (error) {
    // The object may already be in the bucket — the row write is what failed.
    // It has to be removed here, because deleting the row would leave an object
    // with no record for the sweep to find it by.
    if (storageRef) {
      await deletePrivateObjectStrict(storageRef).catch(() => {});
    }
    await ApplicationExport.deleteOne({ _id: exportRow._id }).catch(() => {});
    console.error('[applications] export upload failed:', error.message);
    throw new ApiError(503, 'The file was created but could not be stored. Please try again.', null, 'STORAGE_FAILED');
  }

  await markExported(application);
  return shapeExport(exportRow);
}

export async function listExports(user, applicationId) {
  const application = await ownedApplication(user, applicationId);
  const rows = await ApplicationExport.find({ application: application._id, user: user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  return rows.map(shapeExport);
}

/** Ownership + not-expired, or a 410 the client turns into "generate it again". */
export async function resolveExportForDownload(user, exportId) {
  const exportRow = await ApplicationExport.findOne({ _id: exportId, user: user._id });
  if (!exportRow) throw new ApiError(404, 'Export not found');

  if (exportRow.status !== 'ACTIVE' || !exportRow.storageRef) {
    throw new ApiError(410, 'This exported file has expired. Please generate the PDF/DOCX again.', null, 'EXPORT_EXPIRED');
  }
  if (exportRow.expiresAt && exportRow.expiresAt.getTime() <= Date.now()) {
    // Mark it unavailable immediately, but deliberately leave storageDeletedAt
    // alone: the sweep keys off that field, so the object is still removed on
    // its next pass. Touching only the status here is what used to orphan the
    // file — the row looked "done" while the bytes stayed in the bucket.
    await ApplicationExport.updateOne({ _id: exportRow._id }, { $set: { status: 'EXPIRED', deletedAt: new Date() } });
    throw new ApiError(410, 'This exported file has expired. Please generate the PDF/DOCX again.', null, 'EXPORT_EXPIRED');
  }
  return exportRow;
}

export async function getDownloadUrl(user, exportId) {
  const exportRow = await resolveExportForDownload(user, exportId);
  const { url, provider } = await getApplicationExportUrl(exportRow.storageRef, {
    ttlSeconds: env.documents.signedUrlTtlSeconds,
    downloadName: exportRow.fileName,
    exportId: String(exportRow._id),
  });
  return { url, provider, fileName: exportRow.fileName, expiresAt: exportRow.expiresAt };
}

export async function getExportContent(user, exportId) {
  const exportRow = await resolveExportForDownload(user, exportId);
  return getGeneratedDocumentStream(exportRow.storageRef, MIME[exportRow.fileType]);
}

/**
 * The export sweep: every export past its expiry that still claims an object
 * loses it, and the row records that (storageDeletedAt). Status is irrelevant
 * on purpose — a row flipped to EXPIRED by a late download request still has
 * its object removed here. A delete that fails is left for the next run; a
 * missing object still marks the row done (deleting an absent key is
 * idempotent).
 */
export async function cleanupExpiredExports() {
  const now = new Date();
  // Deliberately NOT filtered on status. Requesting a link after expiry marks a
  // row EXPIRED without touching storage (see resolveExportForDownload), and
  // those objects must still be removed. What marks the work as done is
  // storageDeletedAt — stamped only once the delete actually succeeded — so a
  // row is never skipped just because it already became unavailable.
  const due = await ApplicationExport.find({
    expiresAt: { $ne: null, $lte: now },
    storageRef: { $ne: '' },
    storageDeletedAt: null,
  })
    .select('_id storageRef')
    .lean();

  let cleaned = 0;
  let deferred = 0;
  for (const row of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deletePrivateObjectStrict(row.storageRef);
    } catch (error) {
      // Left for the next run rather than marked done: a record must never
      // claim its file is gone while the object is still there.
      deferred += 1;
      console.error(`[applications] could not delete export ${row._id}; will retry:`, error.message);
      continue;
    }
    // Guarded on storageDeletedAt: null so two overlapping sweeps cannot both
    // count the same row, and deletedAt keeps the FIRST time it became
    // unavailable (the expiry request) rather than being moved to the sweep's.
    // eslint-disable-next-line no-await-in-loop
    const result = await ApplicationExport.updateOne(
      { _id: row._id, storageDeletedAt: null },
      [
        {
          $set: {
            status: 'EXPIRED',
            storageDeletedAt: '$$NOW',
            deletedAt: { $ifNull: ['$deletedAt', '$$NOW'] },
          },
        },
      ]
    );
    if (result.modifiedCount) cleaned += 1;
  }
  return { cleaned, deferred };
}

export default { createExport, listExports, getDownloadUrl, getExportContent, cleanupExpiredExports };
