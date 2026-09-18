import mongoose from 'mongoose';
import DocumentTemplate, { TEMPLATE_STATUSES, TEMPLATE_AUDIENCES } from '../models/DocumentTemplate.js';
import DocumentTemplateVersion from '../models/DocumentTemplateVersion.js';
import DocumentCategory from '../models/DocumentCategory.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeTemplateSource, getTemplateSourceStream, deleteTemplateSource } from '../services/storage/storageService.js';
import { normalizeFields } from '../services/documents/normalizeFields.js';
import { FIELD_TYPES, FIELD_SOURCES, SOURCE_LABELS } from '../services/documents/fieldSources.js';
import { listAssets, readAssetBuffer, assetMimeType, isAssetFileName } from '../services/documents/assets.js';
import { getSafeExtension } from '../utils/fileTypes.js';

// A template's reference design may only be a PDF or a raster image — those are
// the two the admin can map fields onto. Anything else is rejected up front.
const SOURCE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const AUDIENCES = new Set(TEMPLATE_AUDIENCES);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'template';
}

async function uniqueSlug(base) {
  let slug = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await DocumentTemplate.exists({ slug })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

/** Accepts a JSON body value or a JSON-encoded multipart field. */
function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(422, 'Expected a JSON value');
  }
}

function parseIdArray(value) {
  const list = parseJson(value, []);
  if (!Array.isArray(list)) throw new ApiError(422, 'Expected an array of ids');
  return list.filter((id) => mongoose.isValidObjectId(id));
}

function parseId(value) {
  if (!value || value === 'null' || value === '') return null;
  if (!mongoose.isValidObjectId(value)) throw new ApiError(422, 'Invalid id');
  return value;
}

function parseStatus(value, fallback) {
  if (!value) return fallback;
  const status = String(value).toUpperCase();
  if (!TEMPLATE_STATUSES.includes(status)) throw new ApiError(422, 'Invalid status');
  return status;
}

function parseAudiences(value) {
  const list = parseJson(value, []);
  if (!Array.isArray(list)) throw new ApiError(422, 'Expected an array');
  const cleaned = list.map((a) => String(a).toLowerCase()).filter((a) => AUDIENCES.has(a));
  return cleaned.length ? cleaned : ['student'];
}

/** The uploaded design, validated, or null when none was attached. */
function readSourceFile(req) {
  if (!req.file) return null;
  if (!SOURCE_MIME.has(req.file.mimetype)) {
    throw new ApiError(400, 'The reference must be a PDF, PNG or JPG');
  }
  return {
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    type: req.file.mimetype === 'application/pdf' ? 'pdf' : 'image',
    ext: getSafeExtension(req.file.originalname) || (req.file.mimetype === 'application/pdf' ? 'pdf' : 'png'),
  };
}

const POPULATE = [
  { path: 'departmentIds', select: 'name code' },
  { path: 'courseId', select: 'name courseId' },
  { path: 'createdBy', select: 'name role' },
];

async function versionCounts(templateIds) {
  const rows = await DocumentTemplateVersion.aggregate([
    { $match: { template: { $in: templateIds } } },
    { $group: { _id: '$template', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

/**
 * The field vocabulary the editor builds its dropdowns from. Served rather than
 * duplicated in the client so the two can never drift — adding a source on the
 * server makes it selectable in the editor with no frontend change.
 */
export const getMetadata = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      fieldTypes: FIELD_TYPES,
      sources: FIELD_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] || value })),
      pageSizes: ['A4', 'LETTER'],
      orientations: ['portrait', 'landscape'],
      alignments: ['left', 'center', 'right'],
      dateFormats: ['', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD MMM YYYY', 'MMMM D, YYYY', 'YYYY-MM-DD'],
    },
  });
});

/**
 * The images a template may place — the university logo and anything else in the
 * server's `img/` folder. Listed by name (not uploaded through a template), so
 * the same logo can be used by many designs and a change to it is a file
 * replacement rather than an edit to each one.
 */
export const getAssets = asyncHandler(async (req, res) => {
  const assets = await listAssets();
  res.json({
    success: true,
    data: assets.map((asset) => ({
      ...asset,
      url: `/api/admin/document-assets/${encodeURIComponent(asset.name)}`,
    })),
  });
});

/** Streams one image for the editor (the canvas background and the picker). */
export const streamAsset = asyncHandler(async (req, res) => {
  const name = String(req.params.name || '');
  if (!isAssetFileName(name)) throw new ApiError(400, 'Invalid image name');

  const buffer = await readAssetBuffer(name);
  res.setHeader('Content-Type', assetMimeType(name));
  // Private: these are fetched with the caller's token, and a logo rarely changes.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buffer);
});

export const listTemplates = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = String(req.query.category).toLowerCase();
  if (req.query.status) filter.status = parseStatus(req.query.status, 'ACTIVE');
  if (req.query.department && mongoose.isValidObjectId(req.query.department)) {
    filter.departmentIds = req.query.department;
  }

  const templates = await DocumentTemplate.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  const counts = await versionCounts(templates.map((t) => t._id));

  res.json({
    success: true,
    data: templates.map((template) => ({
      ...template.toObject(),
      versionCount: counts.get(String(template._id)) || 0,
    })),
  });
});

export const getTemplate = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const template = await DocumentTemplate.findById(req.params.id).populate(POPULATE);
  if (!template) throw new ApiError(404, 'Template not found');

  const versions = await DocumentTemplateVersion.find({ template: template._id })
    .select('version pageSize orientation sourceFile createdBy createdAt')
    .populate({ path: 'createdBy', select: 'name role' })
    .sort({ version: -1 });

  res.json({ success: true, data: { ...template.toObject(), versions } });
});

export const createTemplate = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(422, 'Template name is required');

  const category = String(body.category || '').trim().toLowerCase();
  if (!category) throw new ApiError(422, 'A category is required');
  const categoryExists = await DocumentCategory.exists({ key: category });
  if (!categoryExists) throw new ApiError(422, 'Unknown category');

  const source = readSourceFile(req);
  const fields = normalizeFields(body.fields);

  const template = await DocumentTemplate.create({
    name,
    slug: await uniqueSlug(slugify(name)),
    category,
    description: String(body.description || '').slice(0, 2000),
    thumbnailUrl: String(body.thumbnailUrl || ''),
    departmentIds: parseIdArray(body.departmentIds),
    courseId: parseId(body.courseId),
    availableFor: parseAudiences(body.availableFor),
    pageSize: String(body.pageSize || 'A4'),
    orientation: body.orientation === 'landscape' ? 'landscape' : 'portrait',
    status: parseStatus(body.status, 'DRAFT'),
    currentVersion: 1,
    createdBy: req.user._id,
  });

  let sourceFile = {};
  if (source) {
    const key = `template-sources/${template._id}/v1.${source.ext}`;
    const { storageRef } = await storeTemplateSource(key, source.buffer, source.mimeType);
    sourceFile = { type: source.type, s3Key: storageRef, fileName: source.fileName, mimeType: source.mimeType, size: source.buffer.length };
  }

  await DocumentTemplateVersion.create({
    template: template._id,
    version: 1,
    pageSize: template.pageSize,
    orientation: template.orientation,
    fields,
    sourceFile,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: template });
});

/** Identity metadata only — the design is versioned, this is not. */
export const updateTemplate = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const template = await DocumentTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Template not found');

  const body = req.body || {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new ApiError(422, 'Template name cannot be empty');
    template.name = name;
  }
  if (body.category !== undefined) {
    const category = String(body.category).trim().toLowerCase();
    if (!(await DocumentCategory.exists({ key: category }))) throw new ApiError(422, 'Unknown category');
    template.category = category;
  }
  if (body.description !== undefined) template.description = String(body.description).slice(0, 2000);
  if (body.thumbnailUrl !== undefined) template.thumbnailUrl = String(body.thumbnailUrl);
  if (body.departmentIds !== undefined) template.departmentIds = parseIdArray(body.departmentIds);
  if (body.courseId !== undefined) template.courseId = parseId(body.courseId);
  if (body.availableFor !== undefined) template.availableFor = parseAudiences(body.availableFor);
  if (body.pageSize !== undefined) template.pageSize = String(body.pageSize || 'A4');
  if (body.orientation !== undefined) template.orientation = body.orientation === 'landscape' ? 'landscape' : 'portrait';
  if (body.status !== undefined) template.status = parseStatus(body.status, template.status);

  await template.save();
  res.json({ success: true, data: template });
});

/**
 * Appends a new version. The existing one is never touched, so a document
 * already generated against it keeps rendering the design it was made with.
 */
export const createVersion = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const template = await DocumentTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Template not found');

  const body = req.body || {};
  const current = await DocumentTemplateVersion.findOne({
    template: template._id,
    version: template.currentVersion,
  });
  if (!current) throw new ApiError(404, 'The template has no current version to derive from');

  const nextVersion = template.currentVersion + 1;
  // Default to the current design (a new version is usually a tweak); the editor
  // may supply a full replacement instead.
  const fields = body.fields !== undefined && body.fields !== ''
    ? normalizeFields(body.fields)
    : current.fields.map((field) => field.toObject());

  const source = readSourceFile(req);
  let sourceFile = current.sourceFile ? current.sourceFile.toObject() : {};
  if (source) {
    const key = `template-sources/${template._id}/v${nextVersion}.${source.ext}`;
    const { storageRef } = await storeTemplateSource(key, source.buffer, source.mimeType);
    sourceFile = { type: source.type, s3Key: storageRef, fileName: source.fileName, mimeType: source.mimeType, size: source.buffer.length };
  }

  const pageSize = String(body.pageSize || current.pageSize || 'A4');
  const orientation = (body.orientation || current.orientation) === 'landscape' ? 'landscape' : 'portrait';

  const version = await DocumentTemplateVersion.create({
    template: template._id,
    version: nextVersion,
    pageSize,
    orientation,
    fields,
    sourceFile,
    styleConfig: current.styleConfig ? current.styleConfig.toObject() : {},
    createdBy: req.user._id,
  });

  template.currentVersion = nextVersion;
  template.pageSize = pageSize;
  template.orientation = orientation;
  await template.save();

  res.status(201).json({ success: true, data: version });
});

export const getVersion = asyncHandler(async (req, res) => {
  const version = await findVersion(req);
  res.json({ success: true, data: version });
});

export const setStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const template = await DocumentTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Template not found');

  template.status = parseStatus(req.body && req.body.status, template.status);
  await template.save();
  res.json({ success: true, data: template });
});

export const duplicateTemplate = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const source = await DocumentTemplate.findById(req.params.id);
  if (!source) throw new ApiError(404, 'Template not found');
  const current = await DocumentTemplateVersion.findOne({ template: source._id, version: source.currentVersion });

  const name = String((req.body && req.body.name) || `${source.name} (copy)`).trim();
  const copy = await DocumentTemplate.create({
    name,
    slug: await uniqueSlug(slugify(name)),
    category: source.category,
    description: source.description,
    thumbnailUrl: source.thumbnailUrl,
    departmentIds: source.departmentIds,
    courseId: source.courseId,
    availableFor: source.availableFor,
    pageSize: source.pageSize,
    orientation: source.orientation,
    // A duplicate starts as a draft so it is never visible until deliberately published.
    status: 'DRAFT',
    currentVersion: 1,
    createdBy: req.user._id,
  });

  await DocumentTemplateVersion.create({
    template: copy._id,
    version: 1,
    pageSize: copy.pageSize,
    orientation: copy.orientation,
    fields: current ? current.fields.map((field) => field.toObject()) : [],
    // The source file is shared by key rather than re-uploaded — it is the same
    // reference design, and deleting one template must not remove the other's.
    sourceFile: current && current.sourceFile ? current.sourceFile.toObject() : {},
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: copy });
});

export const deleteTemplate = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const template = await DocumentTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Template not found');

  // Documents already generated keep their own snapshot (name, version,
  // resolved values), so removing a template never orphans their history.
  await DocumentTemplateVersion.deleteMany({ template: template._id });
  await template.deleteOne();
  res.json({ success: true, message: 'Template deleted' });
});

/**
 * Attaches or replaces the reference design on the template's CURRENT version.
 *
 * <p>The reference is a visual aid for positioning fields, not part of the
 * rendered output (the fields are), so replacing it on the working version is
 * safe. Older versions keep their own file, so a document that was generated
 * against version 1 can still show what version 1 was laid out from.
 */
export const uploadSource = asyncHandler(async (req, res) => {
  const version = await findVersion(req);
  const source = readSourceFile(req);
  if (!source) throw new ApiError(400, 'Attach a PDF, PNG or JPG');

  const template = await DocumentTemplate.findById(version.template);
  if (!template) throw new ApiError(404, 'Template not found');
  if (version.version !== template.currentVersion) {
    throw new ApiError(409, 'Create a new version before changing an older version\u2019s design');
  }

  const key = `template-sources/${template._id}/v${version.version}.${source.ext}`;
  const { storageRef } = await storeTemplateSource(key, source.buffer, source.mimeType);
  version.sourceFile = {
    type: source.type,
    s3Key: storageRef,
    fileName: source.fileName,
    mimeType: source.mimeType,
    size: source.buffer.length,
  };
  await version.save();

  res.json({ success: true, data: version.sourceFile });
});

/** Streams the reference design for the editor background — never a public URL. */
export const streamSource = asyncHandler(async (req, res) => {
  const version = await findVersion(req);
  if (!version.sourceFile || !version.sourceFile.s3Key) {
    throw new ApiError(404, 'This version has no reference design');
  }
  const { stream, contentType } = await getTemplateSourceStream(
    version.sourceFile.s3Key,
    version.sourceFile.mimeType
  );
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline');
  stream.pipe(res);
});

export const createCategory = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(422, 'Category name is required');

  const key = String(body.key || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) throw new ApiError(422, 'Category key is required');
  if (await DocumentCategory.exists({ key })) throw new ApiError(409, 'That category already exists');

  const category = await DocumentCategory.create({
    key,
    name,
    icon: String(body.icon || ''),
    description: String(body.description || '').slice(0, 500),
    order: Number(body.order) || 0,
    isActive: body.isActive !== false,
    createdBy: req.user._id,
  });
  res.status(201).json({ success: true, data: category });
});

async function findVersion(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid template id');
  const versionNumber = Number(req.params.version);
  if (!Number.isFinite(versionNumber) || versionNumber < 1) throw new ApiError(400, 'Invalid version');

  const template = await DocumentTemplate.findById(req.params.id).select('_id currentVersion');
  if (!template) throw new ApiError(404, 'Template not found');

  const version = await DocumentTemplateVersion.findOne({ template: template._id, version: versionNumber });
  if (!version) throw new ApiError(404, 'Version not found');
  return version;
}

export default {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  createVersion,
  getVersion,
  setStatus,
  duplicateTemplate,
  deleteTemplate,
  uploadSource,
  streamSource,
  createCategory,
  // exported for reuse/tests
  normalizeFields,
  deleteTemplateSource,
};
