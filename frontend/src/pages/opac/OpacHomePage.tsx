import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { DDC_CLASSES } from '@/lib/format';
import { usePublicSettings, useTitle } from '@/lib/hooks';
import { BookCover, Button, Input } from '@/components/ui';

export function OpacHomePage() {
  const settings = usePublicSettings();
  useTitle(settings.data?.libraryName ?? 'Catalog');
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const latest = useQuery({
    queryKey: ['opac', 'new'],
    queryFn: () => api<{ id: string; title: string; authors: string[]; coverUrl: string | null; publicationYear: number | null }[]>('/opac/new'),
  });

  return (
    <>
      <section className="bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-16 text-center text-white sm:py-20">
        <h1 className="text-3xl font-semibold sm:text-4xl">Find your next book</h1>
        <p className="mt-2 text-brand-100">Search by title, author, subject, ISBN or call number, see what is on the shelf, and reserve it.</p>
        <form
          className="mx-auto mt-8 flex max-w-2xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <Input autoFocus className="h-12 pl-10 text-base text-slate-900" placeholder="e.g. Things Fall Apart, Achebe, programming" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <Button type="submit" className="h-12 px-6">Search</Button>
        </form>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">New in the library</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {latest.data?.map((b) => (
            <Link key={b.id} to={`/record/${b.id}`} className="group">
              <BookCover url={b.coverUrl} title={b.title} className="aspect-[2/3] w-full shadow-sm transition-shadow group-hover:shadow-md" />
              <div className="mt-2 line-clamp-2 text-sm font-medium text-slate-900 group-hover:text-brand-700">{b.title}</div>
              <div className="truncate text-xs text-slate-500">{b.authors[0]}</div>
            </Link>
          ))}
        </div>

        <h2 className="mb-4 mt-12 text-lg font-semibold text-slate-900">Browse by subject (Dewey Decimal)</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(DDC_CLASSES).map(([k, label]) => (
            <Link key={k} to={`/search?ddcClass=${k}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
