import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { DDC_CLASSES, LANGUAGES } from '@/lib/format';
import { useTitle } from '@/lib/hooks';
import type { BiblioSummary, Paged } from '@/lib/types';
import { Badge, BookCover, Checkbox, EmptyState, LoadingBlock, Pagination, Select } from '@/components/ui';

export function OpacSearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  useTitle(q ? `Search: ${q}` : 'Search');
  const query = {
    q,
    field: params.get('field') ?? 'all',
    itemTypeId: params.get('itemTypeId') ?? '',
    branchId: params.get('branchId') ?? '',
    language: params.get('language') ?? '',
    ddcClass: params.get('ddcClass') ?? '',
    available: params.get('available') ?? '',
    sort: params.get('sort') ?? 'relevance',
    page: Number(params.get('page') ?? 1),
  };
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const next: Record<string, string> = { ...Object.fromEntries(p), page: '1', ...patch };
      for (const k of Object.keys(next)) if (!next[k]) delete next[k];
      return next;
    });

  const facets = useQuery({
    queryKey: ['opac', 'facets'],
    queryFn: () => api<{ itemTypes: { id: string; name: string }[]; branches: { id: string; name: string }[]; languages: string[] }>('/opac/facets'),
    staleTime: 5 * 60_000,
  });
  const results = useQuery({
    queryKey: ['opac', 'search', query],
    queryFn: () => api<Paged<BiblioSummary>>('/opac/search', { query: { ...query, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4 text-sm">
        <div>
          <div className="mb-1 font-medium text-slate-700">Search in</div>
          <Select value={query.field} onChange={(e) => set({ field: e.target.value })}>
            <option value="all">Everything</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="subject">Subject</option>
            <option value="isbn">ISBN / ISSN</option>
            <option value="series">Series</option>
          </Select>
        </div>
        <Checkbox label="Available now" checked={query.available === 'true'} onChange={(v) => set({ available: v ? 'true' : '' })} />
        <div>
          <div className="mb-1 font-medium text-slate-700">Library</div>
          <Select value={query.branchId} onChange={(e) => set({ branchId: e.target.value })}>
            <option value="">All branches</option>
            {facets.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Format</div>
          <Select value={query.itemTypeId} onChange={(e) => set({ itemTypeId: e.target.value })}>
            <option value="">All formats</option>
            {facets.data?.itemTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Subject area</div>
          <Select value={query.ddcClass} onChange={(e) => set({ ddcClass: e.target.value })}>
            <option value="">All subjects</option>
            {Object.entries(DDC_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Language</div>
          <Select value={query.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="">Any language</option>
            {facets.data?.languages.map((l) => <option key={l} value={l}>{LANGUAGES[l] ?? l}</option>)}
          </Select>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {results.data ? `${results.data.total} result${results.data.total === 1 ? '' : 's'}` : 'Searching…'}
            {q && <span className="font-normal text-slate-500"> for “{q}”</span>}
          </h1>
          <Select className="w-auto" value={query.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
            <option value="relevance">Best match</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
            <option value="year_desc">Newest first</option>
            <option value="year_asc">Oldest first</option>
          </Select>
        </div>
        {results.isLoading ? (
          <LoadingBlock />
        ) : !results.data?.data.length ? (
          <div className="rounded-xl border border-slate-200 bg-white">
            <EmptyState icon={<BookOpen className="size-10" />} title="Nothing found" description="Check the spelling, try fewer words, or search everything instead of one field." />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {results.data.data.map((b) => (
                <li key={b.id}>
                  <Link to={`/record/${b.id}`} className="flex gap-4 p-4 hover:bg-slate-50">
                    <BookCover url={b.coverUrl} title={b.title} className="h-24 w-16" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-brand-800">{b.title}{b.subtitle && <span className="font-normal text-slate-600">: {b.subtitle}</span>}</div>
                      <div className="text-sm text-slate-600">{b.authors.join('; ')}</div>
                      <div className="text-xs text-slate-500">{[b.publisher, b.publicationYear, b.edition].filter(Boolean).join(' · ')}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {b.availability.total ? (
                          <Badge tone={b.availability.available ? 'green' : 'amber'}>
                            {b.availability.available ? `Available (${b.availability.available} of ${b.availability.total})` : 'All copies on loan'}
                          </Badge>
                        ) : (
                          <Badge>No copies</Badge>
                        )}
                        {b.availability.callNumber && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">{b.availability.callNumber}</span>}
                        {b.availability.branches.filter((br) => br.available).map((br) => <span key={br.id} className="text-slate-500">{br.name}</span>)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={results.data.page} totalPages={results.data.totalPages} onChange={(p) => set({ page: String(p) })} />
          </div>
        )}
      </section>
    </div>
  );
}
