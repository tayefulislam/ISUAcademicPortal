import mongoose from 'mongoose';
import DocumentJob, { DOCUMENT_ACTIVE_STATUSES } from '../../models/DocumentJob.js';
import DocumentTemplate from '../../models/DocumentTemplate.js';
import DocumentTemplateVersion from '../../models/DocumentTemplateVersion.js';
import User from '../../models/User.js';
import Course from '../../models/Course.js';
import Department from '../../models/Department.js';
import Batch from '../../models/Batch.js';
import Semester from '../../models/Semester.js';
import { isAdminTierRole } from '../../models/Role.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { getEffectiveCourseIds } from '../courseAccessService.js';
import { resolveFacultyForCourse } from '../notifications/recipientResolver.js';
import { emit } from '../notifications/notificationService.js';
import { buildRenderData } from './fieldResolver.js';
import { renderHtml } from './templateEngine.js';
import { assetDataUris } from './assets.js';
import { effectiveAudience, isTemplateEligible, filterEligibleTemplates } from './eligibility.js';

// Nothing here trusts an id from the request body: the student, the course and
// the faculty an AUTO field resolves from are all loaded from the authenticated
// user's own records, and the course is checked against the caller's reachable
// set before anything is rendered.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A short, non-revealing reason for the job row (never a stack trace). */
export function safeErrorMessage(error) {
  const raw = error && error.message ? String(error.message) : 'Document generation failed';
  // Strip anything stack-like and cap the length — this string can be shown to
  // the student and is stored on the job.
  return raw.split('\n')[0].slice(0, 300);
}

async function audienceFor(user) {
  const adminTier = await isAdminTierRole(user.role);
  return effectiveAudience(user, { isAdminTierRole: adminTier });
}

/** The eligibility context for one user: the departments and courses they may use. */
async function eligibilityContext(user, audience) {
  if (audience === 'staff') {
    return { audience, departmentIds: new Set(), courseIds: new Set() };
  }
  if (audience === 'faculty') {
    return {
      audience,
      departmentIds: new Set((user.assignedDepartments || []).map(String)),
      courseIds: new Set((user.assignedCourses || []).map(String)),
    };
  }
  const courseIds = await getEffectiveCourseIds(user);
  return {
    audience,
    departmentIds: new Set(user.department ? [String(user.department)] : []),
    courseIds: new Set(courseIds.map(String)),
  };
}

/** The ACTIVE templates this user may see, optionally narrowed to one category. */
export async function listEligibleTemplates(user, { category = '' } = {}) {
  const query = { status: 'ACTIVE' };
  if (category) query.category = String(category).toLowerCase();

  const templates = await DocumentTemplate.find(query).sort({ name: 1 });
  const audience = await audienceFor(user);
  const ctx = await eligibilityContext(user, audience);
  return filterEligibleTemplates(templates, ctx);
}

/** Loads a template and its published version, refusing one the user may not use. */
export async function loadUsableTemplate(user, templateId) {
  if (!mongoose.isValidObjectId(templateId)) {
    throw new ApiError(400, 'Invalid template id');
  }
  const template = await DocumentTemplate.findById(templateId);
  if (!template) throw new ApiError(404, 'Template not found');

  const audience = await audienceFor(user);
  const ctx = await eligibilityContext(user, audience);
  if (!isTemplateEligible(template, ctx)) {
    throw new ApiError(403, 'You cannot use this template', null, 'FORBIDDEN');
  }

  const version = await DocumentTemplateVersion.findOne({
    template: template._id,
    version: template.currentVersion,
  });
  if (!version) throw new ApiError(404, 'This template has no published version');
  return { template, version };
}

/** Confirms the caller may generate for this course, and returns it (or null). */
export async function assertCourseAccess(user, courseId) {
  if (!courseId) return null;
  if (!mongoose.isValidObjectId(courseId)) throw new ApiError(400, 'Invalid course id');

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, 'Course not found');

  const audience = await audienceFor(user);
  if (audience === 'staff') return course;

  const allowed = audience === 'faculty'
    ? new Set((user.assignedCourses || []).map(String))
    : new Set((await getEffectiveCourseIds(user)).map(String));

  if (!allowed.has(String(course._id))) {
    throw new ApiError(403, 'You do not have access to this course', null, 'FORBIDDEN');
  }
  return course;
}

/**
 * The faculty a course's cover may name — everyone the app already considers
 * faculty for that course (department/course assignment), which is what the
 * student picks from.
 *
 * <p>A course routinely has more than one (a theory teacher and a lab teacher,
 * or several sections), so this is a LIST, not a single answer. Picking the
 * first was arbitrary — the teacher is the student's choice.
 */
export async function facultyOptionsForCourse(course) {
  if (!course) return [];
  const ids = await resolveFacultyForCourse(course);
  if (!ids || !ids.length) return [];
  const users = await User.find({ _id: { $in: ids } }).select('name email designation').sort({ name: 1 });
  return users
    .filter((user) => (user.name || '').trim())
    .map((user) => ({
      _id: String(user._id),
      name: user.name,
      email: user.email || '',
      // The rank the admin set for this teacher — printed on the document.
      designation: user.designation || '',
    }));
}

/**
 * Resolves which faculty the document names: an explicit choice, validated
 * against the course's own list; otherwise the first, so a single-teacher course
 * needs no interaction. A choice that is not on the list is refused — the client
 * can pick a teacher, but it can never invent one.
 */
export function pickFaculty(options, facultyId) {
  if (!options.length) {
    if (facultyId) throw new ApiError(422, 'That course has no assigned teacher');
    return null;
  }
  if (!facultyId) return options[0];
  const match = options.find((option) => option._id === String(facultyId));
  if (!match) throw new ApiError(422, 'Choose a teacher from the selected course’s list');
  return match;
}

/**
 * The flat `source -> value` map an AUTO field resolves against, plus the ids
 * behind those values for the job's audit snapshot.
 *
 * @param {object} user
 * @param {object|null} course
 * @param {{facultyId?: string|null}} [options] the teacher the student chose
 */
export async function buildContext(user, course, { facultyId = null } = {}) {
  const context = {};
  const ids = {
    userId: String(user._id),
    departmentId: user.department ? String(user.department) : '',
    batchId: user.batch ? String(user.batch) : '',
    semesterId: user.semester ? String(user.semester) : '',
    courseId: course ? String(course._id) : '',
    facultyId: '',
  };

  context['student.name'] = user.name || '';
  context['student.studentId'] = user.rollNo || '';
  context['student.group'] = user.group || '';

  const [batch, semester, department] = await Promise.all([
    user.batch ? Batch.findById(user.batch).select('name code') : null,
    user.semester ? Semester.findById(user.semester).select('name code') : null,
    user.department ? Department.findById(user.department).select('name code') : null,
  ]);
  if (batch) {
    context['student.batch'] = batch.name || batch.code || '';
    context['batch.code'] = batch.code || '';
  }
  if (semester) {
    context['student.semester'] = semester.name || semester.code || '';
    context['semester.code'] = semester.code || '';
  }
  if (department) {
    context['student.department'] = department.name || department.code || '';
    context['department.name'] = context['student.department'];
    context['department.code'] = department.code || '';
  }

  let facultyOptions = [];
  let chosenFacultyId = '';

  if (course) {
    context['course.code'] = course.courseId || '';
    context['course.name'] = course.name || '';
    context['course.credit'] = course.credit == null ? '' : String(course.credit);
    context['course.semester'] = course.semester || '';
    if (course.department) {
      const courseDepartment = await Department.findById(course.department).select('name code');
      context['course.department'] = courseDepartment ? (courseDepartment.name || courseDepartment.code || '') : '';
      if (!context['department.name']) context['department.name'] = context['course.department'];
    }

    // The teacher printed on the cover is the one the student chose, checked
    // against the faculty the course actually has.
    facultyOptions = await facultyOptionsForCourse(course);
    const chosen = pickFaculty(facultyOptions, facultyId);
    if (chosen) {
      context['faculty.name'] = chosen.name || '';
      context['faculty.designation'] = chosen.designation || '';
      context['faculty.email'] = chosen.email || '';
      chosenFacultyId = chosen._id;
      ids.facultyId = chosen._id;
    }
  }

  context['university.name'] = env.universityName || '';
  return { context, ids, facultyOptions, chosenFacultyId };
}

/** HTML for the live preview — the same title/version/values the worker renders. */
export async function renderPreview({ user, templateId, courseId, inputData, facultyId = null }) {
  const { template, version } = await loadUsableTemplate(user, templateId);
  const course = await assertCourseAccess(user, courseId);
  const { context } = await buildContext(user, course, { facultyId });
  const { values } = buildRenderData({ fields: version.fields, context, inputData });
  // The logo (and any other image element) is embedded from the server's own
  // img/ folder, so the preview shows exactly what the PDF will.
  const assets = await assetDataUris(version.fields);
  return renderHtml(version, values, { title: template.name, assets });
}

/**
 * Creates the job row and returns it. Validation happens first, so a bad field
 * never leaves a job behind. Enqueuing is the caller's next step.
 */
export async function createJob({ user, templateId, courseId, inputData, facultyId = null }) {
  const { template, version } = await loadUsableTemplate(user, templateId);
  const course = await assertCourseAccess(user, courseId);

  // The caps are checked before the render so an over-quota request fails fast.
  const activeCount = await DocumentJob.countDocuments({
    user: user._id,
    status: { $in: DOCUMENT_ACTIVE_STATUSES },
  });
  if (activeCount >= env.documents.maxActiveJobs) {
    throw new ApiError(429, 'You already have documents generating. Please wait for them to finish.', null, 'TOO_MANY_REQUESTS');
  }
  const recentCount = await DocumentJob.countDocuments({
    user: user._id,
    createdAt: { $gte: new Date(Date.now() - DAY_MS) },
  });
  if (recentCount >= env.documents.maxJobsPerDay) {
    throw new ApiError(429, 'You have reached the daily document limit. Please try again tomorrow.', null, 'TOO_MANY_REQUESTS');
  }

  // Resolve (and therefore validate) the values now, so a validation error is a
  // synchronous 422 rather than a job that fails in the worker. Only the
  // editable inputs are persisted — official values are never accepted.
  const { context, ids, chosenFacultyId } = await buildContext(user, course, { facultyId });
  const { resolved } = buildRenderData({ fields: version.fields, context, inputData });

  // Persist only what the student was allowed to type. A forged key for an
  // official field (student name / student ID) is not merely ignored when the
  // document renders — it is never stored either.
  const editableKeys = new Set(version.fields.filter((f) => f.editable).map((f) => f.key));

  return DocumentJob.create({
    user: user._id,
    template: template._id,
    templateVersion: version.version,
    templateName: template.name,
    category: template.category,
    courseId: course ? course._id : null,
    // Pinned, so a retry (or a later regeneration from this row) prints the same
    // teacher the student chose rather than silently falling back to the first.
    facultyId: chosenFacultyId || null,
    inputData: sanitizeInputData(inputData, editableKeys),
    resolved: { fields: resolved, ids },
    status: 'QUEUED',
  });
}

/**
 * Keeps the declared editable keys, as strings. `allowed`, when supplied, is the
 * set of keys the template actually marks editable — anything else (an official
 * field's key, say) is dropped rather than stored.
 */
function sanitizeInputData(inputData, allowed = null) {
  if (!inputData || typeof inputData !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(inputData)) {
    if (typeof key !== 'string' || key.startsWith('$') || key.includes('.')) continue;
    if (allowed && !allowed.has(key)) continue;
    if (value === undefined || value === null) continue;
    clean[key] = String(value).slice(0, 2000);
  }
  return clean;
}

/** The object key for a generated document: generated-documents/{yyyy}/{MM}/{userId}/{jobId}.pdf */
export function documentKey(job) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `generated-documents/${year}/${month}/${job.user}/${job._id}.pdf`;
}

/**
 * The download name of a generated document:
 * `Course Name - Course ID - Student Name - Student ID - <random>.pdf`.
 *
 * <p>The random suffix keeps two documents for the same course and student from
 * overwriting each other in the browser's download folder. Anything the
 * filesystem or a `Content-Disposition` header cannot carry is folded to a
 * hyphen, so a name can never break the download.
 */
export function documentFileName(user, course) {
  const parts = [
    course?.name,
    course?.courseId,
    user?.name,
    user?.rollNo,
    // 6 digits, so two files in the same second still differ.
    Math.floor(100000 + Math.random() * 900000),
  ]
    .map((part) => (part === undefined || part === null ? '' : String(part).trim()))
    .filter(Boolean);

  const base = parts
    .join(' - ')
    // Reserved for the filesystem / header, plus control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return `${base || 'document'}.pdf`;
}

/**
 * The worker's whole job: load, resolve, render, upload, complete, notify.
 * Idempotent — a job already in a terminal state is left alone, so a retried
 * message cannot produce a second document.
 */
export async function processJob(jobId, { renderPdf, storeDocument } = {}) {
  const job = await DocumentJob.findById(jobId);
  // The row can be gone because the user deleted the document (or it expired and
  // the sweep removed it) while the job was still queued. There is nothing to
  // render, and nothing to report as an error either.
  if (!job) return null;
  if (['COMPLETED', 'DELETED', 'EXPIRED'].includes(job.status)) return job;

  job.status = 'PROCESSING';
  job.startedAt = job.startedAt || new Date();
  job.attempts += 1;
  job.error = '';
  await job.save();

  try {
    const user = await User.findById(job.user);
    if (!user) throw new Error('The requesting user no longer exists');

    const template = await DocumentTemplate.findById(job.template);
    if (!template) throw new Error('The template no longer exists');

    const version = await DocumentTemplateVersion.findOne({
      template: template._id,
      version: job.templateVersion,
    });
    if (!version) throw new Error(`Template version ${job.templateVersion} no longer exists`);

    const course = job.courseId ? await Course.findById(job.courseId) : null;

    const { context, ids } = await buildContext(user, course, { facultyId: job.facultyId });
    const { values, resolved } = buildRenderData({
      fields: version.fields,
      context,
      inputData: job.inputData,
    });

    // The PDF engine and the upload are imported here rather than at module
    // scope: this file is also loaded by the API process (preview/status), and
    // that process should not pull Playwright in unless it actually renders.
    const render = renderPdf || (await import('../pdf/pdfService.js')).renderPdf;
    const store = storeDocument || (await import('../storage/storageService.js')).storeGeneratedDocument;

    const html = renderHtml(version, values, {
      title: template.name,
      assets: await assetDataUris(version.fields),
    });
    const pdf = await render(html);
    const { storageRef } = await store(documentKey(job), pdf);

    job.s3Key = storageRef;
    // Course + student in the name, so the downloaded file is self-describing.
    job.fileName = documentFileName(user, course);
    job.sizeBytes = pdf.length;
    job.resolved = { fields: resolved, ids };
    job.status = 'COMPLETED';
    job.completedAt = new Date();
    job.expiresAt = new Date(Date.now() + env.documents.expiryHours * 60 * 60 * 1000);
    await job.save();

    // Notification is a courtesy, not part of the document. If it fails, the
    // document is still complete and downloadable — the spec is explicit that a
    // notification failure must not fail the generation.
    try {
      await emit({
        type: 'DOCUMENT_READY',
        entityType: 'DOCUMENT_JOB',
        entityId: job._id,
        vars: { documentId: String(job._id), templateName: template.name },
        recipients: [user._id],
      });
    } catch (notifyError) {
      console.error('[documents] notification failed', safeErrorMessage(notifyError));
    }

    return job;
  } catch (error) {
    job.error = safeErrorMessage(error);
    await job.save();
    throw error;
  }
}

/**
 * Removes one document for good: its stored object first, then its row.
 *
 * <p>Extracted so the ordering, and the "there is no object" case, are testable
 * without a database. Storage first because the row is the only thing that names
 * the object — removing the row first could orphan the file.
 *
 * @param {{_id:any, s3Key?:string}} job
 * @param {{removeStored:(key:string)=>Promise<void>, removeRow:(id:any)=>Promise<void>}} deps
 */
export async function removeDocumentStorageThenRow(job, { removeStored, removeRow }) {
  if (job.s3Key) {
    await removeStored(job.s3Key);
  }
  await removeRow(job._id);
}

/**
 * The hourly sweep: a document past its expiry is removed outright — the stored
 * object first, then the row — so neither the file nor a stale row is left
 * behind. Returns how many documents were removed.
 *
 * @param {{deleteStored?:(key:string)=>Promise<void>}} [deps] injectable for
 *   tests; production uses the storage service (imported lazily, like the PDF
 *   engine, so the API process does not pull the storage SDK in unless it sweeps).
 */
export async function expireStaleJobs({ deleteStored = null } = {}) {
  const stale = await DocumentJob.find({
    status: { $in: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] },
    expiresAt: { $ne: null, $lte: new Date() },
  }).select('_id s3Key');

  if (stale.length === 0) return { expired: 0 };

  const removeStored = deleteStored
    || (await import('../storage/storageService.js')).deleteGeneratedDocument;

  let expired = 0;
  for (const job of stale) {
    // eslint-disable-next-line no-await-in-loop
    await removeDocumentStorageThenRow(job, {
      removeStored,
      removeRow: (id) => DocumentJob.deleteOne({ _id: id }),
    });
    expired += 1;
  }
  return { expired };
}

/**
 * One-off cleanup for rows left over from before deletion became permanent: a
 * document that was soft-deleted (`DELETED`) or merely flagged (`EXPIRED`) still
 * has its object and row. Removes both, object first, exactly as the live paths
 * do. Safe to re-run — it matches nothing once they are gone.
 *
 * @param {{deleteStored?:(key:string)=>Promise<void>}} [deps]
 */
export async function purgeRemovedDocuments({ deleteStored = null } = {}) {
  const legacy = await DocumentJob.find({ status: { $in: ['DELETED', 'EXPIRED'] } })
    .select('_id s3Key');

  if (legacy.length === 0) return { purged: 0 };

  const removeStored = deleteStored
    || (await import('../storage/storageService.js')).deleteGeneratedDocument;

  let purged = 0;
  for (const job of legacy) {
    // eslint-disable-next-line no-await-in-loop
    await removeDocumentStorageThenRow(job, {
      removeStored,
      removeRow: (id) => DocumentJob.deleteOne({ _id: id }),
    });
    purged += 1;
  }
  return { purged };
}

/** The client-facing shape of a job — never the object key, never a URL. */
export function serializeJob(job) {
  return {
    _id: job._id,
    templateId: job.template,
    templateName: job.templateName,
    templateVersion: job.templateVersion,
    category: job.category,
    courseId: job.courseId,
    facultyId: job.facultyId,
    status: job.status,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    expired: job.status === 'EXPIRED' || (job.expiresAt ? job.expiresAt.getTime() <= Date.now() : false),
    downloadable: job.status === 'COMPLETED' && Boolean(job.s3Key)
      && (!job.expiresAt || job.expiresAt.getTime() > Date.now()),
    inputData: job.inputData,
    // What was actually printed, so the document screen can show it (including
    // the teacher that was chosen).
    resolved: job.resolved,
  };
}

export default {
  listEligibleTemplates,
  loadUsableTemplate,
  assertCourseAccess,
  buildContext,
  facultyOptionsForCourse,
  pickFaculty,
  renderPreview,
  createJob,
  processJob,
  expireStaleJobs,
  purgeRemovedDocuments,
  removeDocumentStorageThenRow,
  serializeJob,
  documentKey,
  documentFileName,
  safeErrorMessage,
};
