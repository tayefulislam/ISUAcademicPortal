import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Category from '../models/Category.js';
import File from '../models/File.js';
import Bookmark from '../models/Bookmark.js';
import { deleteFileRecord, deleteAllAttachmentsStrict } from './fileController.js';
import { deleteStoredFile, deleteStoredFileStrict } from '../services/storage/storageService.js';

// Deleting a material must remove the document AND everything that pointed at
// it, and must do so safely for an external-link material (which has no stored
// object at all). These pin the parts that are easy to get wrong: the bookmark
// reference dangling, and a no-object entry being treated as a deletion failure.

before(async () => {
  await connectTestDb('material-delete');
});

after(async () => {
  await dropAndDisconnect();
});

let user, department, course, category;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Category, File, Bookmark);

  department = await Department.create({ name: 'Computer Science', code: 'CSE' });
  course = await Course.create({ name: 'Data Structures', courseId: 'CSE-301', department: department._id });
  category = await Category.create({ name: 'Lecture Notes', slug: 'lecture-notes' });
  user = await User.create({
    name: 'Submitter',
    email: `${Math.random().toString(36).slice(2)}@test.local`,
    password: 'password123',
    role: 'student',
    department: department._id,
  });
});

function externalFile(overrides = {}) {
  const url = 'https://drive.google.com/file/d/abc123/view';
  return {
    title: 'External Notes',
    originalName: 'External Notes',
    fileName: url,
    fileType: 'other',
    mimeType: 'text/uri-list',
    fileSize: 0,
    fileUrl: url,
    storageProvider: 'external',
    storageRef: '',
    uploadType: 'external',
    externalUrl: url,
    attachments: [
      {
        originalName: 'External Notes',
        fileName: url,
        fileType: 'other',
        mimeType: 'text/uri-list',
        fileSize: 0,
        fileUrl: url,
        storageProvider: 'external',
        storageRef: '',
      },
    ],
    department: department._id,
    departmentCode: department.code,
    course: course._id,
    courseName: course.name,
    courseId: course.courseId,
    category: category._id,
    categoryName: category.name,
    uploadedBy: user._id,
    ...overrides,
  };
}

describe('storage delete helpers on an external-link material', () => {
  test('deleteStoredFile and deleteStoredFileStrict are no-ops (no error)', async () => {
    await assert.doesNotReject(() =>
      deleteStoredFile({ storageProvider: 'external', storageRef: '' })
    );
    await assert.doesNotReject(() =>
      deleteStoredFileStrict({ storageProvider: 'external', storageRef: '' })
    );
    // A missing storageRef is the same "nothing to delete" case.
    await assert.doesNotReject(() => deleteStoredFileStrict({ storageProvider: 's3', storageRef: '' }));
  });
});

describe('deleteFileRecord', () => {
  test('removes the document and any bookmarks that referenced it', async () => {
    const file = await File.create(externalFile());
    await Bookmark.create({ user: user._id, file: file._id });

    await deleteFileRecord(file);

    assert.equal(await File.findById(file._id), null);
    assert.equal(await Bookmark.countDocuments({ file: file._id }), 0);
  });

  test('deleteAllAttachmentsStrict succeeds for an external material', async () => {
    const file = await File.create(externalFile());
    await assert.doesNotReject(() => deleteAllAttachmentsStrict(file));
  });
});
