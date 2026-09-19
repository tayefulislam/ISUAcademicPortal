import ApplicationType from '../models/ApplicationType.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getSettings } from '../models/Settings.js';
import { resolveAiConfig } from '../services/ai/aiConfig.js';
import { listRecipientsFor } from '../services/applications/recipientResolver.js';
import * as applications from '../services/applications/applicationService.js';
import * as exports from '../services/applications/exportService.js';
import * as credits from '../services/applications/creditService.js';

// Write Application — the user-facing side. Every applicant-facing input here is
// content only: identity (name/ID/department/…) and the recipient block are
// resolved server-side from the authenticated user, never taken from the body.

/** Turns an AI failure into a friendly, typed API error. */
function asApiError(error) {
  if (error && error.name === 'AiError') {
    const message = error.code === 'AI_TIMEOUT'
      ? "We couldn't generate the application in time. Please try again."
      : error.code === 'AI_RATE_LIMITED'
        ? 'The AI service is busy right now. Please try again in a moment.'
        : "We couldn't generate the application right now. Please try again.";
    return new ApiError(error.statusCode || 503, message, { code: error.code }, error.code);
  }
  return error;
}

async function assertEnabled() {
  const settings = await getSettings();
  if (settings.applicationWriterEnabled === false) {
    throw new ApiError(400, 'The Write Application feature is currently disabled', null, 'APPLICATIONS_DISABLED');
  }
}

// ----- Reference data -----

export const listTypes = asyncHandler(async (req, res) => {
  await assertEnabled();
  const types = await ApplicationType.find({ active: true }).sort({ order: 1, name: 1 }).lean();
  res.json({
    success: true,
    data: types.map((type) => ({
      key: type.key,
      name: type.name,
      description: type.description,
      fields: type.fields || [],
      defaultInstructions: type.defaultInstructions || '',
      salutation: type.template?.salutation || '',
      closing: type.template?.closing || '',
    })),
  });
});

export const listRecipients = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await listRecipientsFor(req.user) });
});

export const contextPreview = asyncHandler(async (req, res) => {
  await assertEnabled();
  const data = await applications.buildContextPreview(req.user, {
    recipientId: req.query.recipientId || req.body?.recipientId || null,
  });
  res.json({ success: true, data });
});

// ----- Generation -----

export const generate = asyncHandler(async (req, res) => {
  await assertEnabled();
  try {
    const application = await applications.generateApplication(req.user, req.body || {});
    res.status(201).json({ success: true, data: application });
  } catch (error) {
    throw asApiError(error);
  }
});

export const aiEdit = asyncHandler(async (req, res) => {
  await assertEnabled();
  try {
    const application = await applications.editWithAi(req.user, req.body || {});
    res.json({ success: true, data: application });
  } catch (error) {
    throw asApiError(error);
  }
});

export const aiSuggestions = asyncHandler(async (req, res) => {
  await assertEnabled();
  try {
    const result = await applications.suggestFor(req.user, req.body || {});
    res.json({ success: true, data: result });
  } catch (error) {
    throw asApiError(error);
  }
});

// ----- CRUD -----

export const list = asyncHandler(async (req, res) => {
  await assertEnabled();
  const result = await applications.listApplications(req.user, {
    status: req.query.status,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const get = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await applications.getApplication(req.user, req.params.id) });
});

export const create = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.status(201).json({ success: true, data: await applications.createDraft(req.user, req.body || {}) });
});

export const update = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await applications.updateApplication(req.user, req.params.id, req.body || {}) });
});

export const remove = asyncHandler(async (req, res) => {
  await assertEnabled();
  await applications.deleteApplication(req.user, req.params.id);
  res.json({ success: true, message: 'Application deleted' });
});

export const duplicate = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.status(201).json({ success: true, data: await applications.duplicateApplication(req.user, req.params.id) });
});

export const archive = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await applications.archiveApplication(req.user, req.params.id) });
});

export const saveVersion = asyncHandler(async (req, res) => {
  await assertEnabled();
  const data = await applications.saveVersion(req.user, req.params.id, {
    content: req.body?.content,
    source: req.body?.source === 'FINAL' ? 'FINAL' : 'USER',
  });
  res.json({ success: true, data });
});

export const versions = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await applications.listVersions(req.user, req.params.id) });
});

// ----- Exports -----

export const generatePdf = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.status(201).json({ success: true, data: await exports.createExport(req.user, req.params.id, 'PDF') });
});

export const generateDocx = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.status(201).json({ success: true, data: await exports.createExport(req.user, req.params.id, 'DOCX') });
});

export const listExports = asyncHandler(async (req, res) => {
  await assertEnabled();
  res.json({ success: true, data: await exports.listExports(req.user, req.params.id) });
});

export const downloadExport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await exports.getDownloadUrl(req.user, req.params.exportId) });
});

export const streamExport = asyncHandler(async (req, res) => {
  const { stream, contentType } = await exports.getExportContent(req.user, req.params.exportId);
  res.setHeader('Content-Type', contentType);
  stream.pipe(res);
});

// ----- Credits -----

export const getCredits = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await credits.getSummary(req.user._id) });
});

export const getCreditHistory = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await credits.getHistory(req.user._id, req.query.limit) });
});

export const aiStatus = asyncHandler(async (req, res) => {
  const config = await resolveAiConfig();
  // Never the key — only whether the feature can work right now.
  res.json({
    success: true,
    data: {
      enabled: config.enabled && Boolean(config.apiKey),
      provider: config.provider,
      model: config.model,
      generationCost: config.generationCost,
      editCost: config.editCost,
    },
  });
});
