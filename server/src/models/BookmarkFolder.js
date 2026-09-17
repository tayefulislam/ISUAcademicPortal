import mongoose from 'mongoose';

// A user-created folder inside their own bookmarks ("Semester 3", "Exam prep").
// There is deliberately no "default" folder document: a bookmark with no folder
// is in the default bucket, which is what keeps every existing bookmark (and
// every existing bookmarking code path) working without a migration.
const bookmarkFolderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Lowercased/trimmed copy of `name`. MongoDB can only enforce uniqueness on
    // a stored field, not on a case-folded expression, so this is what stops one
    // user having both "Semester 1" and "semester 1".
    nameKey: { type: String, required: true },
  },
  { timestamps: true }
);

bookmarkFolderSchema.index({ user: 1, nameKey: 1 }, { unique: true });

bookmarkFolderSchema.pre('validate', function syncNameKey(next) {
  this.nameKey = String(this.name || '').trim().toLowerCase();
  next();
});

export default mongoose.model('BookmarkFolder', bookmarkFolderSchema);
