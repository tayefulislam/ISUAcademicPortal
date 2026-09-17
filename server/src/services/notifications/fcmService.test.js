import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../../test/dbTestUtils.js';
import User from '../../models/User.js';
import UserDevice from '../../models/UserDevice.js';
import { buildPushData, sendToUserDevices, ANDROID_CHANNEL_ID } from './fcmService.js';

// The FCM transport is optional by design: with no Firebase service account
// configured, every call must no-op instead of throwing, so in-app notifications
// keep working on a deployment that never set up Firebase. These tests pin that
// guarantee (the "no credentials" path is the only one exercisable without a real
// Firebase project).

before(async () => {
  await connectTestDb('fcm-service');
});

after(async () => {
  await dropAndDisconnect();
});

let owner;

beforeEach(async () => {
  await clearCollections(User, UserDevice);
  owner = await User.create({
    name: 'U',
    email: `u-${Math.random().toString(36).slice(2)}@test.local`,
    password: 'password123',
    role: 'student',
  });
});

describe('buildPushData', () => {
  test('keeps the keys the Android client routes on', () => {
    const data = buildPushData({
      notificationId: 'abc123',
      type: 'ASSIGNMENT_CREATED',
      entityType: 'ASSIGNMENT',
      entityId: '789',
      url: '/student/assignments/789',
      vars: { assignmentId: '789', courseId: 'CSE214' },
    });

    assert.equal(data.notificationId, 'abc123');
    assert.equal(data.type, 'ASSIGNMENT_CREATED');
    assert.equal(data.entityType, 'ASSIGNMENT');
    assert.equal(data.entityId, '789');
    assert.equal(data.assignmentId, '789');
    assert.equal(data.courseId, 'CSE214');
  });

  test('coerces non-string primitives, because FCM data values must all be strings', () => {
    const data = buildPushData({ type: 'SYSTEM', vars: { noticeId: 42 } });
    assert.equal(data.noticeId, '42');
    assert.equal(typeof data.noticeId, 'string');
  });

  test('drops null, undefined, empty and object values rather than sending them', () => {
    const data = buildPushData({
      notificationId: null,
      type: '',
      entityId: undefined,
      url: '/notifications',
      vars: { course: { _id: 'x' }, deadline: null },
    });

    assert.equal('notificationId' in data, false);
    assert.equal('type' in data, false);
    assert.equal('entityId' in data, false);
    assert.equal('course' in data, false);
    assert.equal('deadline' in data, false);
    assert.equal(data.url, '/notifications');
  });

  test('ignores unknown keys entirely', () => {
    const data = buildPushData({ type: 'SYSTEM', vars: { password: 'hunter2' } });
    assert.equal('password' in data, false);
  });

  test('exposes the channel id the Android client creates', () => {
    assert.equal(ANDROID_CHANNEL_ID, 'isu_academic_portal');
  });
});

describe('sendToUserDevices without Firebase credentials', () => {
  test('no-ops instead of throwing when Firebase is not configured', async () => {
    await UserDevice.create({ user: owner._id, fcmToken: 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

    const result = await sendToUserDevices(owner._id, {
      title: 'New Assignment',
      body: 'CSE 214 assignment has been posted.',
      data: { type: 'ASSIGNMENT_CREATED' },
    });

    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 'not-configured');
  });

  test('no-ops for a user with no registered devices', async () => {
    const result = await sendToUserDevices(owner._id, { title: 't', body: 'b', data: {} });
    assert.equal(result.sent, 0);
  });

  test('never throws, whatever it is handed', async () => {
    await assert.doesNotReject(() =>
      sendToUserDevices(owner._id, { title: null, body: undefined, data: null })
    );
  });
});
