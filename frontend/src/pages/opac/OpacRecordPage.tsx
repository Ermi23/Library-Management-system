import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { DDC_CLASSES, formatDate, ITEM_STATUS, LANGUAGES } from '@/lib/format';
import { usePublicSettings, useTitle } from '@/lib/hooks';
import type { Availability, BiblioFields, ItemStatus } from '@/lib/types';
import { Alert, Badge, BookCover, Button, Card, DescriptionList, ErrorMessage, Field, LoadingBlock, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

interface OpacRecord extends BiblioFields {
  id: string;
  activeHolds: number;
  myHold: { id: string; status: string } | null;
  availability: Availability;
  items: { id: string; status: ItemStatus; callNumber: string | null; shelfLocation: string | null; enumeration: string | null; dueAt: string | null; itemType: { name: string; notForLoan: boolean }; currentBranch: { id: string; name: string } }[];
}

/** Patron-facing status: hides internal states like "in processing". */
function publicStatus(status: ItemStatus, notForLoan: boolean, dueAt: string | null) {
  if (status === 'AVAILABLE') return notForLoan ? { label: 'Library use only', tone: 'blue' as const } : { label: 'Available', tone: 'green' as const };
  if (status === 'ON_LOAN') return { label: dueAt ? `On loan, due ${formatDate(dueAt)}` : 'On loan', tone: 'amber' as const };
  if (status === 'ON_HOLD_SHELF') return { label: 'Reserved for a patron', tone: 'amber' as const };
  if (status === 'IN_TRANSIT') return { label: 'In transit', tone: 'amber' as const };
  if (status === 'IN_PROCESSING') return { label: 'Being prepared', tone: 'gray' as const };
  return { label: ITEM_STATUS[status].label, tone: 'red' as const };
}

export function OpacRecordPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const queryClient = useQueryClient();
  const record = useQuery({ queryKey: ['opac', 'record', id, user?.id], queryFn: () => api<OpacRecord>(`/opac/biblios/${id}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>('/branches') });
  const [pickup, setPickup] = useState('');
  useTitle(record.data?.title ?? 'Record');

  const hold = useMutation({
    mutationFn: () => api<{ position: number }>('/opac/holds', { method: 'POST', body: { biblioId: id, pickupBranchId: pickup || user?.homeBranch?.id || branches.data?.[0]?.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opac', 'record', id] }),
  });

  if (record.isLoading) return <LoadingBlock />;
  if (!record.data) return <div className="mx-auto max-w-4xl p-6"><ErrorMessage error={record.error} /></div>;
  const b = record.data;
  const canHold = settings.data?.allowOpacHolds && b.items.some((i) => !i.itemType.notForLoan);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-800">← Back</button>
      <div className="mt-4 grid gap-8 md:grid-cols-[200px_1fr]">
        <BookCover url={b.coverUrl} title={b.title} className="aspect-[2/3] w-40 shadow md:w-full" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">{b.title}</h1>
          {b.subtitle && <p className="text-lg text-slate-600">{b.subtitle}</p>}
          <p className="mt-1 text-slate-700">
            {b.authors.map((a, i) => (
              <span key={a}>
                {i > 0 && '; '}
                <Link to={`/search?field=author&q=${encodeURIComponent(a)}`} className="text-brand-700 hover:underline">{a}</Link>
              </span>
            ))}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={b.availability.available ? 'green' : 'amber'}>{b.availability.available} of {b.availability.total} available</Badge>
            {b.availability.callNumber && <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">Call number {b.availability.callNumber}</span>}
            {b.activeHolds > 0 && <Badge>{b.activeHolds} waiting</Badge>}
          </div>

          <Card className="mt-6 p-4">
            {hold.isSuccess ? (
              <Alert tone="green" icon={<CheckCircle2 className="size-4" />} title="Hold placed">
                You are number {hold.data.position} in the queue. We will notify you when it is ready to collect. <Link to="/account" className="underline">View your holds</Link>.
              </Alert>
            ) : b.myHold ? (
              <Alert tone="green" icon={<CheckCircle2 className="size-4" />} title="You have reserved this title">
                Status: {b.myHold.status.replace('_', ' ').toLowerCase()}. <Link to="/account" className="underline">View your holds</Link>.
              </Alert>
            ) : !canHold ? (
              <p className="text-sm text-slate-500">This title cannot be reserved online.</p>
            ) : user ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Pick up at" className="w-56">
                  <Select value={pickup || user.homeBranch?.id || ''} onChange={(e) => setPickup(e.target.value)}>
                    {branches.data?.filter((br) => br.isActive).map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
                  </Select>
                </Field>
                <Button className="mb-0" loading={hold.isPending} onClick={() => hold.mutate()}><Bookmark className="size-4" /> Place hold</Button>
                {hold.error ? <ErrorMessage error={hold.error} className="w-full" /> : null}
              </div>
            ) : (
              <p className="text-sm">
                <Link to="/login" state={{ from: location.pathname }} className="font-medium text-brand-700 hover:underline">Sign in</Link> with your library card to reserve this title.
              </p>
            )}
          </Card>

          <h2 className="mb-2 mt-8 font-semibold text-slate-900">Copies</h2>
          <Card>
            {b.items.length ? (
              <Table>
                <THead><Th>Library</Th><Th>Call number</Th><Th>Format</Th><Th>Status</Th></THead>
                <TBody>
                  {b.items.map((i) => {
                    const s = publicStatus(i.status, i.itemType.notForLoan, i.dueAt);
                    return (
                      <tr key={i.id}>
                        <Td>{i.currentBranch.name}{i.shelfLocation && <div className="text-xs text-slate-500">{i.shelfLocation}</div>}</Td>
                        <Td className="font-mono text-xs">{i.callNumber}{i.enumeration && ` ${i.enumeration}`}</Td>
                        <Td>{i.itemType.name}</Td>
                        <Td><Badge tone={s.tone}>{s.label}</Badge></Td>
                      </tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-slate-500">The library has no copies of this title yet.</p>
            )}
          </Card>

          <h2 className="mb-2 mt-8 font-semibold text-slate-900">Details</h2>
          <DescriptionList
            items={[
              { label: 'Publisher', value: [b.publicationPlace, b.publisher, b.publicationYear].filter(Boolean).join(', ') },
              { label: 'Edition', value: b.edition },
              { label: 'Description', value: b.physicalDescription },
              { label: 'Series', value: b.series },
              { label: 'Language', value: b.language ? (LANGUAGES[b.language] ?? b.language) : null },
              { label: 'ISBN', value: [b.isbn13, b.isbn10].filter(Boolean).join(' / ') },
              { label: 'ISSN', value: b.issn },
              { label: 'Dewey classification', value: b.ddc ? `${b.ddc} · ${DDC_CLASSES[b.ddc[0]] ?? ''}` : null },
            ]}
          />
          {b.subjects.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Subjects</div>
              <div className="flex flex-wrap gap-1.5">
                {b.subjects.map((s) => <Link key={s} to={`/search?field=subject&q=${encodeURIComponent(s.split(' -- ')[0])}`}><Badge tone="blue">{s}</Badge></Link>)}
              </div>
            </div>
          )}
          {b.summary && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{b.summary}</p>}
        </div>
      </div>
    </div>
  );
}
