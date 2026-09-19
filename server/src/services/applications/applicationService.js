import Application from '../../models/Application.js';
import ApplicationType from '../../models/ApplicationType.js';
import ApplicationVersion from '../../models/ApplicationVersion.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateText } from '../ai/aiService.js';
import { resolveAiConfig } from '../ai/aiConfig.js';
import { buildProfileSnapshot, profileRows } from './profileSnapshot.js';
import { resolveRecipient, recipientRows } from './recipientResolver.js';
import { buildGenerationPrompt, buildSuggestionsPrompt } from './applicationPrompt.js';
import { buildEditPrompt } from './aiEditPrompts.js';
import * as credits from './creditService.js';

// Everything the Write Application feature does with an application: validate,
// generate (through a reserved credit), edit with AI, version, and keep the
// applicant's verified identity server-side throughout.

function clean(value, max) {
  return String(value ?? '').slice(0, max).trim();
}

async function loadActiveType(key) {
  const type = await ApplicationType.findOne({ key: String(key || ''), active: true }).lean();
  if (!type) throw new ApiError(422, 'That application type is not available', null, 'TYPE_INVALID');
  return type;
}

/** Keeps only the type's declared questions, as trimmed strings. */
function cleanStructured(type, raw) {
  const data = {};
  if (!raw || typeof raw !== 'object') return data;
  for (const field of type.fields || []) {
    const value = raw[field.key];
    if (value === undefined || value === null) continue;
    data[field.key] = clean(value, 500);
  }
  return data;
}

function structuredRows(type, data) {
  return (type.fields || [])
    .map((field) => ({ label: field.label, value: data[field.key] }))
    .filter((row) => row.value !== undefined && row.value !== null && String(row.value).trim() !== '')
    .map((row) => ({ label: row.label, value: String(row.value) }));
}

function shape(application) {
  if (!application) return null;
  const doc = application.toObject ? application.toObject() : application;
  return {
    id: String(doc._id),
    applicationType: doc.applicationType,
    applicationTypeName: doc.applicationTypeName,
    recipient: doc.recipient,
    subject: doc.subject,
    details: doc.details,
    additionalInfo: doc.additionalInfo,
    structuredData: doc.structuredData || {},
    status: doc.status,
    currentVersion: doc.currentVersion,
    aiContent: doc.aiContent,
    editedContent: doc.editedContent,
    suggestions: doc.suggestions || [],
    profileSnapshot: doc.profileSnapshot || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** The transparency preview: the recipient + applicant blocks, nothing else. */
export async function buildContextPreview(user, { recipientId }) {
  const [profile, recipient] = await Promise.all([
    buildProfileSnapshot(user),
    resolveRecipient(user, recipientId),
  ]);
  return {
    recipient,
    recipientRows: recipientRows(recipient),
    applicantRows: profileRows(profile),
    profile,
  };
}

/**
 * Generates an application body with AI.
 *
 * <p>The order matters: reserve a credit → call the AI → save → finalize. A
 * failure at any point before the save releases the reservation, so the user is
 * never charged for something they did not receive.
 */
export async function generateApplication(user, input) {
  const config = await resolveAiConfig();
  const type = await loadActiveType(input.applicationType);

  const subject = clean(input.subject, config.maxSubjectChars);
  const details = clean(input.details, config.maxDetailsChars);
  const additionalInfo = clean(input.additionalInfo, config.maxAdditionalChars);
  if (!subject) throw new ApiError(422, 'Please enter a subject');
  if (!details) throw new ApiError(422, 'Please describe your application');

  const data = cleanStructured(type, input.structuredData);
  for (const field of type.fields || []) {
    if (field.required && !data[field.key]) {
      throw new ApiError(422, `${field.label} is required`);
    }
  }

  const [recipient, profile] = await Promise.all([
    resolveRecipient(user, input.recipientId),
    buildProfileSnapshot(user),
  ]);

  const prompt = buildGenerationPrompt({
    applicationTypeName: type.name,
    recipientRows: recipientRows(recipient),
    profileRows: profileRows(profile),
    structuredRows: structuredRows(type, data),
    subject,
    details,
    additionalInfo,
    typeInstructions: type.defaultInstructions,
  });

  const { reservationId } = await credits.reserve(user._id, config.generationCost, {
    kind: 'AI_GENERATION',
    description: `${type.name} — ${subject}`,
  });

  let content;
  try {
    content = (await generateText(prompt)).content;
  } catch (error) {
    await credits.release(reservationId);
    throw error;
  }

  let application;
  try {
    application = await Application.create({
      user: user._id,
      applicationType: type.key,
      applicationTypeName: type.name,
      recipient,
      subject,
      details,
      additionalInfo,
      structuredData: data,
      status: 'GENERATED',
      currentVersion: 1,
      aiContent: content,
      editedContent: content,
      profileSnapshot: profile,
    });
    await ApplicationVersion.create({
      application: application._id,
      version: 1,
      source: 'AI',
      content,
      createdBy: user._id,
    });
  } catch (error) {
    // The AI succeeded but the result could not be stored — do not keep the
    // charge for a document the user never got.
    await credits.release(reservationId);
    throw error;
  }

  await credits.finalize(reservationId, application._id);
  return shape(application);
}

/** One of the quick AI edits, applied to the current editor content. */
export async function editWithAi(user, { applicationId, action, content }) {
  const config = await resolveAiConfig();
  const application = await ownedApplication(user, applicationId);
  const current = clean(content, 20000) || application.editedContent;
  if (!current) throw new ApiError(422, 'There is nothing to edit yet');

  const prompt = buildEditPrompt({ action, content: current });
  if (!prompt) throw new ApiError(422, 'Unknown AI action', null, 'ACTION_INVALID');

  const { reservationId } = await credits.reserve(user._id, config.editCost, {
    kind: 'AI_EDIT',
    description: `${action} — ${application.subject || application.applicationTypeName}`,
  });

  let revised;
  try {
    revised = (await generateText(prompt)).content;
  } catch (error) {
    await credits.release(reservationId);
    throw error;
  }

  const version = (application.currentVersion || 0) + 1;
  application.editedContent = revised;
  application.status = 'EDITED';
  application.currentVersion = version;
  await application.save();
  await ApplicationVersion.create({
    application: application._id,
    version,
    source: 'USER',
    content: revised,
    createdBy: user._id,
  });
  await credits.finalize(reservationId, application._id);

  return shape(application);
}

/** Advisory suggestions for the drafted text. */
export async function suggestFor(user, { applicationId, content }) {
  const application = await ownedApplication(user, applicationId);
  const body = clean(content, 20000) || application.editedContent;
  if (!body) throw new ApiError(422, 'There is nothing to review yet');

  const prompt = buildSuggestionsPrompt({ content: body });
  const { content: text } = await generateText(prompt);
  const suggestions = text
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 4);

  application.suggestions = suggestions;
  await application.save();
  return { suggestions };
}

// ----- CRUD -----

export async function ownedApplication(user, id) {
  const application = await Application.findOne({ _id: id, user: user._id });
  if (!application) throw new ApiError(404, 'Application not found');
  return application;
}

export async function listApplications(user, { status, limit = 50, page = 1 } = {}) {
  const filter = { user: user._id };
  if (status) filter.status = status;
  const perPage = Math.min(Math.max(1, Number(limit) || 50), 100);
  const skip = (Math.max(1, Number(page) || 1) - 1) * perPage;
  const [items, total] = await Promise.all([
    Application.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(perPage),
    Application.countDocuments(filter),
  ]);
  return {
    items: items.map(shape),
    pagination: { page: Number(page) || 1, limit: perPage, total, pages: Math.ceil(total / perPage) },
  };
}

export async function getApplication(user, id) {
  return shape(await ownedApplication(user, id));
}

export async function createDraft(user, input) {
  const config = await resolveAiConfig();
  const type = await loadActiveType(input.applicationType);
  const recipient = await resolveRecipient(user, input.recipientId).catch(() => null);
  const application = await Application.create({
    user: user._id,
    applicationType: type.key,
    applicationTypeName: type.name,
    recipient: recipient || {},
    subject: clean(input.subject, config.maxSubjectChars),
    details: clean(input.details, config.maxDetailsChars),
    additionalInfo: clean(input.additionalInfo, config.maxAdditionalChars),
    structuredData: cleanStructured(type, input.structuredData),
    status: 'DRAFT',
  });
  return shape(application);
}

export async function updateApplication(user, id, patch) {
  const application = await ownedApplication(user, id);
  const config = await resolveAiConfig();

  if (patch.subject !== undefined) application.subject = clean(patch.subject, config.maxSubjectChars);
  if (patch.details !== undefined) application.details = clean(patch.details, config.maxDetailsChars);
  if (patch.additionalInfo !== undefined) application.additionalInfo = clean(patch.additionalInfo, config.maxAdditionalChars);
  if (patch.editedContent !== undefined) {
    application.editedContent = clean(patch.editedContent, 20000);
    if (application.status === 'DRAFT' || application.status === 'GENERATED') application.status = 'EDITED';
  }
  if (patch.suggestions !== undefined && Array.isArray(patch.suggestions)) {
    application.suggestions = patch.suggestions.slice(0, 10).map((s) => clean(s, 300));
  }
  if (patch.structuredData !== undefined) {
    const type = await ApplicationType.findOne({ key: application.applicationType }).lean();
    if (type) application.structuredData = cleanStructured(type, patch.structuredData);
  }
  if (patch.recipientId) application.recipient = await resolveRecipient(user, patch.recipientId);

  await application.save();
  return shape(application);
}

/** Saves the current editor text as a new version. */
export async function saveVersion(user, id, { content, source = 'USER' }) {
  const application = await ownedApplication(user, id);
  const version = (application.currentVersion || 0) + 1;
  application.currentVersion = version;
  application.editedContent = clean(content, 20000);
  if (application.status === 'GENERATED' || application.status === 'DRAFT') application.status = 'EDITED';
  await application.save();
  await ApplicationVersion.create({
    application: application._id,
    version,
    source,
    content: application.editedContent,
    createdBy: user._id,
  });
  return shape(application);
}

export async function listVersions(user, id) {
  const application = await ownedApplication(user, id);
  const versions = await ApplicationVersion.find({ application: application._id })
    .sort({ version: 1 })
    .lean();
  return versions.map((v) => ({
    version: v.version,
    source: v.source,
    content: v.content,
    createdAt: v.createdAt,
  }));
}

export async function deleteApplication(user, id) {
  const application = await ownedApplication(user, id);
  if (!['DRAFT', 'GENERATED', 'EDITED'].includes(application.status)) {
    throw new ApiError(409, 'Only a draft or unexported application can be deleted — archive it instead');
  }
  await ApplicationVersion.deleteMany({ application: application._id });
  await application.deleteOne();
  return { deleted: true };
}

export async function duplicateApplication(user, id) {
  const source = await ownedApplication(user, id);
  const copy = await Application.create({
    user: user._id,
    applicationType: source.applicationType,
    applicationTypeName: source.applicationTypeName,
    recipient: source.recipient,
    subject: source.subject,
    details: source.details,
    additionalInfo: source.additionalInfo,
    structuredData: source.structuredData,
    status: 'DRAFT',
    currentVersion: 0,
    aiContent: '',
    editedContent: '',
    profileSnapshot: source.profileSnapshot,
  });
  return shape(copy);
}

export async function archiveApplication(user, id) {
  const application = await ownedApplication(user, id);
  application.status = 'ARCHIVED';
  await application.save();
  return shape(application);
}

/** Marks an application exported (called by the export service). */
export async function markExported(application) {
  if (application.status !== 'ARCHIVED') {
    application.status = 'EXPORTED';
    await application.save();
  }
}

export default {
  buildContextPreview,
  generateApplication,
  editWithAi,
  suggestFor,
  listApplications,
  getApplication,
  createDraft,
  updateApplication,
  saveVersion,
  listVersions,
  deleteApplication,
  duplicateApplication,
  archiveApplication,
  ownedApplication,
  markExported,
};
