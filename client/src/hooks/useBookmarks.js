import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bookmarkApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

// A single shared query backs every heart icon on the page — one request
// gets the full set of bookmarked file ids, rather than one request per card.
export function useBookmarkedIds() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['my-bookmark-ids'],
    queryFn: bookmarkApi.list,
    enabled: !!user,
    select: (res) => new Set(res.data.map((f) => f._id)),
  });
  return data || new Set();
}

export function useToggleBookmark() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const bookmarkedIds = useBookmarkedIds();

  return async (file) => {
    if (!user) {
      toast('Sign in to bookmark files', 'info');
      return;
    }
    const isBookmarked = bookmarkedIds.has(file._id);
    try {
      if (isBookmarked) {
        await bookmarkApi.remove(file._id);
        toast('Removed from bookmarks', 'success');
      } else {
        await bookmarkApi.add(file._id);
        // Name the destination: the bookmark lands in the default folder of the
        // Bookmarks page, where it can then be filed into a folder.
        toast('Saved to your bookmarks', 'success');
      }
      qc.invalidateQueries({ queryKey: ['my-bookmark-ids'] });
      qc.invalidateQueries({ queryKey: ['my-bookmarks'] });
      qc.invalidateQueries({ queryKey: ['bookmark-folders'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update bookmark', 'error');
    }
  };
}
