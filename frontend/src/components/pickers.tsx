import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, User as UserIcon, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import type { BiblioSummary, Paged, User } from '@/lib/types';
import { cn, fieldClass, Spinner } from './ui';

interface PickerProps<T> {
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

function usePicker<T>(key: string, fetcher: (q: string) => Promise<T[]>) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const results = useQuery({
    queryKey: ['picker', key, debounced],
    queryFn: () => fetcher(debounced),
    enabled: open && debounced.trim().length > 0,
  });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return { q, setQ, open, setOpen, results, box, debounced };
}

function Selected({ icon, title, subtitle, onClear }: { icon: React.ReactNode; title: string; subtitle?: string | null; onClear: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
      <div className="text-brand-600">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-900">{title}</div>
        {subtitle && <div className="truncate text-xs text-slate-500">{subtitle}</div>}
      </div>
      <button type="button" onClick={onClear} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" aria-label="Clear selection">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function PatronPicker({ value, onChange, placeholder = 'Search patrons by name, card number, email or phone', autoFocus }: PickerProps<User>) {
  const p = usePicker('patron', (q) => api<Paged<User>>('/users', { query: { q, role: 'PATRON', pageSize: 8 } }).then((r) => r.data));
  if (value) {
    return (
      <Selected
        icon={<UserIcon className="size-4" />}
        title={`${value.firstName} ${value.lastName}`}
        subtitle={[value.cardNumber, value.email].filter(Boolean).join(' · ')}
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <PickerShell p={p} placeholder={placeholder} autoFocus={autoFocus}>
      {p.results.data?.map((u) => (
        <PickerOption key={u.id} onSelect={() => { onChange(u); p.setOpen(false); p.setQ(''); }}>
          <div className="font-medium text-slate-900">{u.lastName}, {u.firstName}</div>
          <div className="text-xs text-slate-500">{[u.cardNumber, u.email, u.patronCategory?.name].filter(Boolean).join(' · ')}</div>
        </PickerOption>
      ))}
    </PickerShell>
  );
}

export function BiblioPicker({ value, onChange, placeholder = 'Search the catalog by title, author or ISBN', autoFocus }: PickerProps<BiblioSummary>) {
  const p = usePicker('biblio', (q) => api<Paged<BiblioSummary>>('/catalog/biblios', { query: { q, pageSize: 8 } }).then((r) => r.data));
  if (value) {
    return (
      <Selected
        icon={<BookOpen className="size-4" />}
        title={value.title}
        subtitle={[value.authors[0], value.publicationYear, value.isbn13].filter(Boolean).join(' · ')}
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <PickerShell p={p} placeholder={placeholder} autoFocus={autoFocus}>
      {p.results.data?.map((b) => (
        <PickerOption key={b.id} onSelect={() => { onChange(b); p.setOpen(false); p.setQ(''); }}>
          <div className="font-medium text-slate-900">{b.title}</div>
          <div className="text-xs text-slate-500">{[b.authors.join('; '), b.publicationYear, b.isbn13].filter(Boolean).join(' · ')}</div>
        </PickerOption>
      ))}
    </PickerShell>
  );
}

function PickerShell({
  p,
  placeholder,
  autoFocus,
  children,
}: {
  p: ReturnType<typeof usePicker<unknown>>;
  placeholder: string;
  autoFocus?: boolean;
  children: React.ReactNode;
}) {
  const hasResults = Array.isArray(p.results.data) && p.results.data.length > 0;
  return (
    <div ref={p.box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        className={cn(fieldClass, 'pl-9')}
        value={p.q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => p.setOpen(true)}
        onChange={(e) => {
          p.setQ(e.target.value);
          p.setOpen(true);
        }}
      />
      {p.open && p.debounced.trim() && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {p.results.isFetching && !hasResults ? (
            <div className="flex justify-center p-3">
              <Spinner className="size-4" />
            </div>
          ) : hasResults ? (
            children
          ) : (
            <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

function PickerOption({ onSelect, children }: { onSelect: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onSelect} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
      {children}
    </button>
  );
}
