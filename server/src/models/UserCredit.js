import mongoose from 'mongoose';

// One credit account per user — the single source of truth for how many AI
// generations they have left. Both the web and the Android clients only ever
// READ this through the API; neither computes a balance of its own.

const userCreditSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    monthlyAllocation: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0, min: 0 },
    usedThisPeriod: { type: Number, default: 0, min: 0 },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    lastRechargeAt: { type: Date, default: null },
    // When the next monthly recharge is due — the sweep matches on this, and the
    // compare-and-set that performs it guards on it, so two runs cannot both pay.
    nextRechargeAt: { type: Date, default: null },
    rolloverEnabled: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true }
);

userCreditSchema.index({ nextRechargeAt: 1 });

export default mongoose.model('UserCredit', userCreditSchema);
