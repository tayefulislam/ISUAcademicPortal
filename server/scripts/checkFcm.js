// Checks that this deployment can actually send FCM pushes — no app or device
// needed. Proves the service account is genuine by doing two real round trips to
// Google: exchanging the private key for an OAuth token, then sending to a token
// that does not exist (which FCM can only answer once the request authenticated).
//
//   node scripts/checkFcm.js
//
// Exit code 0 = FCM is ready; 1 = not configured, or the credentials are rejected.

import { env } from '../src/config/env.js';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

function fail(message) {
  console.log('RESULT: ' + message);
  process.exit(1);
}

const raw = env.firebase.serviceAccountJson;
const path = env.firebase.serviceAccountPath;

console.log('---- configuration ----');
console.log('  FIREBASE_SERVICE_ACCOUNT      :', raw ? `set (${raw.length} chars)` : 'not set');
console.log('  FIREBASE_SERVICE_ACCOUNT_PATH :', path || 'not set');

if (!raw && !path) {
  console.log('');
  console.log('  Push is OPTIONAL. With neither variable set, fcmService silently skips');
  console.log('  every send and in-app notifications keep working. To enable push, set');
  console.log('  FIREBASE_SERVICE_ACCOUNT to the whole service-account JSON ON ONE LINE.');
  fail('not configured — push is currently disabled.');
}

if (raw) {
  try {
    const parsed = JSON.parse(raw);
    console.log('  parsed as JSON                : yes');
    console.log('  project_id                    :', parsed.project_id);
    console.log('  client_email                  :', parsed.client_email);
    if (!String(parsed.private_key || '').startsWith('-----BEGIN PRIVATE KEY-----')) {
      fail('the value parsed as JSON but carries no usable private_key.');
    }
  } catch (error) {
    console.log('');
    console.log('  The value is not valid JSON. The usual cause is pasting the');
    console.log('  pretty-printed service-account file across several lines — .env is');
    console.log('  read line by line, so everything after the first line is ignored.');
    console.log('  Error:', error.message);
    fail('malformed FIREBASE_SERVICE_ACCOUNT.');
  }
}

let credential;
try {
  credential = raw ? cert(JSON.parse(raw)) : cert(path);
} catch (error) {
  fail('could not load the credentials -> ' + error.message);
}

const app = getApps().length ? getApps()[0] : initializeApp({ credential });
const messaging = getMessaging(app);
console.log('---- initialisation ----');
console.log('  Firebase Admin initialised    : yes');

try {
  const result = await app.options.credential.getAccessToken();
  const token = result.access_token || result.accessToken;
  if (!token) fail('no OAuth token returned -> ' + JSON.stringify(result).slice(0, 200));
  console.log('  OAuth token (real round trip) : obtained — Google ACCEPTED the private key');
} catch (error) {
  fail('Google rejected the credentials -> ' + error.message);
}

// A token shaped like a real FCM registration token; a malformed one would be
// rejected locally and prove nothing.
const fake = 'fAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghijklmnop:APA91b' + 'A'.repeat(134);

try {
  const id = await messaging.send({
    token: fake,
    notification: { title: 'probe', body: 'probe' },
    data: { type: 'SYSTEM' },
    android: { notification: { channelId: 'isu_academic_portal' } },
  });
  console.log('  send to a fake token          : unexpectedly succeeded (' + id + ')');
} catch (error) {
  console.log('  send to a fake token          :', error.code);
  if (error.code !== 'messaging/registration-token-not-registered') {
    fail('send failed in an unexpected way -> ' + error.message);
  }
}

console.log('');
console.log('RESULT: FCM is READY. The credentials are valid and the request path');
console.log('        reaches Google. Real deliveries depend on device registrations');
console.log('        in the user_devices collection (GET /api/devices).');
process.exit(0);
