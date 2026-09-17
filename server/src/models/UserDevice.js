import mongoose from 'mongoose';

// One Android/iOS app install that can receive FCM push. Deliberately separate
// from PushSubscription: that collection holds *Web Push* subscriptions, whose
// identity is an endpoint URL + p256dh/auth keys and whose lifecycle is driven
// by the browser's 410 Gone. An FCM registration token has neither, so sharing
// one collection would mean two different identity/lifecycle rules in one schema.
//
// Registering here never touches the Notification collection — the backend's
// notification system remains the single source of truth for history and
// read/unread state; this collection only answers "which devices should this
// push be delivered to".
const userDeviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // The FCM registration token. Unique across the whole collection because one
    // install has exactly one *current* token — a device that signed into a
    // different account re-points the existing row instead of creating a second
    // one, and a refreshed token replaces the old value (see registerDevice).
    fcmToken: { type: String, required: true, unique: true },

    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    appVersion: { type: String, default: '' },
    deviceModel: { type: String, default: '' },

    // Flipped to false when the user signs out, or when FCM reports the token as
    // unregistered/invalid. Never deleted outright, so "this device used to be
    // registered, and when" stays inspectable — same convention as
    // PushSubscription.isActive.
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The fan-out query: "every active device belonging to this user".
userDeviceSchema.index({ user: 1, isActive: 1 });

export default mongoose.model('UserDevice', userDeviceSchema, 'user_devices');
