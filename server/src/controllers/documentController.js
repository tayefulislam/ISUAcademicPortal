import mongoose from 'mongoose';
import DocumentCategory from '../models/DocumentCategory.js';
import DocumentJob from '../models/DocumentJob.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { env } from '../config/env.js';
import { enqueueDocumentJob } from '../services/queue/documentQueue.js';
import { getGeneratedDocumentUrl, getGeneratedDocumentStream } from '../services/storage/storageService.js';
import {
  listEligibleTemplates,
  loadUsableTemplate,
  assertCourseAccess,
  buildContext,
  renderPreview,
  createJob,
  serializeJob,
} from '../services/documents/documentService.js';
import { buildRenderData } from '../services/documents/fieldResolver.js';

// A template as a student's list needs it — identity and a thumbnail, never the
// field design (that arrives only when the template is opened for editing).
function templateSummary(template) {
  return {
    _id: template._id,
    name: template.name,
    slug: template.slug,
    category: template.category,
    description: template.description,
    thumbnailUrl: template.thumbnailUrl,
    pageSize: template.pageSize,
    orientation: template.orientation,
    version: template.currentVersion,
    departmentIds: template.departmentIds,
    courseId: template.courseId,
  };
}

// Ownership is enforced in the query itself, so a job belonging to someone else
// is indistinguishable from one that does not exist.
async function findOwnJob(user, jobId) {
  if (!mongoose.isValidObjectId(jobId)) throw new ApiError(400, 'Invalid document id');
  const job = await DocumentJob.findOne({ _id: jobId, user: user._id });
  if (!job) throw new ApiError(404, 'Document not found');
  return job;
}

export const listCategories = asyncHandler(async (req, res) => {
  const categories = await DocumentCategory.find({ isActive: true }).sort({ order: 1, name: 1 });
  res.json({ success: true, data: categories });
});

export const listTemplates = asyncHandler(async (req, res) => {
  const templates = await listEligibleTemplates(req.user, { category: req.query.category || '' });
  res.json({ success: true, data: templates.map(templateSummary) });
});

export const getTemplate = asyncHandler(async (req, res) => {
  const { template, version } = await loadUsableTemplate(req.user, req.params.id);
  res.json({
    success: true,
    data: {
      ...templateSummary(template),
      currentVersion: template.currentVersion,
      design: {
        version: version.version,
        pageSize: version.pageSize,
        orientation: version.orientation,
        styleConfig: version.styleConfig,
        // Each field carries its type, so the client can render the AUTO/STATIC
        // ones as locked and only the rest as inputs.
        fields: version.fields,
      },
    },
  });
});

/**
 * The official values for a template, resolved for the caller — what the client
 * shows in its locked section. Deliberately a separate endpoint from preview:
 * preview validates the student's inputs (and so 422s until they are filled),
 * while this only ever resolves the read-only fields, so the locked panel can be
 * drawn before the form is complete. The values come from the server, never
 * from the client.
 */
export const autofill = asyncHandler(async (req, res) => {
  const { template, version } = await loadUsableTemplate(req.user, req.params.id);
  const course = await assertCourseAccess(req.user, req.query.courseId || null);
  const { context, ids } = await buildContext(req.user, course);

  const lockedFields = version.fields.filter((field) => field.type === 'AUTO' || field.type === 'STATIC');
  const { values } = buildRenderData({ fields: lockedFields, context, inputData: {} });

  res.json({
    success: true,
    data: {
      values,
      ids,
      templateName: template.name,
    },
  });
});

export const preview = asyncHandler(async (req, res) => {
  const { templateId, courseId, inputData } = req.body || {};
  if (!templateId) throw new ApiError(422, 'templateId is required');
  const html = await renderPreview({
    user: req.user,
    templateId,
    courseId: courseId || null,
    inputData,
  });
  res.json({ success: true, data: { html } });
});

export const generate = asyncHandler(async (req, res) => {
  const { templateId, courseId, inputData } = req.body || {};
  if (!templateId) throw new ApiError(422, 'templateId is required');

  const job = await createJob({ user: req.user, templateId, courseId: courseId || null, inputData });

  // The row exists before the queue is touched, so a worker can never pick up an
  // id that was not yet written. If Redis is briefly unavailable the row is
  // removed again rather than left counting against the user's quota.
  try {
    const queued = await enqueueDocumentJob(job._id);
    job.queueJobId = String(queued.id);
    await job.save();
  } catch (error) {
    await DocumentJob.deleteOne({ _id: job._id }).catch(() => {});
    throw new ApiError(503, 'The document queue is unavailable right now. Please try again shortly.');
  }

  res.status(202).json({
    success: true,
    data: { jobId: String(job._id), status: job.status },
  });
});

export const jobStatus = asyncHandler(async (req, res) => {
  const job = await findOwnJob(req.user, req.params.jobId);
  res.json({ success: true, data: serializeJob(job) });
});

export const listDocuments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { user: req.user._id, status: { $ne: 'DELETED' } };
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();

  const [items, total] = await Promise.all([
    DocumentJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    DocumentJob.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(serializeJob),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getDocument = asyncHandler(async (req, res) => {
  const job = await findOwnJob(req.user, req.params.id);
  res.json({ success: true, data: serializeJob(job) });
});

/**
 * Mints the download. The object is private and the URL is generated fresh on
 * each request and returned — never stored — so this is the only place a signed
 * link ever exists, and only after ownership has been checked.
 */
export const downloadDocument = asyncHandler(async (req, res) => {
  const job = await findOwnJob(req.user, req.params.id);

  if (job.status !== 'COMPLETED' || !job.s3Key) {
    throw new ApiError(409, 'This document is not ready to download yet');
  }
  if (job.expiresAt && job.expiresAt.getTime() <= Date.now()) {
    job.status = 'EXPIRED';
    await job.save();
    throw new ApiError(410, 'This document has expired. Please generate it again.');
  }

  const { url, provider } = await getGeneratedDocumentUrl(job.s3Key, {
    ttlSeconds: env.documents.signedUrlTtlSeconds,
    downloadName: job.fileName,
    documentId: String(job._id),
  });

  res.json({
    success: true,
    data: {
      url,
      provider,
      expiresInSeconds: env.documents.signedUrlTtlSeconds,
      fileName: job.fileName,
    },
  });
});

/**
 * Streams the file for the local storage provider, whose files have no
 * signature to presign. Ownership is checked exactly as in downloadDocument.
 */
export const streamDocument = asyncHandler(async (req, res) => {
  const job = await findOwnJob(req.user, req.params.id);
  if (!job.s3Key) throw new ApiError(404, 'This document has no file');
  if (job.expiresAt && job.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, 'This document has expired.');
  }

  const { stream, contentType } = await getGeneratedDocumentStream(job.s3Key, 'application/pdf');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${(job.fileName || 'document.pdf').replace(/["\\]/g, '')}"`);
  stream.pipe(res);
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const job = await findOwnJob(req.user, req.params.id);
  job.status = 'DELETED';
  await job.save();
  // The stored object is left for the bucket's lifecycle rule to expire — the
  // database is not a second, racing authority over its lifetime.
  res.json({ success: true, message: 'Document deleted' });
});
