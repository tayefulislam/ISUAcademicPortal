import { useQuery, useInfiniteQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { notificationApi } from '../api/endpoints.js';

// No WebSockets exist anywhere in this app — polling on an interval is the
// established real-time-ish pattern here, so the unread badge does the same.
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationApi.unreadCount().then((r) => r.data.count),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationList(unreadOnly = false) {
  return useInfiniteQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: ({ pageParam = 1 }) => notificationApi.list({ page: pageParam, limit: 20, unreadOnly: unreadOnly || undefined }),
    getNextPageParam: (lastPage) => (lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined),
    initialPageParam: 1,
  });
}

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({ mutationFn: (id) => notificationApi.markRead(id), onSuccess: invalidate });
  const markAllRead = useMutation({ mutationFn: () => notificationApi.markAllRead(), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id) => notificationApi.remove(id), onSuccess: invalidate });

  return { markRead, markAllRead, remove };
}
