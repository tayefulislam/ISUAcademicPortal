import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import UserDevice from '../models/UserDevice.js';
import {
  registerDevice,
  unregisterDevice,
  listDevices,
} from './deviceController.js';

// Device registration is what makes FCM delivery possible for the Android app.
// It is deliberately NOT part of the notification system: the Notification
// collection remains the source of truth for history/read state, and this only
// answers "which devices should a push go to".

before(async () => {
  await connectTestDb('devices');
});

after(async () => {
  await dropAndDisconnect();
});

let owner, other;

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_C = 'fcm-token-cccccccccccccccccccccccccccc';

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

beforeEach(async () => {
  await clearCollections(User, UserDevice);

  const mk = (email) =>
    User.create({ name: 'U', email, password: 'password123', role: 'student' });

  owner = await mk(`owner-${Math.random().toString(36).slice(2)}@test.local`);
  other = await mk(`other-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('registerDevice', () => {
  test('registers a device against the authenticated user', async () => {
    const body = await invoke(registerDevice, {
      user: owner,
      body: { token: TOKEN_A, platform: 'android', appVersion: '1.0' },
    });

    assert.equal(body.success, true);
    const device = await UserDevice.findOne({ fcmToken: TOKEN_A });
    assert.equal(String(device.user), String(owner._id));
    assert.equal(device.platform, 'android');
    assert.equal(device.appVersion, '1.0');
    assert.equal(device.isActive, true);
  });

  test('re-registering the same token updates one row rather than duplicating it', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A, appVersion: '1.0' } });
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A, appVersion: '1.1' } });

    assert.equal(await UserDevice.countDocuments({ fcmToken: TOKEN_A }), 1);
    const device = await UserDevice.findOne({ fcmToken: TOKEN_A });
    assert.equal(device.appVersion, '1.1');
  });

  test('re-registering a token that was unregistered reactivates it', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(unregisterDevice, { user: owner, body: { token: TOKEN_A } });
    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_A })).isActive, false);

    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_A })).isActive, true);
  });

  test('one user can hold several devices at once — a new registration never replaces the others', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_B } });
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_C } });

    const active = await UserDevice.countDocuments({ user: owner._id, isActive: true });
    assert.equal(active, 3);
  });

  test('a token that signs into a different account is re-pointed, not duplicated', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(registerDevice, { user: other, body: { token: TOKEN_A } });

    assert.equal(await UserDevice.countDocuments({ fcmToken: TOKEN_A }), 1);
    const device = await UserDevice.findOne({ fcmToken: TOKEN_A });
    assert.equal(String(device.user), String(other._id));
    assert.equal(await UserDevice.countDocuments({ user: owner._id, isActive: true }), 0);
  });

  test('rejects a missing or implausibly short token', async () => {
    assert.equal(await statusOf(registerDevice, { user: owner, body: {} }), 400);
    assert.equal(await statusOf(registerDevice, { user: owner, body: { token: 'short' } }), 400);
  });
});

describe('unregisterDevice', () => {
  test('deactivates the device rather than deleting it', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(unregisterDevice, { user: owner, body: { token: TOKEN_A } });

    assert.equal(await UserDevice.countDocuments({ fcmToken: TOKEN_A }), 1, 'the row survives');
    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_A })).isActive, false);
  });

  test('leaves the user\'s other devices untouched', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_B } });

    await invoke(unregisterDevice, { user: owner, body: { token: TOKEN_A } });

    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_A })).isActive, false);
    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_B })).isActive, true);
  });

  test('succeeds for an unknown token, so sign-out can never fail on cleanup', async () => {
    const body = await invoke(unregisterDevice, { user: owner, body: { token: TOKEN_C } });
    assert.equal(body.success, true);
  });

  test('refuses to unregister another user\'s device', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });

    assert.equal(await statusOf(unregisterDevice, { user: other, body: { token: TOKEN_A } }), 403);
    assert.equal((await UserDevice.findOne({ fcmToken: TOKEN_A })).isActive, true, 'still active');
  });
});

describe('listDevices', () => {
  test('returns only the caller\'s own devices, and never the raw token', async () => {
    await invoke(registerDevice, { user: owner, body: { token: TOKEN_A } });
    await invoke(registerDevice, { user: other, body: { token: TOKEN_B } });

    const body = await invoke(listDevices, { user: owner });

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].platform, 'android');
    assert.equal(body.data[0].fcmToken, undefined, 'the token is a delivery credential and is not exposed');
  });
});
