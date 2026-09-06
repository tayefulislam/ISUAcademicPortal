import mongoose from 'mongoose';

// Singleton document (one row, key: 'global') holding system-wide toggles
// managed by Super Admin. Accessed only through getSettings/updateSettings
// below so callers never have to think about the upsert/singleton dance.
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    studentApprovalEnabled: { type: Boolean, default: false },
    // Independent of studentApprovalEnabled — that one gates registration,
    // this one gates whether students can submit materials at all.
    studentUploadEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Settings = mongoose.model('Settings', settingsSchema);

export async function getSettings() {
  return Settings.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, new: true });
}

export async function updateSettings(patch) {
  return Settings.findOneAndUpdate({ key: 'global' }, { $set: patch }, { upsert: true, new: true });
}

export default Settings;
