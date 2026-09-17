import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Folder, FolderPlus, Inbox, Pencil, Search, Trash2 } from 'lucide-react';
import { bookmarkApi } from '../api/endpoints.js';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { useToast } from '../context/ToastContext.jsx';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';

// The reserved name of the built-in bucket — bookmarks that have not been filed
// yet. It is not a folder document (see the server's BookmarkFolder model), so
// every bookmark ever saved already lives somewhere without a migration.
const DEFAULT_FOLDER = 'default';

export default function Bookmarks() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const download = useDownloadFile();

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('all');
  const [fileType, setFileType] = useState('');

  // Search runs on the server (typo-tolerant, the same engine the Question Bank
  // uses), so typing must not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data: folderData } = useQuery({
    queryKey: ['bookmark-folders'],
    queryFn: bookmarkApi.folders,
  });
  const folders = folderData?.data?.folders || [];
  const defaultCount = folderData?.data?.defaultCount || 0;
  const total = folderData?.data?.total || 0;

  const { data, isLoading } = useQuery({
    queryKey: ['my-bookmarks', folder, search],
    queryFn: () => bookmarkApi.list({ folder, q: search || undefined }),
    // Keep the previous page's cards on screen while the next search resolves,
    // instead of collapsing to a skeleton on every keystroke.
    placeholderData: (previous) => previous,
  });

  const files = data?.data || [];
  const suggestion = data?.suggestion || null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-bookmarks'] });
    qc.invalidateQueries({ queryKey: ['my-bookmark-ids'] });
    qc.invalidateQueries({ queryKey: ['bookmark-folders'] });
  };

  const move = useMutation({
    mutationFn: ({ fileId, folderId }) => bookmarkApi.move(fileId, folderId),
    onSuccess: (res) => {
      toast(res?.message || 'Bookmark moved', 'success');
      invalidate();
    },
    onError: (err) => toast(err.response?.data?.message || 'Could not move the bookmark', 'error'),
  });

  const createFolder = async () => {
    const name = window.prompt('Name this folder');
    if (name === null) return;
    if (!name.trim()) return toast('A folder name is required', 'error');
    try {
      await bookmarkApi.createFolder(name.trim());
      toast('Folder created', 'success');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not create the folder', 'error');
    }
  };

  const renameFolder = async (target) => {
    const name = window.prompt('Rename folder', target.name);
    if (name === null || !name.trim() || name.trim() === target.name) return;
    try {
      await bookmarkApi.renameFolder(target._id, name.trim());
      toast('Folder renamed', 'success');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not rename the folder', 'error');
    }
  };

  const removeFolder = async (target) => {
    if (!window.confirm(`Delete "${target.name}"? Its bookmarks move back to the default folder.`)) return;
    try {
      const res = await bookmarkApi.removeFolder(target._id);
      toast(res?.message || 'Folder deleted', 'success');
      if (folder === target._id) setFolder('all');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not delete the folder', 'error');
    }
  };

  const fileTypes = useMemo(() => [...new Set(files.map((f) => f.fileType))], [files]);

  // The type filter stays client-side: it refines whatever the folder + search
  // combination already returned, with no second round trip.
  const shown = useMemo(
    () => (fileType ? files.filter((f) => f.fileType === fileType) : files),
    [files, fileType]
  );

  const activeFolderName =
    folder === 'all'
      ? 'All bookmarks'
      : folder === DEFAULT_FOLDER
        ? 'Default folder'
        : folders.find((f) => f._id === folder)?.name || 'Folder';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">My Bookmarks</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-64 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">Folders</h2>
            <button
              onClick={createFolder}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              <FolderPlus size={14} /> New folder
            </button>
          </div>

          <nav className="space-y-1">
            <FolderRow
              icon={Bookmark}
              label="All bookmarks"
              count={total}
              active={folder === 'all'}
              onSelect={() => setFolder('all')}
            />
            <FolderRow
              icon={Inbox}
              label="Default folder"
              count={defaultCount}
              active={folder === DEFAULT_FOLDER}
              onSelect={() => setFolder(DEFAULT_FOLDER)}
            />
            {folders.map((f) => (
              <FolderRow
                key={f._id}
                icon={Folder}
                label={f.name}
                count={f.fileCount}
                active={folder === f._id}
                onSelect={() => setFolder(f._id)}
                onRename={() => renameFolder(f)}
                onDelete={() => removeFolder(f)}
              />
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search in ${activeFolderName.toLowerCase()}...`}
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            {fileTypes.length > 1 && (
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              >
                <option value="">All Types</option>
                {fileTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>

          {suggestion && (
            <p className="text-sm text-slate-500 mb-4">
              Did you mean{' '}
              <button
                onClick={() => setQ(suggestion)}
                className="font-semibold text-brand-600 hover:text-brand-700 underline"
              >
                {suggestion}
              </button>
              ?
            </p>
          )}

          {isLoading ? (
            <FileGridSkeleton />
          ) : shown.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {shown.map((f) => (
                <FileCard
                  key={f._id}
                  file={f}
                  onDownload={download}
                  folderControl={
                    <label className="flex items-center gap-2 text-xs text-slate-500">
                      <Folder size={13} className="shrink-0" />
                      <select
                        value={f.folder || DEFAULT_FOLDER}
                        onChange={(e) =>
                          move.mutate({ fileId: f._id, folderId: e.target.value })
                        }
                        className="h-8 flex-1 min-w-0 rounded-lg border border-slate-300 px-2 text-xs"
                        title="Move this bookmark to a folder"
                      >
                        <option value={DEFAULT_FOLDER}>Default folder</option>
                        {folders.map((folderOption) => (
                          <option key={folderOption._id} value={folderOption._id}>
                            {folderOption.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  }
                />
              ))}
            </div>
          ) : search ? (
            <EmptyState
              title="No bookmarks match"
              description="Try a different word, or clear the search to see everything in this folder."
            />
          ) : (
            <EmptyState
              title={folder === 'all' ? 'No bookmarks yet' : 'Nothing in this folder yet'}
              description={
                folder === 'all'
                  ? 'Files you bookmark will show up here, in the default folder. You can create folders and move them around afterwards.'
                  : 'Use the folder picker on a bookmark to file it here.'
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FolderRow({ icon: Icon, label, count, active, onSelect, onRename, onDelete }) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg ${
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-left">
        <Icon size={15} className="shrink-0" />
        <span className="truncate flex-1">{label}</span>
        <span className="text-xs text-slate-400">{count}</span>
      </button>
      {onRename && (
        <div className="flex items-center pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button onClick={onRename} title="Rename folder" className="p-1 text-slate-400 hover:text-slate-700">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} title="Delete folder" className="p-1 text-slate-400 hover:text-red-600">
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
