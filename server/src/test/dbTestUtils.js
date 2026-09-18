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
export async function connectTestDb(label) {
  const dbName = `notif_test_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`);
  return dbName;
}

export async function dropAndDisconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearCollections(...models) {
  await Promise.all(models.map((m) => m.deleteMany({})));
}
