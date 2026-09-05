import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  },
  { timestamps: true }
);

// A user can bookmark a given file only once.
bookmarkSchema.index({ user: 1, file: 1 }, { unique: true });

export default mongoose.model('Bookmark', bookmarkSchema);
