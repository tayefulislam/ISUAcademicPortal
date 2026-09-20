import mongoose from 'mongoose';
import { env } from '../config/env.js';

// Tests must never reach a real mail provider, even on a checkout whose .env
// carries live SMTP/Resend credentials — every notification now also attempts an
// email, so an unmodified provider here would open real SMTP connections (and
// send real mail) during the suite. Forcing the console transport keeps the
// email path exercised without leaving the process.
env.email.provider = 'console';
env.email.smtp = { ...env.email.smtp, host: '', user: '', pass: '' };

// Every notification test file gets its own throwaway database (never the
// real dev DB from .env's MONGODB_URI) so tests can freely create/delete
// Users/Courses/etc. without touching real data, and so files running in
// separate node:test worker processes never collide with each other.

/**
 * Points a throwaway database name at whichever MongoDB the suite should use.
 *
 * Localhost by default. On a machine with no local server — a deploy box whose
 * database is Atlas, for instance — set TEST_MONGODB_URI to the cluster's
 * connection string, with or without a database and with or without options:
 *
 *   TEST_MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true"
 *
 * Any database already named in that string is REPLACED by the throwaway name,
 * so the suite can only ever create and drop a `notif_test_*` database. It
 * cannot touch the application's own data even if the URI points straight at it.
 */
function testDatabaseUri(dbName) {
  const override = (process.env.TEST_MONGODB_URI || '').trim();
  if (!override) {
    return `mongodb://127.0.0.1:27017/${dbName}`;
  }
  const [head, query] = override.split('?');
  // Keep scheme + credentials + host; drop any database already in the path.
  const match = head.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/.*)?$/);
  const authority = match ? match[1] : head;
  return `${authority}/${dbName}${query ? `?${query}` : ''}`;
}

export async function connectTestDb(label) {
  const dbName = `notif_test_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  // A shorter selection timeout than the driver's 30-second default, so an
  // unreachable server fails the file quickly instead of stalling every suite.
  await mongoose.connect(testDatabaseUri(dbName), { serverSelectionTimeoutMS: 15000 });
  return dbName;
}

export async function dropAndDisconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearCollections(...models) {
  await Promise.all(models.map((m) => m.deleteMany({})));
}
