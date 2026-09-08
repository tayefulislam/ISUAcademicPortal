import mongoose from 'mongoose';

// Always exactly 2 participants. `pairKey` is the two participant ids
// sorted and joined (set by the controller before every write) — a plain
// unique index on an array field would enforce per-element uniqueness, not
// whole-pair uniqueness, so the pair is collapsed into this single scalar
// field purely so the index can prevent duplicate conversations for the
// same two users.
const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      validate: {
        validator: (arr) => arr.length === 2,
        message: 'A conversation must have exactly 2 participants',
      },
    },
    pairKey: { type: String, required: true, unique: true },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessageText: { type: String, default: '' },
    lastMessageSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Conversation', conversationSchema);
