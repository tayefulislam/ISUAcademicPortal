import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import SearchBar from '../components/SearchBar.jsx';
import SearchFilters from '../components/SearchFilters.jsx';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Pagination from '../components/Pagination.jsx';
import { searchApi } from '../api/endpoints.js';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { trackEvent } from '../utils/analytics.js';

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const download = useDownloadFile();

  const [q, setQ] = useState(params.get('q') || '');
  const debouncedQ = useDebouncedValue(q, 400);

  const filters = {
    department: params.get('department') || '',
    course: params.get('course') || '',
    batch: params.get('batch') || '',
    fileType: params.get('fileType') || '',
    category: params.get('category') || '',
    chapter: params.get('chapter') || '',
    topic: params.get('topic') || '',
    semester: params.get('semester') || '',
    academicYear: params.get('academicYear') || '',
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
  };
  const page = Number(params.get('page')) || 1;
  const sort = params.get('sort') || 'newest';

  const updateParams = (next) => {
    const merged = { ...filters, ...next, q: 'q' in next ? next.q : debouncedQ, page: next.page || 1, sort: next.sort || sort };
    const sp = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    setParams(sp);
  };

  useEffect(() => {
    if (debouncedQ !== (params.get('q') || '')) {
      updateParams({ q: debouncedQ, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const queryParams = useMemo(
    () => ({ q: params.get('q') || undefined, ...filters, page, limit: 12, sort }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString()]
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', queryParams],
    queryFn: () => searchApi.search(queryParams),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (queryParams.q) {
      trackEvent('search', { search_term: queryParams.q, ...filters });
    } else if (Object.values(filters).some(Boolean)) {
      trackEvent('filter_used', filters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const clearFilters = () => {
    const sp = new URLSearchParams();
    if (params.get('q')) sp.set('q', params.get('q'));
    setParams(sp);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Browse & Search Files</h1>

      <div className="mb-4">
        <SearchBar initialValue={q} size="md" onSubmit={(val) => { setQ(val); updateParams({ q: val, page: 1 }); }} />
      </div>

      <div className="mb-6">
        <SearchFilters filters={filters} onChange={(next) => updateParams({ ...next, page: 1 })} onClear={clearFilters} />
      </div>

      {data?.suggestion && data.suggestion !== (queryParams.q || '').trim().toLowerCase() && (
        <button
          type="button"
          onClick={() => { setQ(data.suggestion); updateParams({ q: data.suggestion, page: 1 }); }}
          className="flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-3 hover:bg-brand-100"
        >
          <Search size={12} /> Did you mean <strong>"{data.suggestion}"</strong>?
        </button>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {isFetching ? 'Searching...' : `${data?.pagination?.total ?? 0} file(s) found`}
        </p>
        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}
          className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="popular">Most viewed</option>
          <option value="downloads">Most downloaded</option>
          <option value="name">Name (A-Z)</option>
        </select>
      </div>

      {isLoading ? (
        <FileGridSkeleton />
      ) : data?.data?.length ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.data.map((f) => (
              <FileCard key={f._id} file={f} onDownload={download} />
            ))}
          </div>
          <Pagination page={page} pages={data.pagination.pages} onChange={(p) => updateParams({ page: p })} />
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
