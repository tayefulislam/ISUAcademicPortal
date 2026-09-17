import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    // null = the built-in default folder. Every bookmarking path writes null
    // unless the caller names a folder, so "save it now, file it later" needs no
    // extra step and bookmarks predating folders land in the default bucket.
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'BookmarkFolder', default: null },
  },
  { timestamps: true }
);

// A user can bookmark a given file only once.
bookmarkSchema.index({ user: 1, file: 1 }, { unique: true });
// Listing/filtering one folder.
bookmarkSchema.index({ user: 1, folder: 1 });

export default mongoose.model('Bookmark', bookmarkSchema);
