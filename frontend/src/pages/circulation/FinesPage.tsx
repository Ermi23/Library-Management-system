import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadCsv, formatDate, formatDateTime, formatMoney, fullName } from '@/lib/format';
import { useCurrency, useTitle } from '@/lib/hooks';
import type { Fine, Paged, PatronRef } from '@/lib/types';
import { Badge, Button, Card, PageHeader, Pagination, QueryState, Stat, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

type Tab = 'OUTSTANDING' | 'PAID' | 'WAIVED' | 'payments';

interface Payment {
  id: string;
  amount: string;
  method: string;
  createdAt: string;
  fine: { type: string; description: string | null };
  patron: PatronRef;
  receivedBy: { firstName: string; lastName: string } | null;
}

export const FINE_TYPE: Record<Fine['type'], string> = { OVERDUE: 'Overdue', LOST: 'Lost item', DAMAGE: 'Damage', MANUAL: 'Other charge' };

export function FinesPage() {
  useTitle('Fines');
  const currency = useCurrency();
  const [tab, setTab] = useState<Tab>('OUTSTANDING');
  const [page, setPage] = useState(1);

  const fines = useQuery({
    queryKey: ['fines', tab, page],
    queryFn: () => api<Paged<Fine> & { totals: { amount: number; outstanding: number } }>('/fines', { query: { status: tab, page, pageSize: 25 } }),
    enabled: tab !== 'payments',
    placeholderData: keepPreviousData,
  });
  const payments = useQuery({
    queryKey: ['payments', page],
    queryFn: () => api<Paged<Payment>>('/fines/payments', { query: { page, pageSize: 25 } }),
    enabled: tab === 'payments',
  });
  const outstanding = useQuery({
    queryKey: ['fines', 'OUTSTANDING', 'totals'],
    queryFn: () => api<{ totals: { outstanding: number }; total: number }>('/fines', { query: { status: 'OUTSTANDING', pageSize: 1 } }),
  });

  async function exportCsv() {
    const all = await api<Paged<Fine>>('/fines', { query: { status: 'OUTSTANDING', pageSize: 100 } });
    downloadCsv(
      `outstanding-fines-${new Date().toISOString().slice(0, 10)}.csv`,
      all.data.map((f) => ({ patron: fullName(f.patron), card: f.patron?.cardNumber, type: FINE_TYPE[f.type], description: f.description, amount: f.amount, outstanding: f.outstanding, date: formatDate(f.createdAt) })),
    );
  }

  return (
    <>
      <PageHeader
        title="Fines & payments"
        description="To take a payment, open the patron's record and use the Fines tab."
        actions={<Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Export outstanding</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Outstanding" value={formatMoney(outstanding.data?.totals.outstanding, currency)} tone="red" />
        <Stat label="Open charges" value={outstanding.data?.total ?? '—'} />
      </div>
      <Card>
        <Tabs<Tab>
          className="px-4 pt-2"
          value={tab}
          onChange={(t) => { setTab(t); setPage(1); }}
          tabs={[
            { value: 'OUTSTANDING', label: 'Outstanding' },
            { value: 'PAID', label: 'Paid' },
            { value: 'WAIVED', label: 'Waived' },
            { value: 'payments', label: 'Payments received' },
          ]}
        />
        {tab === 'payments' ? (
          <QueryState query={payments} empty={{ when: !payments.data?.data.length, title: 'No payments yet' }}>
            <Table>
              <THead><Th>Date</Th><Th>Patron</Th><Th>For</Th><Th>Method</Th><Th>Received by</Th><Th className="text-right">Amount</Th></THead>
              <TBody>
                {payments.data?.data.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(p.createdAt)}</Td>
                    <Td><Link to={`/staff/patrons/${p.patron.id}`} className="text-brand-700 hover:underline">{fullName(p.patron)}</Link></Td>
                    <Td className="text-slate-600">{p.fine.description}</Td>
                    <Td>{p.method.replace('_', ' ').toLowerCase()}</Td>
                    <Td>{p.receivedBy ? fullName(p.receivedBy) : '—'}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(p.amount, currency)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            {payments.data && <Pagination page={payments.data.page} totalPages={payments.data.totalPages} total={payments.data.total} onChange={setPage} />}
          </QueryState>
        ) : (
          <QueryState query={fines} empty={{ when: !fines.data?.data.length, title: 'No charges' }}>
            <Table>
              <THead><Th>Date</Th><Th>Patron</Th><Th>Type</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th className="text-right">Outstanding</Th></THead>
              <TBody>
                {fines.data?.data.map((f) => (
                  <tr key={f.id}>
                    <Td className="whitespace-nowrap">{formatDate(f.createdAt)}</Td>
                    <Td>{f.patron && <Link to={`/staff/patrons/${f.patron.id}?tab=fines`} className="text-brand-700 hover:underline">{fullName(f.patron)}</Link>}</Td>
                    <Td><Badge tone={f.type === 'LOST' ? 'red' : f.type === 'OVERDUE' ? 'amber' : 'gray'}>{FINE_TYPE[f.type]}</Badge></Td>
                    <Td className="text-slate-600">{f.description}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(f.amount, currency)}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(f.outstanding, currency)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            {fines.data && <Pagination page={fines.data.page} totalPages={fines.data.totalPages} total={fines.data.total} onChange={setPage} />}
          </QueryState>
        )}
      </Card>
    </>
  );
}
