import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookPlus, CheckCircle2, Globe, Info, Search } from 'lucide-react';
import { api, ApiError, fieldError, workingBranch } from '@/lib/api';
import { DDC_CLASSES, LANGUAGES } from '@/lib/format';
import { useBranches, useItemTypes, useTitle } from '@/lib/hooks';
import type { BiblioFields } from '@/lib/types';
import { TagInput } from '@/components/TagInput';
import { useToast } from '@/components/toast';
import { Alert, BookCover, Button, Card, CardHeader, ErrorMessage, Field, Input, LoadingBlock, PageHeader, Select, Textarea } from '@/components/ui';

interface FormState {
  title: string;
  subtitle: string;
  authors: string[];
  isbn: string;
  issn: string;
  publisher: string;
  publicationPlace: string;
  publicationYear: string;
  edition: string;
  physicalDescription: string;
  language: string;
  ddc: string;
  subjects: string[];
  series: string;
  summary: string;
  notes: string;
  coverUrl: string;
}

const EMPTY: FormState = {
  title: '', subtitle: '', authors: [], isbn: '', issn: '', publisher: '', publicationPlace: '', publicationYear: '', edition: '',
  physicalDescription: '', language: 'eng', ddc: '', subjects: [], series: '', summary: '', notes: '', coverUrl: '',
};

function fromBiblio(b: Partial<BiblioFields>): FormState {
  return {
    title: b.title ?? '',
    subtitle: b.subtitle ?? '',
    authors: b.authors ?? [],
    isbn: b.isbn13 ?? b.isbn10 ?? '',
    issn: b.issn ?? '',
    publisher: b.publisher ?? '',
    publicationPlace: b.publicationPlace ?? '',
    publicationYear: b.publicationYear ? String(b.publicationYear) : '',
    edition: b.edition ?? '',
    physicalDescription: b.physicalDescription ?? '',
    language: b.language ?? 'eng',
    ddc: b.ddc ?? '',
    subjects: b.subjects ?? [],
    series: b.series ?? '',
    summary: b.summary ?? '',
    notes: b.notes ?? '',
    coverUrl: b.coverUrl ?? '',
  };
}

interface LookupResponse {
  found: boolean;
  sources: string[];
  biblio: Partial<BiblioFields> | null;
  marc: unknown;
  existing: { id: string; title: string } | null;
}

/** Simplified Cutter: DDC + first three letters of the main author's surname (or title). */
function previewCallNumber(f: FormState): string {
  const source = f.authors[0] ? (f.authors[0].includes(',') ? f.authors[0].split(',')[0] : f.authors[0].trim().split(/\s+/).pop() ?? '') : f.title.replace(/^(the|a|an)\s+/i, '');
  const mark = source.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
  return [f.ddc.trim(), mark].filter(Boolean).join(' ');
}

export function BiblioEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  useTitle(isNew ? 'Add title' : 'Edit title');
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const itemTypes = useItemTypes();
  const branches = useBranches();

  const existing = useQuery({ queryKey: ['biblio', id], queryFn: () => api<BiblioFields & { id: string }>(`/catalog/biblios/${id}`), enabled: !isNew });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [marc, setMarc] = useState<unknown>(undefined);
  const [lookupIsbn, setLookupIsbn] = useState('');
  const [lookup, setLookup] = useState<{ loading: boolean; result?: LookupResponse; error?: unknown }>({ loading: false });
  const [copies, setCopies] = useState({ count: '1', itemTypeId: '', homeBranchId: '', shelfLocation: '', price: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (existing.data) setForm(fromBiblio(existing.data));
  }, [existing.data]);
  useEffect(() => {
    setCopies((c) => ({
      ...c,
      itemTypeId: c.itemTypeId || itemTypes.data?.find((t) => t.code === 'BOOK')?.id || itemTypes.data?.[0]?.id || '',
      homeBranchId: c.homeBranchId || workingBranch() || branches.data?.[0]?.id || '',
    }));
  }, [itemTypes.data, branches.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const err = (f: string) => fieldError(error, f);

  async function runLookup(e?: FormEvent) {
    e?.preventDefault();
    const isbn = lookupIsbn.trim();
    if (!isbn) return;
    setLookup({ loading: true });
    try {
      const result = await api<LookupResponse>(`/catalog/lookup/isbn/${encodeURIComponent(isbn)}`);
      setLookup({ loading: false, result });
      if (result.found && result.biblio) {
        setForm({ ...fromBiblio(result.biblio), isbn: result.biblio.isbn13 ?? isbn });
        setMarc(result.marc ?? undefined);
      } else {
        setForm((f) => ({ ...f, isbn }));
      }
    } catch (err) {
      setLookup({ loading: false, error: err });
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = { ...form, ...(marc !== undefined && isNew ? { marc } : {}) };
    try {
      if (isNew) {
        const created = await api<{ id: string; title: string }>('/catalog/biblios', { method: 'POST', body });
        const count = Number(copies.count) || 0;
        if (count > 0) {
          await api(`/catalog/biblios/${created.id}/items`, {
            method: 'POST',
            body: { count, itemTypeId: copies.itemTypeId, homeBranchId: copies.homeBranchId, shelfLocation: copies.shelfLocation, price: copies.price },
          });
        }
        toast.success(<>Added <b>{created.title}</b>{count > 0 ? ` with ${count} cop${count === 1 ? 'y' : 'ies'}` : ''}.</>);
        queryClient.invalidateQueries({ queryKey: ['catalog'] });
        navigate(`/staff/catalog/${created.id}`);
      } else {
        await api(`/catalog/biblios/${id}`, { method: 'PATCH', body });
        toast.success('Title updated.');
        queryClient.invalidateQueries({ queryKey: ['biblio', id] });
        queryClient.invalidateQueries({ queryKey: ['catalog'] });
        navigate(`/staff/catalog/${id}`);
      }
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && existing.isLoading) return <LoadingBlock />;

  const duplicate = error instanceof ApiError && error.code === 'DUPLICATE_ISBN';
  const ddcClass = DDC_CLASSES[form.ddc.trim()[0] ?? ''];

  return (
    <>
      <PageHeader
        title={isNew ? 'Add a title' : `Edit: ${existing.data?.title ?? ''}`}
        description={isNew ? 'Look the book up by ISBN to fill in the record automatically, or type the details yourself.' : undefined}
        back={isNew ? { to: '/staff/catalog', label: 'Catalog' } : { to: `/staff/catalog/${id}`, label: 'Back to title' }}
      />

      {isNew && (
        <Card className="mb-6 p-4">
          <form onSubmit={runLookup} className="flex flex-wrap items-end gap-3">
            <Field label="ISBN lookup" className="min-w-64 flex-1" hint="Searches the Library of Congress, Open Library and Google Books. Scan the barcode on the back cover.">
              <Input autoFocus className="font-mono" placeholder="978…" value={lookupIsbn} onChange={(e) => setLookupIsbn(e.target.value)} />
            </Field>
            <Button type="submit" loading={lookup.loading} className="mb-5">
              <Search className="size-4" /> Look up
            </Button>
          </form>
          {lookup.error ? <ErrorMessage error={lookup.error} /> : null}
          {lookup.result?.existing && (
            <Alert tone="amber" title="Already in the catalog">
              <Link className="underline" to={`/staff/catalog/${lookup.result.existing.id}`}>{lookup.result.existing.title}</Link> has this ISBN. Open it and add copies instead of creating a duplicate.
            </Alert>
          )}
          {lookup.result && lookup.result.found && (
            <Alert tone="green" icon={<CheckCircle2 className="size-4" />} title={`Record found (${lookup.result.sources.join(', ')})`}>
              Review the details below, then save.{lookup.result.marc ? ' The full MARC record from the Library of Congress will be kept.' : ''}
            </Alert>
          )}
          {lookup.result && !lookup.result.found && (
            <Alert tone="blue" icon={<Info className="size-4" />} title="No record found online">
              Enter the details below by hand. The ISBN has been filled in for you.
            </Alert>
          )}
        </Card>
      )}

      <form onSubmit={save} className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {error && !duplicate ? <ErrorMessage error={error} /> : null}
          {duplicate && (
            <Alert tone="amber" title="Duplicate ISBN">
              {(error as Error).message}
            </Alert>
          )}

          <Card>
            <CardHeader title="Title and authors" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Title" required error={err('title')} className="sm:col-span-2">
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} required />
              </Field>
              <Field label="Subtitle" className="sm:col-span-2">
                <Input value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
              </Field>
              <Field label="Authors" hint='Press Enter after each name. Use "Surname, Forename"; the first is the main entry.' className="sm:col-span-2">
                <TagInput value={form.authors} onChange={(v) => set('authors', v)} placeholder="e.g. Achebe, Chinua" />
              </Field>
              <Field label="Edition">
                <Input value={form.edition} onChange={(e) => set('edition', e.target.value)} placeholder="e.g. 3rd ed." />
              </Field>
              <Field label="Series">
                <Input value={form.series} onChange={(e) => set('series', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Identifiers and publication" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="ISBN" error={err('isbn')} hint="ISBN-10 or ISBN-13; the check digit is validated">
                <Input className="font-mono" value={form.isbn} onChange={(e) => set('isbn', e.target.value)} />
              </Field>
              <Field label="ISSN" hint="For serials">
                <Input className="font-mono" value={form.issn} onChange={(e) => set('issn', e.target.value)} />
              </Field>
              <Field label="Publisher">
                <Input value={form.publisher} onChange={(e) => set('publisher', e.target.value)} />
              </Field>
              <Field label="Place of publication">
                <Input value={form.publicationPlace} onChange={(e) => set('publicationPlace', e.target.value)} />
              </Field>
              <Field label="Year" error={err('publicationYear')}>
                <Input inputMode="numeric" value={form.publicationYear} onChange={(e) => set('publicationYear', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
              </Field>
              <Field label="Language">
                <Select value={form.language} onChange={(e) => set('language', e.target.value)}>
                  {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  {form.language && !LANGUAGES[form.language] && <option value={form.language}>{form.language}</option>}
                </Select>
              </Field>
              <Field label="Physical description" className="sm:col-span-2">
                <Input value={form.physicalDescription} onChange={(e) => set('physicalDescription', e.target.value)} placeholder="e.g. xii, 320 pages : illustrations ; 24 cm" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Classification and subjects" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Classification (DDC)" error={err('ddc')} hint={ddcClass ? `Class: ${ddcClass}` : 'Dewey number (e.g. 005.133), or a shelf label such as FIC, E, B or REF'}>
                <Input className="font-mono" value={form.ddc} onChange={(e) => set('ddc', e.target.value)} placeholder="005.133 or FIC" />
              </Field>
              <Field label="Call number preview" hint="Applied to new copies; can be changed per copy">
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">{previewCallNumber(form) || '—'}</div>
              </Field>
              <Field label="Subjects" hint='Press Enter after each. Subdivide with " -- ", e.g. "Nigeria -- History"' className="sm:col-span-2">
                <TagInput value={form.subjects} onChange={(v) => set('subjects', v)} placeholder="e.g. Computer programming" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Description" />
            <div className="grid gap-4 p-4">
              <Field label="Summary">
                <Textarea rows={4} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
              </Field>
              <Field label="Notes">
                <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-3 flex justify-center">
              <BookCover url={form.coverUrl} title={form.title || 'No cover'} className="h-48 w-32 shadow" />
            </div>
            <Field label="Cover image URL" error={err('coverUrl')}>
              <Input value={form.coverUrl} onChange={(e) => set('coverUrl', e.target.value)} placeholder="https://…" />
            </Field>
          </Card>

          {isNew && (
            <Card>
              <CardHeader title="Copies to add" description="Barcodes are generated automatically" />
              <div className="space-y-3 p-4">
                <Field label="Number of copies" hint="Set to 0 to add copies later">
                  <Input type="number" min={0} max={200} value={copies.count} onChange={(e) => setCopies((c) => ({ ...c, count: e.target.value }))} />
                </Field>
                <Field label="Item type">
                  <Select value={copies.itemTypeId} onChange={(e) => setCopies((c) => ({ ...c, itemTypeId: e.target.value }))}>
                    {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="Home branch">
                  <Select value={copies.homeBranchId} onChange={(e) => setCopies((c) => ({ ...c, homeBranchId: e.target.value }))}>
                    {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Shelf location">
                  <Input value={copies.shelfLocation} onChange={(e) => setCopies((c) => ({ ...c, shelfLocation: e.target.value }))} placeholder="e.g. Non-fiction" />
                </Field>
                <Field label="Price (replacement cost)">
                  <Input inputMode="decimal" value={copies.price} onChange={(e) => setCopies((c) => ({ ...c, price: e.target.value }))} />
                </Field>
              </div>
            </Card>
          )}

          <div className="sticky top-4 flex flex-col gap-2">
            <Button type="submit" loading={saving} className="w-full">
              {isNew ? <><BookPlus className="size-4" /> Save title</> : 'Save changes'}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => navigate(isNew ? '/staff/catalog' : `/staff/catalog/${id}`)}>
              Cancel
            </Button>
            {isNew && (
              <p className="flex items-start gap-1.5 text-xs text-slate-500">
                <Globe className="mt-0.5 size-3.5 shrink-0" /> A MARC 21 record is generated from these fields and can be exported at any time.
              </p>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
