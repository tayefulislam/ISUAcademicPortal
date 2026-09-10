import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // The Push API subscription itself — endpoint uniquely identifies one
    // browser/device registration, so it (not user+device) is the natural key.
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },

    deviceType: { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },
    browser: { type: String, default: '' },
    platform: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    // Flipped to false the moment a push to this endpoint 410/404s (the
    // browser/OS says the subscription is gone) — never deleted outright, so
    // "this device used to receive push" stays visible in Settings/Admin.
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1, isActive: 1 });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
