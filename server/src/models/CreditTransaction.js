import mongoose from 'mongoose';

// The credit audit trail. Every balance change writes one of these — a monthly
// recharge, a generation, a refund of a failed generation, or an admin
// adjustment — so a balance can always be explained after the fact.
//
// A generation is reserved, then confirmed or released. The PENDING row is what
// makes a failed AI call refundable and a reservation idempotent.

export const CREDIT_TRANSACTION_TYPES = [
  'MONTHLY_RECHARGE',
  'AI_GENERATION',
  'AI_EDIT',
  'ADMIN_ADJUSTMENT',
  'REFUND',
];

export const CREDIT_TRANSACTION_STATUSES = ['PENDING', 'CONFIRMED', 'RELEASED'];

const creditTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: CREDIT_TRANSACTION_TYPES, required: true },
    status: { type: String, enum: CREDIT_TRANSACTION_STATUSES, default: 'CONFIRMED' },
    // Signed: negative for a spend, positive for a recharge/adjustment/refund.
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    // A unique idempotency key for a reservation, so a retry can never reserve
    // the same credit twice. Sparse: only reservation rows carry one.
    reservationId: { type: String, default: null },
    // What the spend was for — an application id, or the admin who adjusted.
    referenceId: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ reservationId: 1 }, { unique: true, sparse: true });

export default mongoose.model('CreditTransaction', creditTransactionSchema);
