import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Category from '../models/Category.js';
import File from '../models/File.js';
import Bookmark from '../models/Bookmark.js';
import BookmarkFolder from '../models/BookmarkFolder.js';
import {
  listBookmarks,
  addBookmark,
  removeBookmark,
  moveBookmark,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
} from './bookmarkController.js';

// Bookmarks became a small filing system: save (lands in the default bucket),
// create folders, move between them, and search — one server API that both the
// web client and the Android app call, so neither can drift from the other.

before(async () => {
  await connectTestDb('bookmarks');
});

after(async () => {
  await dropAndDisconnect();
});

let owner, stranger, dept, course, category, files;

function fakeRes() {
  return {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

async function invoke(handler, req) {
  const res = fakeRes();
  let failure = null;
  await handler(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return res.body;
}

async function statusOf(handler, req) {
  try {
    await invoke(handler, req);
    return null;
  } catch (err) {
    return err.statusCode;
  }
}

async function makeFile(overrides = {}) {
  const title = overrides.title || 'Untitled';
  return File.create({
    title,
    originalName: `${title}.pdf`,
    fileName: `${title.replace(/\s+/g, '-').toLowerCase()}.pdf`,
    fileType: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    fileUrl: 'https://example.test/file.pdf',
    storageProvider: 'local',
    department: dept._id,
    departmentCode: 'CSE',
    course: course._id,
    courseName: 'Algorithms',
    courseId: 'CSE-301',
    category: category._id,
    categoryName: 'Lecture Notes',
    uploadedBy: owner._id,
    attachments: [
      {
        originalName: `${title}.pdf`,
        fileName: `${title.replace(/\s+/g, '-').toLowerCase()}.pdf`,
        fileType: 'pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        fileUrl: 'https://example.test/file.pdf',
        storageProvider: 'local',
      },
    ],
    ...overrides,
  });
}

/** Bookmark a file straight through the controller, as a client would. */
async function bookmark(file, user = owner, folderId) {
  await invoke(addBookmark, {
    user,
    params: { fileId: String(file._id) },
    body: folderId === undefined ? {} : { folderId },
  });
}

beforeEach(async () => {
  await clearCollections(User, Department, Course, Category, File, Bookmark, BookmarkFolder);

  dept = await Department.create({ name: 'Computer Science', code: 'CSE' });
  course = await Course.create({ name: 'Algorithms', courseId: 'CSE-301', department: dept._id });
  category = await Category.create({ name: 'Lecture Notes', slug: 'lecture-notes' });

  const mkUser = (email) =>
    User.create({ name: 'U', email, password: 'password123', role: 'student' });

  owner = await mkUser(`owner-${Math.random().toString(36).slice(2)}@test.local`);
  stranger = await mkUser(`stranger-${Math.random().toString(36).slice(2)}@test.local`);

  files = {
    algorithms: await makeFile({ title: 'Algorithms' }),
    databases: await makeFile({ title: 'Databases', courseName: 'Databases', courseId: 'CSE-303' }),
    marketing: await makeFile({ title: 'Marketing Plan', courseName: 'Marketing' }),
  };
});

describe('folders', () => {
  test('creates a folder and lists it with a zero count', async () => {
    const created = await invoke(createFolder, { user: owner, body: { name: 'Semester 3' } });
    assert.equal(created.success, true);
    assert.equal(created.data.name, 'Semester 3');

    const listed = await invoke(listFolders, { user: owner });
    assert.equal(listed.data.folders.length, 1);
    assert.equal(listed.data.folders[0].name, 'Semester 3');
    assert.equal(listed.data.folders[0].fileCount, 0);
    assert.equal(listed.data.defaultCount, 0);
    assert.equal(listed.data.total, 0);
  });

  test('rejects a duplicate folder name, including one differing only by case', async () => {
    await invoke(createFolder, { user: owner, body: { name: 'Semester 3' } });

    assert.equal(await statusOf(createFolder, { user: owner, body: { name: 'Semester 3' } }), 409);
    assert.equal(await statusOf(createFolder, { user: owner, body: { name: 'semester 3' } }), 409);
  });

  test('rejects an empty folder name', async () => {
    assert.equal(await statusOf(createFolder, { user: owner, body: { name: '   ' } }), 400);
  });

  test('renames a folder', async () => {
    const created = await invoke(createFolder, { user: owner, body: { name: 'Old' } });
    const renamed = await invoke(renameFolder, {
      user: owner,
      params: { id: String(created.data._id) },
      body: { name: 'New' },
    });

    assert.equal(renamed.data.name, 'New');
    const listed = await invoke(listFolders, { user: owner });
    assert.equal(listed.data.folders[0].name, 'New');
  });

  test('renaming onto another existing name is rejected', async () => {
    await invoke(createFolder, { user: owner, body: { name: 'A' } });
    const second = await invoke(createFolder, { user: owner, body: { name: 'B' } });

    assert.equal(
      await statusOf(renameFolder, { user: owner, params: { id: String(second.data._id) }, body: { name: 'a' } }),
      409
    );
  });

  test("one user cannot see or touch another's folders", async () => {
    const mine = await invoke(createFolder, { user: owner, body: { name: 'Private' } });

    const strangerList = await invoke(listFolders, { user: stranger });
    assert.equal(strangerList.data.folders.length, 0);

    assert.equal(
      await statusOf(renameFolder, { user: stranger, params: { id: String(mine.data._id) }, body: { name: 'Hijacked' } }),
      404
    );
    assert.equal(
      await statusOf(deleteFolder, { user: stranger, params: { id: String(mine.data._id) } }),
      404
    );
  });

  test('deleting a folder returns its bookmarks to the default bucket instead of losing them', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Temp' } })).data;
    await bookmark(files.algorithms, owner, String(folder._id));
    await bookmark(files.databases, owner, String(folder._id));

    const deleted = await invoke(deleteFolder, { user: owner, params: { id: String(folder._id) } });
    assert.equal(deleted.data.movedToDefault, 2);

    const all = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(all.data.length, 2);
    assert.ok(all.data.every((item) => item.folder === null));

    const listed = await invoke(listFolders, { user: owner });
    assert.equal(listed.data.folders.length, 0);
    assert.equal(listed.data.defaultCount, 2);
  });

  test('counts follow the same live-file rule as the list, and separate the default bucket', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Filing' } })).data;
    await bookmark(files.algorithms);                          // default
    await bookmark(files.databases, owner, String(folder._id)); // filed
    await bookmark(files.marketing, owner, String(folder._id));  // filed, then its file is removed

    await File.deleteOne({ _id: files.marketing._id });

    const listed = await invoke(listFolders, { user: owner });
    assert.equal(listed.data.folders[0].fileCount, 1);
    assert.equal(listed.data.defaultCount, 1);
    assert.equal(listed.data.total, 2);
  });
});

describe('saving and moving', () => {
  test('saving with no folder lands in the default bucket', async () => {
    await bookmark(files.algorithms);

    const all = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(all.data.length, 1);
    assert.equal(all.data[0].folder, null);
    assert.equal(all.data[0].folderName, null);
  });

  test('saving straight into a folder files it immediately', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Exam prep' } })).data;
    await bookmark(files.algorithms, owner, String(folder._id));

    const all = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(all.data[0].folder, String(folder._id));
    assert.equal(all.data[0].folderName, 'Exam prep');
  });

  test('re-saving an already-bookmarked file with a folder moves it rather than failing', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Later' } })).data;
    await bookmark(files.algorithms);

    const again = await invoke(addBookmark, {
      user: owner,
      params: { fileId: String(files.algorithms._id) },
      body: { folderId: String(folder._id) },
    });

    assert.match(again.message, /moved/i);
    const all = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(all.data.length, 1, 'still exactly one bookmark for the file');
    assert.equal(all.data[0].folder, String(folder._id));
  });

  test('moves a bookmark from the default bucket into a folder and back', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Semester 3' } })).data;
    await bookmark(files.algorithms);

    await invoke(moveBookmark, {
      user: owner,
      params: { fileId: String(files.algorithms._id) },
      body: { folderId: String(folder._id) },
    });

    const filed = await invoke(listBookmarks, { user: owner, query: { folder: 'default' } });
    assert.equal(filed.data.length, 0, 'no longer in the default bucket');

    const inFolder = await invoke(listBookmarks, {
      user: owner,
      query: { folder: String(folder._id) },
    });
    assert.equal(inFolder.data.length, 1);

    await invoke(moveBookmark, {
      user: owner,
      params: { fileId: String(files.algorithms._id) },
      body: { folderId: 'default' },
    });

    const back = await invoke(listBookmarks, { user: owner, query: { folder: 'default' } });
    assert.equal(back.data.length, 1);
    assert.equal(back.data[0].folder, null);
  });

  test('requires folderId when moving', async () => {
    await bookmark(files.algorithms);
    assert.equal(
      await statusOf(moveBookmark, {
        user: owner,
        params: { fileId: String(files.algorithms._id) },
        body: {},
      }),
      400
    );
  });

  test('refuses to move into a folder the caller does not own', async () => {
    const theirs = (await invoke(createFolder, { user: stranger, body: { name: 'Theirs' } })).data;
    await bookmark(files.algorithms);

    assert.equal(
      await statusOf(moveBookmark, {
        user: owner,
        params: { fileId: String(files.algorithms._id) },
        body: { folderId: String(theirs._id) },
      }),
      400
    );
  });

  test('rejects an invalid folder id and a file that is not bookmarked', async () => {
    await bookmark(files.algorithms);

    assert.equal(
      await statusOf(moveBookmark, {
        user: owner,
        params: { fileId: String(files.algorithms._id) },
        body: { folderId: 'not-an-object-id' },
      }),
      400
    );
    assert.equal(
      await statusOf(moveBookmark, {
        user: owner,
        params: { fileId: String(files.databases._id) },
        body: { folderId: 'default' },
      }),
      404
    );
  });

  test('removing a bookmark deletes it', async () => {
    await bookmark(files.algorithms);
    await invoke(removeBookmark, { user: owner, params: { fileId: String(files.algorithms._id) } });

    const all = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(all.data.length, 0);
  });
});

describe('search', () => {
  test('returns everything for a query shorter than two characters', async () => {
    await bookmark(files.algorithms);
    await bookmark(files.databases);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'a' } });
    assert.equal(listed.data.length, 2);
    assert.equal(listed.suggestion, null);
  });

  test('matches on title prefix', async () => {
    await bookmark(files.algorithms);
    await bookmark(files.marketing);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'algo' } });
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].title, 'Algorithms');
  });

  test('matches despite a transposed typo (the whole point of the shared engine)', async () => {
    await bookmark(files.algorithms);
    await bookmark(files.marketing);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'algortihm' } });
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].title, 'Algorithms');
  });

  test('matches on the course name as well as the title', async () => {
    await bookmark(files.databases);
    await bookmark(files.marketing);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'databases' } });
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].title, 'Databases');
  });

  test('offers a correction drawn from the bookmarks themselves when nothing matches', async () => {
    await bookmark(files.algorithms);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'algoritms' } });
    assert.equal(listed.suggestion, 'algorithms');
  });

  test('returns nothing, and no suggestion, when the term is absent entirely', async () => {
    await bookmark(files.algorithms);

    const listed = await invoke(listBookmarks, { user: owner, query: { q: 'zzzzqqqq' } });
    assert.equal(listed.data.length, 0);
    assert.equal(listed.suggestion, null);
  });

  test('search and the folder filter combine', async () => {
    const folder = (await invoke(createFolder, { user: owner, body: { name: 'Filed' } })).data;
    await bookmark(files.algorithms, owner, String(folder._id));
    await bookmark(files.databases);

    const inFolder = await invoke(listBookmarks, {
      user: owner,
      query: { q: 'databases', folder: String(folder._id) },
    });
    assert.equal(inFolder.data.length, 0, 'Databases is not in that folder');

    const both = await invoke(listBookmarks, {
      user: owner,
      query: { q: 'algorithms', folder: String(folder._id) },
    });
    assert.equal(both.data.length, 1);
  });

  test('never returns another user\'s bookmarks', async () => {
    await bookmark(files.algorithms, owner);
    await bookmark(files.databases, stranger);

    const mine = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(mine.data.length, 1);
    assert.equal(mine.data[0].title, 'Algorithms');

    const searched = await invoke(listBookmarks, { user: owner, query: { q: 'databases' } });
    assert.equal(searched.data.length, 0);
  });

  test('drops a bookmark whose file has since been deleted', async () => {
    await bookmark(files.algorithms);
    await bookmark(files.databases);
    await File.deleteOne({ _id: files.databases._id });

    const listed = await invoke(listBookmarks, { user: owner, query: {} });
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].title, 'Algorithms');
  });
});
