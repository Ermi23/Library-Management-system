import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Download, MoreHorizontal, Pencil, Plus, Printer, Tag, Trash2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { DDC_CLASSES, formatDate, formatMoney, fullName, LANGUAGES } from '@/lib/format';
import { useCurrency, useTitle } from '@/lib/hooks';
import type { BiblioFields, Hold, Item, PatronRef } from '@/lib/types';
import { useConfirm } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { Badge, BookCover, Button, Card, DescriptionList, EmptyState, ErrorMessage, ItemStatusBadge, LoadingBlock, PageHeader, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';
import { HoldTable, PlaceHoldModal } from '../circulation/HoldsPage';
import { AddItemsModal, EditItemModal, ItemStatusModal } from './itemModals';

interface BiblioDetail extends BiblioFields {
  id: string;
  createdAt: string;
  updatedAt: string;
  suggestedCallNumber: string | null;
  items: (Item & {
    loans: { id: string; dueAt: string; patron: PatronRef }[];
    holds: { id: string; status: string; patron: { firstName: string; lastName: string } }[];
  })[];
  holds: Hold[];
  orderLines: { id: string; quantity: number; quantityReceived: number; unitPrice: string; order: { id: string; orderNumber: string; status: string } }[];
  subscriptions: { id: string; frequency: string; isActive: boolean }[];
}

type Tab = 'copies' | 'holds' | 'details' | 'marc';

export function BiblioDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const currency = useCurrency();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [tab, setTab] = useState<Tab>('copies');
  const [adding, setAdding] = useState(false);
  const [holding, setHolding] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [statusItem, setStatusItem] = useState<(Item & { loans: unknown[] }) | null>(null);
  const [menu, setMenu] = useState(false);

  const biblio = useQuery({ queryKey: ['biblio', id], queryFn: () => api<BiblioDetail>(`/catalog/biblios/${id}`) });
  const marc = useQuery({ queryKey: ['biblio', id, 'marc'], queryFn: () => api<{ text: string }>(`/catalog/biblios/${id}/marc`), enabled: tab === 'marc' });
  useTitle(biblio.data?.title ?? 'Title');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['biblio', id] });

  async function remove() {
    const ok = await confirm({ title: 'Delete this title?', body: 'The bibliographic record will be removed permanently.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/catalog/biblios/${id}`, { method: 'DELETE' });
      toast.success('Title deleted.');
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      navigate('/staff/catalog');
    } catch (err) {
      toast.error(err);
    }
  }

  async function cancelHold(h: Hold) {
    const ok = await confirm({ title: 'Cancel hold?', body: `Cancel ${fullName(h.patron)}'s hold? The patron is notified.`, confirmLabel: 'Cancel hold', danger: true });
    if (!ok) return;
    try {
      await api(`/holds/${h.id}/cancel`, { method: 'POST' });
      toast.success('Hold cancelled.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  async function deleteItem(item: Item) {
    const ok = await confirm({ title: `Delete copy ${item.barcode}?`, body: 'Only copies that have never circulated can be deleted. Otherwise mark the copy withdrawn.', confirmLabel: 'Delete copy', danger: true });
    if (!ok) return;
    try {
      await api(`/catalog/items/${item.id}`, { method: 'DELETE' });
      toast.success('Copy deleted.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  if (biblio.isLoading) return <LoadingBlock />;
  if (biblio.error || !biblio.data) return <ErrorMessage error={biblio.error ?? new Error('Not found')} />;
  const b = biblio.data;
  const available = b.items.filter((i) => i.status === 'AVAILABLE').length;

  return (
    <>
      {dialog}
      <PageHeader
        back={{ to: '/staff/catalog', label: 'Catalog' }}
        title={
          <span className="flex items-start gap-4">
            <BookCover url={b.coverUrl} title={b.title} className="hidden h-24 w-16 sm:flex" />
            <span>
              {b.title}
              {b.subtitle && <span className="block text-base font-normal text-slate-600">{b.subtitle}</span>}
            </span>
          </span>
        }
        description={
          <div className="space-y-1">
            <div>{b.authors.join('; ')}</div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={available ? 'green' : 'amber'}>{available} of {b.items.length} available</Badge>
              {b.ddc && <Badge tone="blue">DDC {b.ddc}</Badge>}
              {b.suggestedCallNumber && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{b.suggestedCallNumber}</span>}
              {b.isbn13 && <span className="text-xs text-slate-500">ISBN {b.isbn13}</span>}
            </div>
          </div>
        }
        actions={
          <>
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add copies</Button>
            <Button variant="secondary" onClick={() => setHolding(true)}><Bookmark className="size-4" /> Place hold</Button>
            <Link to={`/staff/catalog/${b.id}/edit`}><Button variant="secondary"><Pencil className="size-4" /> Edit</Button></Link>
            <div className="relative">
              <Button variant="secondary" onClick={() => setMenu((m) => !m)} aria-label="More actions"><MoreHorizontal className="size-4" /></Button>
              {menu && (
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
                  <Link to={`/staff/labels?biblioId=${b.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><Tag className="size-4" /> Print labels</Link>
                  <button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50" onClick={() => download(`/catalog/biblios/${b.id}/marc`, { format: 'mrc' }).catch(toast.error)}><Download className="size-4" /> Export MARC (.mrc)</button>
                  <button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50" onClick={() => download(`/catalog/biblios/${b.id}/marc`, { format: 'xml' }).catch(toast.error)}><Download className="size-4" /> Export MARCXML</button>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50" onClick={remove}><Trash2 className="size-4" /> Delete title</button>
                </div>
              )}
            </div>
          </>
        }
      />

      <Card>
        <Tabs<Tab>
          className="px-4 pt-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'copies', label: 'Copies', count: b.items.length },
            { value: 'holds', label: 'Holds', count: b.holds.length },
            { value: 'details', label: 'Details' },
            { value: 'marc', label: 'MARC' },
          ]}
        />

        {tab === 'copies' &&
          (b.items.length === 0 ? (
            <EmptyState title="No copies yet" description="Add copies to make this title available for loan." action={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add copies</Button>} />
          ) : (
            <Table>
              <THead>
                <Th>Barcode</Th>
                <Th>Call number</Th>
                <Th>Type</Th>
                <Th>Home / current branch</Th>
                <Th>Status</Th>
                <Th className="text-right">Price</Th>
                <Th />
              </THead>
              <TBody>
                {b.items.map((i) => {
                  const loan = i.loans[0];
                  return (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <Td>
                        <Link to={`/staff/items/${i.id}`} className="font-mono text-sm font-medium text-brand-700 hover:underline">{i.barcode}</Link>
                        {i.enumeration && <div className="text-xs text-slate-500">{i.enumeration}</div>}
                      </Td>
                      <Td className="font-mono text-xs">{i.callNumber ?? '—'}</Td>
                      <Td>{i.itemType.name}</Td>
                      <Td>
                        {i.homeBranch.name}
                        {i.currentBranch.id !== i.homeBranch.id && <div className="text-xs text-amber-700">now at {i.currentBranch.name}</div>}
                        {i.shelfLocation && <div className="text-xs text-slate-500">{i.shelfLocation}</div>}
                      </Td>
                      <Td>
                        <ItemStatusBadge status={i.status} />
                        {loan && (
                          <div className="mt-1 text-xs text-slate-600">
                            <Link to={`/staff/patrons/${loan.patron.id}`} className="hover:underline">{fullName(loan.patron)}</Link> · due {formatDate(loan.dueAt)}
                          </div>
                        )}
                        {i.holds[0] && <div className="mt-1 text-xs text-violet-700">for {fullName(i.holds[0].patron)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{i.price ? formatMoney(i.price, currency) : '—'}</Td>
                      <Td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatusItem(i)}>Status</Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => deleteItem(i)} aria-label={`Delete ${i.barcode}`}><Trash2 className="size-3.5" /></Button>
                      </Td>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
          ))}

        {tab === 'holds' && (b.holds.length ? <HoldTable holds={b.holds} onCancel={cancelHold} showItem /> : <EmptyState title="Nobody is waiting for this title" />)}

        {tab === 'details' && (
          <div className="space-y-6 p-4">
            <DescriptionList
              items={[
                { label: 'Authors', value: b.authors.join('; ') },
                { label: 'Edition', value: b.edition },
                { label: 'Publisher', value: [b.publicationPlace, b.publisher, b.publicationYear].filter(Boolean).join(', ') },
                { label: 'Physical description', value: b.physicalDescription },
                { label: 'Language', value: b.language ? (LANGUAGES[b.language] ?? b.language) : null },
                { label: 'Series', value: b.series },
                { label: 'ISBN-13', value: b.isbn13 },
                { label: 'ISBN-10', value: b.isbn10 },
                { label: 'ISSN', value: b.issn },
                { label: 'DDC', value: b.ddc ? `${b.ddc} (${DDC_CLASSES[b.ddc[0]] ?? ''})` : null },
                { label: 'Added', value: formatDate(b.createdAt) },
                { label: 'Last changed', value: formatDate(b.updatedAt) },
              ]}
            />
            {b.subjects.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Subjects</div>
                <div className="flex flex-wrap gap-1.5">
                  {b.subjects.map((s) => (
                    <Link key={s} to={`/staff/catalog?field=subject&q=${encodeURIComponent(s.split(' -- ')[0])}`}><Badge tone="blue">{s}</Badge></Link>
                  ))}
                </div>
              </div>
            )}
            {b.summary && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Summary</div>
                <p className="whitespace-pre-line text-sm text-slate-700">{b.summary}</p>
              </div>
            )}
            {b.notes && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Notes</div>
                <p className="whitespace-pre-line text-sm text-slate-700">{b.notes}</p>
              </div>
            )}
            {b.orderLines.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Orders</div>
                {b.orderLines.map((l) => (
                  <div key={l.id} className="text-sm">
                    <Link to={`/staff/acquisitions/orders/${l.order.id}`} className="text-brand-700 hover:underline">{l.order.orderNumber}</Link> · {l.quantityReceived}/{l.quantity} received · {l.order.status.toLowerCase()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'marc' && (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => download(`/catalog/biblios/${b.id}/marc`, { format: 'mrc' }).catch(toast.error)}><Download className="size-3.5" /> .mrc</Button>
              <Button size="sm" variant="secondary" onClick={() => download(`/catalog/biblios/${b.id}/marc`, { format: 'xml' }).catch(toast.error)}><Download className="size-3.5" /> MARCXML</Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
            </div>
            {marc.isLoading ? <LoadingBlock /> : <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">{marc.data?.text}</pre>}
            <p className="mt-2 text-xs text-slate-500">MARC 21 bibliographic record generated from the catalog fields. Holdings are in field 952 (Koha format).</p>
          </div>
        )}
      </Card>

      {adding && <AddItemsModal biblioId={b.id} suggestedCallNumber={b.suggestedCallNumber} onClose={() => setAdding(false)} />}
      {holding && (
        <PlaceHoldModal
          onClose={() => { setHolding(false); refresh(); }}
          biblio={{ ...b, activeHolds: b.holds.length, availability: { total: b.items.length, available, onLoan: 0, branches: [], callNumber: b.suggestedCallNumber, itemTypes: [] } }}
        />
      )}
      {editing && <EditItemModal item={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {statusItem && <ItemStatusModal item={statusItem} onLoan={statusItem.loans.length > 0} onClose={() => setStatusItem(null)} onSaved={refresh} />}
    </>
  );
}
