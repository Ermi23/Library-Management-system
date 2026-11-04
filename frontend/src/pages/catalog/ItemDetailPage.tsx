import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, fullName } from '@/lib/format';
import { useCurrency, useTitle } from '@/lib/hooks';
import type { Item, Paged, PatronRef } from '@/lib/types';
import { Alert, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorMessage, ItemStatusBadge, LoadingBlock, PageHeader, Pagination, Table, TBody, Td, Th, THead } from '@/components/ui';
import { EditItemModal, ItemStatusModal } from './itemModals';

interface ItemDetail extends Item {
  biblio: { id: string; title: string; authors: string[]; isbn13: string | null };
  loans: { id: string; dueAt: string; checkedOutAt: string; renewals: number; patron: PatronRef }[];
  holds: { id: string; status: string; patron: { id: string; firstName: string; lastName: string }; pickupBranch: { name: string } }[];
  transfers: { id: string; fromBranch: { name: string }; toBranch: { name: string }; sentAt: string }[];
  orderLine: { order: { id: string; orderNumber: string } } | null;
  accruedFine: number;
}

interface HistoryLoan {
  id: string;
  checkedOutAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewals: number;
  patron: PatronRef;
  branch: { name: string };
  returnBranch: { name: string } | null;
}

export function ItemDetailPage() {
  const { id } = useParams();
  const currency = useCurrency();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const item = useQuery({ queryKey: ['item', id], queryFn: () => api<ItemDetail>(`/catalog/items/${id}`) });
  const history = useQuery({ queryKey: ['item', id, 'history', page], queryFn: () => api<Paged<HistoryLoan>>(`/catalog/items/${id}/history`, { query: { page, pageSize: 15 } }) });
  useTitle(item.data ? `Copy ${item.data.barcode}` : 'Copy');

  if (item.isLoading) return <LoadingBlock />;
  if (item.error || !item.data) return <ErrorMessage error={item.error} />;
  const i = item.data;
  const loan = i.loans[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['item', id] });

  return (
    <>
      <PageHeader
        back={{ to: `/staff/catalog/${i.biblio.id}`, label: i.biblio.title }}
        title={<span className="font-mono">{i.barcode}</span>}
        description={<span className="flex items-center gap-2"><ItemStatusBadge status={i.status} /> {i.biblio.title}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
            <Button variant="secondary" onClick={() => setChanging(true)}>Change status</Button>
            <Link to={`/staff/labels?ids=${i.id}`}><Button variant="secondary"><Tag className="size-4" /> Label</Button></Link>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Copy details" />
          <div className="p-4">
            <DescriptionList
              items={[
                { label: 'Call number', value: i.callNumber && <span className="font-mono">{i.callNumber}</span> },
                { label: 'Item type', value: i.itemType.name + (i.itemType.notForLoan ? ' (not for loan)' : '') },
                { label: 'Home branch', value: i.homeBranch.name },
                { label: 'Current location', value: [i.currentBranch.name, i.shelfLocation].filter(Boolean).join(' · ') },
                { label: 'Volume / part', value: i.enumeration },
                { label: 'Copy number', value: i.copyNumber },
                { label: 'Price', value: i.price ? formatMoney(i.price, currency) : null },
                { label: 'Acquired', value: formatDate(i.acquiredAt) },
                { label: 'Last seen', value: formatDateTime(i.lastSeenAt) },
                { label: 'Purchase order', value: i.orderLine && <Link className="text-brand-700 hover:underline" to={`/staff/acquisitions/orders/${i.orderLine.order.id}`}>{i.orderLine.order.orderNumber}</Link> },
              ]}
            />
            {i.notes && <p className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{i.notes}</p>}
          </div>
        </Card>
        <div className="space-y-4">
          {loan && (
            <Alert tone={new Date(loan.dueAt) < new Date() ? 'red' : 'blue'} title="On loan">
              To <Link className="font-medium underline" to={`/staff/patrons/${loan.patron.id}`}>{fullName(loan.patron)}</Link> since {formatDate(loan.checkedOutAt)}, due {formatDate(loan.dueAt)}
              {loan.renewals > 0 && ` (renewed ${loan.renewals}×)`}.
              {i.accruedFine > 0 && <> Fine so far: <b>{formatMoney(i.accruedFine, currency)}</b>.</>}
            </Alert>
          )}
          {i.holds.map((h) => (
            <Alert key={h.id} tone="blue" title={h.status === 'READY' ? 'Waiting on the hold shelf' : 'In transit for a hold'}>
              For <Link className="underline" to={`/staff/patrons/${h.patron.id}`}>{fullName(h.patron)}</Link>, pickup at {h.pickupBranch.name}.
            </Alert>
          ))}
          {i.transfers.map((t) => (
            <Alert key={t.id} tone="amber" title="In transit">
              From {t.fromBranch.name} to {t.toBranch.name}, sent {formatDateTime(t.sentAt)}.
            </Alert>
          ))}
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Circulation history" />
        {history.data?.data.length ? (
          <>
            <Table>
              <THead><Th>Patron</Th><Th>Checked out</Th><Th>Due</Th><Th>Returned</Th><Th>Renewals</Th><Th>Branch</Th></THead>
              <TBody>
                {history.data.data.map((l) => (
                  <tr key={l.id}>
                    <Td><Link className="text-brand-700 hover:underline" to={`/staff/patrons/${l.patron.id}`}>{fullName(l.patron)}</Link></Td>
                    <Td>{formatDate(l.checkedOutAt)}</Td>
                    <Td>{formatDate(l.dueAt)}</Td>
                    <Td className={l.returnedAt && new Date(l.returnedAt) > new Date(l.dueAt) ? 'text-red-600' : ''}>{l.returnedAt ? formatDate(l.returnedAt) : 'On loan'}</Td>
                    <Td>{l.renewals}</Td>
                    <Td className="text-slate-600">{l.branch.name}{l.returnBranch && l.returnBranch.name !== l.branch.name && ` → ${l.returnBranch.name}`}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={history.data.page} totalPages={history.data.totalPages} total={history.data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="This copy has never been borrowed" />
        )}
      </Card>
      {editing && <EditItemModal item={i} onClose={() => setEditing(false)} onSaved={refresh} />}
      {changing && <ItemStatusModal item={i} onLoan={!!loan} onClose={() => setChanging(false)} onSaved={refresh} />}
    </>
  );
}
