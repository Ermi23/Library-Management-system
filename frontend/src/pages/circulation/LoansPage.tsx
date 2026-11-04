import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadCsv, formatDate, fullName, relativeDays } from '@/lib/format';
import { useDebounced, useTitle } from '@/lib/hooks';
import type { Loan, Paged } from '@/lib/types';
import { OverrideCancelled, useOverridable } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Input, PageHeader, Pagination, QueryState, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

type Status = 'active' | 'overdue' | 'dueToday' | 'returned';

export function LoansPage() {
  useTitle('Loans');
  const [status, setStatus] = useState<Status>('overdue');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { run, dialog } = useOverridable();

  const loans = useQuery({
    queryKey: ['loans', status, debounced, page],
    queryFn: () => api<Paged<Loan & { returnBranch?: { name: string } | null }>>('/circulation/loans', { query: { status, q: debounced, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  async function renew(id: string) {
    try {
      const loan = await run((override) => api<{ dueAt: string }>(`/circulation/loans/${id}/renew`, { method: 'POST', body: { override } }), 'Renew anyway?');
      toast.success(`Renewed until ${formatDate(loan.dueAt)}`);
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err);
    }
  }

  async function exportCsv() {
    const all = await api<Paged<Loan>>('/circulation/loans', { query: { status, q: debounced, pageSize: 100 } });
    downloadCsv(
      `loans-${status}-${new Date().toISOString().slice(0, 10)}.csv`,
      all.data.map((l) => ({
        title: l.item.biblio.title,
        barcode: l.item.barcode,
        patron: fullName(l.patron),
        card: l.patron?.cardNumber,
        email: l.patron?.email,
        phone: l.patron?.phone,
        checkedOut: formatDate(l.checkedOutAt),
        due: formatDate(l.dueAt),
        returned: formatDate(l.returnedAt),
      })),
    );
  }

  return (
    <>
      {dialog}
      <PageHeader
        title="Loans & overdues"
        description="Everything that is checked out, what is late and what has come back."
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />
      <Card>
        <Tabs<Status>
          className="px-4 pt-2"
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          tabs={[
            { value: 'overdue', label: 'Overdue' },
            { value: 'dueToday', label: 'Due today' },
            { value: 'active', label: 'All on loan' },
            { value: 'returned', label: 'Returned' },
          ]}
        />
        <div className="border-b border-slate-200 p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Title, barcode, patron surname or card" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <QueryState query={loans} empty={{ when: !loans.data?.data.length, title: status === 'overdue' ? 'Nothing is overdue' : 'No loans found' }}>
          <Table>
            <THead>
              <Th>Title</Th>
              <Th>Patron</Th>
              <Th>Checked out</Th>
              <Th>{status === 'returned' ? 'Returned' : 'Due'}</Th>
              <Th>Branch</Th>
              <Th />
            </THead>
            <TBody>
              {loans.data?.data.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td>
                    <Link to={`/staff/catalog/${l.item.biblio.id}`} className="font-medium text-slate-900 hover:underline">{l.item.biblio.title}</Link>
                    <div className="font-mono text-xs text-slate-500">{l.item.barcode}</div>
                  </Td>
                  <Td>
                    {l.patron && (
                      <>
                        <Link to={`/staff/patrons/${l.patron.id}`} className="text-brand-700 hover:underline">{fullName(l.patron)}</Link>
                        <div className="text-xs text-slate-500">{[l.patron.cardNumber, l.patron.phone].filter(Boolean).join(' · ')}</div>
                      </>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(l.checkedOutAt)}</Td>
                  <Td className="whitespace-nowrap">
                    {l.returnedAt ? (
                      formatDate(l.returnedAt)
                    ) : (
                      <>
                        <div className={l.overdue ? 'font-medium text-red-600' : ''}>{formatDate(l.dueAt)}</div>
                        <div className="text-xs">{l.overdue ? <Badge tone="red">{relativeDays(l.dueAt).replace(' ago', ' late')}</Badge> : <span className="text-slate-500">{relativeDays(l.dueAt)}</span>}</div>
                      </>
                    )}
                  </Td>
                  <Td className="text-slate-600">{l.returnedAt ? l.returnBranch?.name : l.branch?.name}</Td>
                  <Td className="text-right">
                    {!l.returnedAt && (
                      <Button size="sm" variant="secondary" onClick={() => renew(l.id)}>
                        <RefreshCw className="size-3.5" /> Renew
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {loans.data && <Pagination page={loans.data.page} totalPages={loans.data.totalPages} total={loans.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
    </>
  );
}
