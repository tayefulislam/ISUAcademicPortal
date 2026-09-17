// Lists registered devices for a user, and/or sends them a real push — so you can
// exercise tests 2–5 (foreground / background / closed, and tap navigation)
// without waiting for a genuine app event.
//
//   node scripts/sendTestPush.js --list
//   node scripts/sendTestPush.js --list --email superadmin@university.edu
//   node scripts/sendTestPush.js --email superadmin@university.edu
//   node scripts/sendTestPush.js --email you@example.com --type ASSIGNMENT_CREATED \
//        --title "New Assignment" --body "CSE 214 assignment has been posted."
//
// It calls the SAME sendToUserDevices() the notification system uses, so a
// successful run here means the production fan-out works — it is not a separate
// code path.

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import UserDevice from '../src/models/UserDevice.js';
import { sendToUserDevices, buildPushData } from '../src/services/notifications/fcmService.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

await mongoose.connect(env.mongodbUri);

if (has('list')) {
  const filter = {};
  const email = arg('email');
  if (email) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`No user with email ${email}`);
      process.exit(1);
    }
    filter.user = user._id;
  }
  const devices = await UserDevice.find(filter).populate('user', 'email name').sort({ lastSeenAt: -1 });
  console.log(`---- registered devices (${devices.length}) ----`);
  for (const d of devices) {
    console.log(
      `  ${d.isActive ? 'ACTIVE  ' : 'inactive'}  ${d.user?.email || d.user}  ` +
        `${d.platform} ${d.appVersion}  last seen ${d.lastSeenAt?.toISOString?.() || '-'}`
    );
  }
  await mongoose.disconnect();
  process.exit(0);
}

const email = arg('email');
const userId = arg('user');
if (!email && !userId) {
  console.log('Nothing to do. Pass --list, or --email <address> (or --user <id>) to send a push.');
  process.exit(1);
}

const user = email
  ? await User.findOne({ email: email.toLowerCase() })
  : await User.findById(userId);

if (!user) {
  console.log(`No user found for ${email || userId}`);
  process.exit(1);
}

const devices = await UserDevice.find({ user: user._id, isActive: true });
console.log(`---- ${user.email} ----`);
console.log(`  active devices : ${devices.length}`);
if (!devices.length) {
  console.log('  No active device. Sign in on the app first — check with --list.');
  await mongoose.disconnect();
  process.exit(1);
}

const type = arg('type') || 'ASSIGNMENT_CREATED';
const title = arg('title') || 'New Assignment';
const body = arg('body') || 'CSE 214 assignment has been posted.';
const data = buildPushData({
  type,
  entityType: 'ASSIGNMENT',
  entityId: arg('id') || 'test-entity-id',
  vars: { assignmentId: arg('id') || 'test-entity-id' },
});

console.log('---- sending ----');
console.log('  title/body :', title, '/', body);
console.log('  data       :', JSON.stringify(data));

const result = await sendToUserDevices(user._id, { title, body, data });
console.log('  result     :', JSON.stringify(result));

if (result.sent > 0) {
  console.log('');
  console.log('Sent. On the phone it should appear (or have appeared) in the tray.');
  console.log('Tapping it should open Assignment details, using data.type + assignmentId.');
}

await mongoose.disconnect();
process.exit(0);
