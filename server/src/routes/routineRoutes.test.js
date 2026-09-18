import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import Settings, { getSettings } from '../models/Settings.js';
import routineRoutes from './routineRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

// The group list is the one route on this router that is deliberately public: the
// registration form needs it before the student has a session. Everything else
// must still refuse an anonymous caller.
//
// That is a property of middleware ORDER (`router.get('/groups', …)` sits above
// `router.use(authenticate)`), which is exactly the kind of thing a later
// refactor can quietly undo — so it is asserted over real HTTP against the real
// router and the real error handler, rather than by reading the file. No new test
// dependency: express and Node's global fetch are both already here.

describe('routine routes — what an anonymous caller may reach', () => {
  let server;
  let base;

  before(async () => {
    await connectTestDb('routine-routes-anonymous');
    await clearCollections(Settings);

    // getSettings() upserts defaults, but the list is part of what this asserts,
    // so it is stated rather than inherited.
    const settings = await getSettings();
    settings.academicGroups = ['BOTH', 'A1', 'A2'];
    await settings.save();

    const app = express();
    app.use('/api/routine', routineRoutes);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/routine`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await dropAndDisconnect();
  });

  test('GET /groups answers without a token', async () => {
    const response = await fetch(`${base}/groups`);

    assert.equal(response.status, 200, 'the registration form has no session to send');
    const body = await response.json();
    assert.deepEqual(body.data.groups, ['BOTH', 'A1', 'A2']);
  });

  test('the schedule itself still requires a session', async () => {
    const response = await fetch(`${base}/my`);

    assert.equal(response.status, 401);
  });

  test('managing the routine still requires a session', async () => {
    const templates = await fetch(`${base}/templates`);
    const instances = await fetch(`${base}/instances?date=2026-09-20`);

    assert.equal(templates.status, 401);
    assert.equal(instances.status, 401);
  });
});
