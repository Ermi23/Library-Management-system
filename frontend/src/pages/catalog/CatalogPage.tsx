import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BookOpen, FileUp, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { DDC_CLASSES } from '@/lib/format';
import { useBranches, useItemTypes, useTitle } from '@/lib/hooks';
import type { BiblioSummary, Paged } from '@/lib/types';
import { Badge, BookCover, Button, Card, Checkbox, Input, PageHeader, Pagination, QueryState, Select } from '@/components/ui';

const FIELDS = [
  ['all', 'Keyword'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['isbn', 'ISBN / ISSN'],
  ['ddc', 'DDC number'],
  ['series', 'Series'],
  ['publisher', 'Publisher'],
  ['barcode', 'Item barcode'],
] as const;

export function AvailabilityBadge({ a }: { a: BiblioSummary['availability'] }) {
  if (!a.total) return <Badge>No copies</Badge>;
  return <Badge tone={a.available ? 'green' : 'amber'}>{a.available} of {a.total} available</Badge>;
}

export function CatalogPage() {
  useTitle('Catalog');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const itemTypes = useItemTypes();
  const branches = useBranches();
  const [draft, setDraft] = useState(params.get('q') ?? '');

  const query = {
    q: params.get('q') ?? '',
    field: params.get('field') ?? 'all',
    itemTypeId: params.get('itemTypeId') ?? '',
    branchId: params.get('branchId') ?? '',
    available: params.get('available') ?? '',
    ddcClass: params.get('ddcClass') ?? '',
    sort: params.get('sort') ?? (params.get('q') ? 'relevance' : 'newest'),
    page: Number(params.get('page') ?? 1),
  };
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const next: Record<string, string> = { ...Object.fromEntries(p), page: '1', ...patch };
      for (const k of Object.keys(next)) if (!next[k]) delete next[k];
      return next;
    });

  const results = useQuery({
    queryKey: ['catalog', query],
    queryFn: () => api<Paged<BiblioSummary>>('/catalog/biblios', { query: { ...query, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Search titles and copies. Scan a barcode or ISBN straight into the search box."
        actions={
          <>
            <Link to="/staff/import"><Button variant="secondary"><FileUp className="size-4" /> Import MARC</Button></Link>
            <Link to="/staff/catalog/new"><Button><Plus className="size-4" /> Add title</Button></Link>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: draft.trim(), sort: draft.trim() ? 'relevance' : 'newest' });
          }}
        >
          <Select className="w-40" value={query.field} onChange={(e) => set({ field: e.target.value })} aria-label="Search in">
            {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input autoFocus className="pl-9" placeholder="Title, author, subject, ISBN, call number or barcode" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select className="w-auto" value={query.itemTypeId} onChange={(e) => set({ itemTypeId: e.target.value })} aria-label="Item type">
            <option value="">All item types</option>
            {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select className="w-auto" value={query.branchId} onChange={(e) => set({ branchId: e.target.value })} aria-label="Branch">
            <option value="">All branches</option>
            {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select className="w-auto" value={query.ddcClass} onChange={(e) => set({ ddcClass: e.target.value })} aria-label="DDC class">
            <option value="">All DDC classes</option>
            {Object.entries(DDC_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select className="w-auto" value={query.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
            <option value="relevance">Relevance</option>
            <option value="newest">Recently added</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
            <option value="year_desc">Newest publication</option>
            <option value="year_asc">Oldest publication</option>
          </Select>
          <Checkbox label="Available now" checked={query.available === 'true'} onChange={(v) => set({ available: v ? 'true' : '' })} />
        </div>
      </Card>

      <Card>
        <QueryState
          query={results}
          empty={{
            when: !results.data?.data.length,
            icon: <BookOpen className="size-10" />,
            title: query.q ? 'No titles match your search' : 'The catalog is empty',
            description: query.q ? 'Try fewer words, another field, or check the spelling.' : 'Add your first title, or import MARC records.',
            action: <Button onClick={() => navigate('/staff/catalog/new')}><Plus className="size-4" /> Add title</Button>,
          }}
        >
          <ul className="divide-y divide-slate-100">
            {results.data?.data.map((b) => (
              <li key={b.id}>
                <Link to={`/staff/catalog/${b.id}`} className="flex gap-4 px-4 py-3 hover:bg-slate-50">
                  <BookCover url={b.coverUrl} title={b.title} className="h-20 w-14" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">
                      {b.title}
                      {b.subtitle && <span className="font-normal text-slate-600">: {b.subtitle}</span>}
                    </div>
                    <div className="text-sm text-slate-600">{b.authors.join('; ') || '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[b.publisher, b.publicationYear, b.edition, b.isbn13 && `ISBN ${b.isbn13}`].filter(Boolean).join(' · ')}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <AvailabilityBadge a={b.availability} />
                      {b.availability.callNumber && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{b.availability.callNumber}</span>}
                      {b.availability.itemTypes.map((t) => <Badge key={t}>{t}</Badge>)}
                      {b.activeHolds > 0 && <Badge tone="purple">{b.activeHolds} hold{b.activeHolds === 1 ? '' : 's'}</Badge>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {results.data && <Pagination page={results.data.page} totalPages={results.data.totalPages} total={results.data.total} onChange={(p) => set({ page: String(p) })} />}
        </QueryState>
      </Card>
    </>
  );
}
