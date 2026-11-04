import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadCsv, formatDate, formatMoney, fullName, ITEM_STATUS } from '@/lib/format';
import { useBranches, useCurrency, useTitle } from '@/lib/hooks';
import type { ItemStatus } from '@/lib/types';
import { GroupedBarChart, HBarChart } from '@/components/charts';
import { Button, Card, CardHeader, Field, Input, LoadingBlock, PageHeader, Select, Stat, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

type Tab = 'circulation' | 'collection' | 'patrons' | 'fines' | 'overdue' | 'weeding';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function CsvButton({ name, rows }: { name: string; rows: Record<string, unknown>[] | undefined }) {
  return (
    <Button size="sm" variant="secondary" disabled={!rows?.length} onClick={() => rows && downloadCsv(`${name}-${today()}.csv`, rows)}>
      <Download className="size-3.5" /> CSV
    </Button>
  );
}

function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function ReportsPage() {
  useTitle('Reports');
  const branches = useBranches();
  const [tab, setTab] = useState<Tab>('circulation');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState('');
  const range = { from, to, branchId };

  return (
    <>
      <PageHeader title="Reports" description="Statistics for planning, budgeting and reporting to your board. Every table can be exported to CSV." />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <div className="flex gap-1 pb-0.5">
          {[[6, '7 days'], [29, '30 days'], [89, '90 days'], [364, '12 months']].map(([d, l]) => (
            <Button key={l} size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(d as number)); setTo(today()); }}>{l}</Button>
          ))}
        </div>
      </Card>
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'circulation', label: 'Circulation' },
          { value: 'collection', label: 'Collection' },
          { value: 'patrons', label: 'Patrons' },
          { value: 'fines', label: 'Fines' },
          { value: 'overdue', label: 'Overdue' },
          { value: 'weeding', label: 'Weeding' },
        ]}
      />
      {tab === 'circulation' && <CirculationReport range={range} />}
      {tab === 'collection' && <CollectionReport branchId={branchId} />}
      {tab === 'patrons' && <PatronReport range={range} />}
      {tab === 'fines' && <FinesReport range={range} />}
      {tab === 'overdue' && <OverdueReport branchId={branchId} />}
      {tab === 'weeding' && <WeedingReport branchId={branchId} />}
    </>
  );
}

type Range = { from: string; to: string; branchId: string };

function CirculationReport({ range }: { range: Range }) {
  const currency = useCurrency();
  const summary = useQuery({ queryKey: ['report', 'summary', range], queryFn: () => api<Record<string, number>>('/reports/summary', { query: range }) });
  const trend = useQuery({ queryKey: ['report', 'trend', range], queryFn: () => api<{ day: string; checkouts: number; returns: number }[]>('/reports/circulation-trend', { query: range }) });
  const top = useQuery({ queryKey: ['report', 'top', range], queryFn: () => api<{ id: string; title: string; authors: string[]; loans: number }[]>('/reports/top-titles', { query: range }) });
  const s = summary.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Checkouts" value={s?.checkouts ?? '—'} />
        <Stat label="Returns" value={s?.returns ?? '—'} />
        <Stat label="Renewals" value={s?.renewals ?? '—'} />
        <Stat label="Holds placed" value={s?.holdsPlaced ?? '—'} />
        <Stat label="New patrons" value={s?.newPatrons ?? '—'} />
        <Stat label="New titles" value={s?.newTitles ?? '—'} />
        <Stat label="New copies" value={s?.newItems ?? '—'} />
        <Stat label="Fines collected" value={s ? formatMoney(s.finesCollected, currency) : '—'} />
      </div>
      <Section title="Checkouts and returns per day" actions={<CsvButton name="circulation-trend" rows={trend.data} />}>
        {trend.isLoading ? (
          <LoadingBlock />
        ) : (
          <GroupedBarChart
            series={['Checkouts', 'Returns']}
            data={(trend.data ?? []).map((d) => ({ label: formatDate(d.day).replace(/, \d{4}$/, ''), values: [d.checkouts, d.returns] }))}
            height={240}
          />
        )}
      </Section>
      <Section title="Most borrowed titles" actions={<CsvButton name="top-titles" rows={top.data?.map((t) => ({ title: t.title, authors: t.authors.join('; '), loans: t.loans }))} />}>
        {top.data?.length ? (
          <HBarChart data={top.data.map((t) => ({ label: t.title, value: t.loans, hint: t.authors[0] }))} />
        ) : (
          <p className="text-sm text-slate-500">No checkouts in this period.</p>
        )}
      </Section>
    </div>
  );
}

function CollectionReport({ branchId }: { branchId: string }) {
  const currency = useCurrency();
  const data = useQuery({
    queryKey: ['report', 'collection', branchId],
    queryFn: () =>
      api<{
        byClass: { class: string | null; label: string; items: number; titles: number }[];
        byType: { name: string; items: number }[];
        byBranch: { name: string; items: number; available: number }[];
        byStatus: { status: ItemStatus; items: number }[];
        totalItems: number;
        totalValue: number;
      }>('/reports/collection', { query: { branchId } }),
  });
  if (data.isLoading || !data.data) return <LoadingBlock />;
  const d = data.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Copies" value={d.totalItems.toLocaleString()} />
        <Stat label="Collection value" value={formatMoney(d.totalValue, currency)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="By Dewey class" actions={<CsvButton name="collection-by-ddc" rows={d.byClass} />}>
          <HBarChart data={d.byClass.map((c) => ({ label: c.class ? `${c.class} ${c.label}` : c.label, value: c.items, hint: `${c.titles} titles` }))} />
        </Section>
        <Section title="By item type" actions={<CsvButton name="collection-by-type" rows={d.byType} />}>
          <HBarChart data={d.byType.map((t) => ({ label: t.name, value: t.items }))} />
        </Section>
        <Section title="By branch" actions={<CsvButton name="collection-by-branch" rows={d.byBranch} />}>
          <Table>
            <THead><Th>Branch</Th><Th className="text-right">Copies</Th><Th className="text-right">On shelf</Th></THead>
            <TBody>{d.byBranch.map((b) => <tr key={b.name}><Td>{b.name}</Td><Td className="text-right tabular-nums">{b.items}</Td><Td className="text-right tabular-nums">{b.available}</Td></tr>)}</TBody>
          </Table>
        </Section>
        <Section title="By status" actions={<CsvButton name="collection-by-status" rows={d.byStatus} />}>
          <HBarChart data={d.byStatus.map((s) => ({ label: ITEM_STATUS[s.status]?.label ?? s.status, value: s.items }))} />
        </Section>
      </div>
    </div>
  );
}

function PatronReport({ range }: { range: Range }) {
  const data = useQuery({
    queryKey: ['report', 'patrons'],
    queryFn: () => api<{ total: number; activeBorrowers: number; byCategory: { name: string; patrons: number }[]; newByMonth: { month: string; patrons: number }[] }>('/reports/patrons'),
  });
  const top = useQuery({ queryKey: ['report', 'top-patrons', range], queryFn: () => api<{ id: string; firstName: string; lastName: string; cardNumber: string | null; loans: number }[]>('/reports/top-patrons', { query: range }) });
  if (!data.data) return <LoadingBlock />;
  const d = data.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Registered patrons" value={d.total} />
        <Stat label="Borrowed in last 12 months" value={d.activeBorrowers} hint={d.total ? `${Math.round((d.activeBorrowers / d.total) * 100)}% of patrons` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Patrons by category" actions={<CsvButton name="patrons-by-category" rows={d.byCategory} />}>
          <HBarChart data={d.byCategory.map((c) => ({ label: c.name, value: c.patrons }))} />
        </Section>
        <Section title="New registrations by month" actions={<CsvButton name="new-patrons" rows={d.newByMonth} />}>
          {d.newByMonth.length ? <HBarChart data={d.newByMonth.map((m) => ({ label: m.month, value: m.patrons }))} /> : <p className="text-sm text-slate-500">No registrations in the last 12 months.</p>}
        </Section>
      </div>
      <Section title="Most active borrowers in this period" actions={<CsvButton name="top-borrowers" rows={top.data?.map((p) => ({ name: fullName(p), card: p.cardNumber, loans: p.loans }))} />}>
        {top.data?.length ? (
          <Table>
            <THead><Th>Patron</Th><Th>Card</Th><Th className="text-right">Loans</Th></THead>
            <TBody>{top.data.map((p) => <tr key={p.id}><Td><Link to={`/staff/patrons/${p.id}`} className="text-brand-700 hover:underline">{fullName(p)}</Link></Td><Td className="font-mono text-xs">{p.cardNumber}</Td><Td className="text-right tabular-nums">{p.loans}</Td></tr>)}</TBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-500">No checkouts in this period.</p>
        )}
      </Section>
    </div>
  );
}

function FinesReport({ range }: { range: Range }) {
  const currency = useCurrency();
  const data = useQuery({
    queryKey: ['report', 'fines', range],
    queryFn: () => api<{ byType: { type: string; status: string; amount: number; count: number }[]; byMethod: { method: string; amount: number; count: number }[]; outstanding: { amount: number; count: number } }>('/reports/fines', { query: range }),
  });
  if (!data.data) return <LoadingBlock />;
  const d = data.data;
  const charged = d.byType.reduce((s, r) => s + r.amount, 0);
  const collected = d.byMethod.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Charged in period" value={formatMoney(charged, currency)} />
        <Stat label="Collected in period" value={formatMoney(collected, currency)} tone="green" />
        <Stat label="Outstanding (all time)" value={formatMoney(d.outstanding.amount, currency)} tone="red" hint={`${d.outstanding.count} open charges`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Charges by type and status" actions={<CsvButton name="fines-by-type" rows={d.byType} />}>
          <Table>
            <THead><Th>Type</Th><Th>Status</Th><Th className="text-right">Count</Th><Th className="text-right">Amount</Th></THead>
            <TBody>{d.byType.map((r) => <tr key={r.type + r.status}><Td>{r.type.toLowerCase()}</Td><Td>{r.status.toLowerCase()}</Td><Td className="text-right tabular-nums">{r.count}</Td><Td className="text-right tabular-nums">{formatMoney(r.amount, currency)}</Td></tr>)}</TBody>
          </Table>
        </Section>
        <Section title="Payments by method" actions={<CsvButton name="payments-by-method" rows={d.byMethod} />}>
          {d.byMethod.length ? <HBarChart data={d.byMethod.map((m) => ({ label: m.method.replace('_', ' ').toLowerCase(), value: m.amount, hint: `${m.count} payments` }))} format={(v) => formatMoney(v, currency)} /> : <p className="text-sm text-slate-500">No payments in this period.</p>}
        </Section>
      </div>
    </div>
  );
}

function OverdueReport({ branchId }: { branchId: string }) {
  const data = useQuery({
    queryKey: ['report', 'overdue', branchId],
    queryFn: () =>
      api<{ id: string; dueAt: string; daysOverdue: number; item: { barcode: string; callNumber: string | null; biblio: { title: string } }; patron: { id: string; firstName: string; lastName: string; cardNumber: string | null; email: string | null; phone: string | null }; branch: { name: string } }[]>('/reports/overdue', { query: { branchId } }),
  });
  const rows = data.data?.map((l) => ({ patron: fullName(l.patron), card: l.patron.cardNumber, email: l.patron.email, phone: l.patron.phone, title: l.item.biblio.title, barcode: l.item.barcode, due: formatDate(l.dueAt), daysOverdue: l.daysOverdue, branch: l.branch.name }));
  return (
    <Section title={`Overdue items (${data.data?.length ?? 0})`} description="With patron contact details for follow-up" actions={<CsvButton name="overdue" rows={rows} />}>
      {!data.data ? (
        <LoadingBlock />
      ) : !data.data.length ? (
        <p className="text-sm text-slate-500">Nothing is overdue.</p>
      ) : (
        <Table>
          <THead><Th>Patron</Th><Th>Contact</Th><Th>Title</Th><Th>Due</Th><Th className="text-right">Days late</Th></THead>
          <TBody>
            {data.data.map((l) => (
              <tr key={l.id}>
                <Td><Link to={`/staff/patrons/${l.patron.id}`} className="text-brand-700 hover:underline">{fullName(l.patron)}</Link><div className="font-mono text-xs text-slate-500">{l.patron.cardNumber}</div></Td>
                <Td className="text-xs text-slate-600">{l.patron.email}<div>{l.patron.phone}</div></Td>
                <Td>{l.item.biblio.title}<div className="font-mono text-xs text-slate-500">{l.item.barcode}</div></Td>
                <Td>{formatDate(l.dueAt)}</Td>
                <Td className="text-right font-medium tabular-nums text-red-600">{l.daysOverdue}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

function WeedingReport({ branchId }: { branchId: string }) {
  const [months, setMonths] = useState('24');
  const data = useQuery({
    queryKey: ['report', 'dead-stock', months, branchId],
    queryFn: () => api<{ id: string; barcode: string; callNumber: string | null; acquiredAt: string | null; lastSeenAt: string | null; biblio: { id: string; title: string; publicationYear: number | null }; homeBranch: { name: string }; _count: { loans: number } }[]>('/reports/dead-stock', { query: { months, branchId } }),
  });
  const rows = data.data?.map((i) => ({ callNumber: i.callNumber, title: i.biblio.title, year: i.biblio.publicationYear, barcode: i.barcode, branch: i.homeBranch.name, acquired: formatDate(i.acquiredAt), totalLoans: i._count.loans }));
  return (
    <Section
      title="Weeding candidates"
      description="Copies on the shelf that have not been borrowed recently: review for withdrawal or relocation"
      actions={
        <>
          <Select className="w-44" value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Not borrowed for">
            <option value="6">Not borrowed in 6 months</option>
            <option value="12">Not borrowed in 1 year</option>
            <option value="24">Not borrowed in 2 years</option>
            <option value="60">Not borrowed in 5 years</option>
          </Select>
          <CsvButton name="weeding" rows={rows} />
        </>
      }
    >
      {!data.data ? (
        <LoadingBlock />
      ) : !data.data.length ? (
        <p className="text-sm text-slate-500">No copies match.</p>
      ) : (
        <Table>
          <THead><Th>Call number</Th><Th>Title</Th><Th>Published</Th><Th>Branch</Th><Th>Acquired</Th><Th className="text-right">Loans ever</Th></THead>
          <TBody>
            {data.data.map((i) => (
              <tr key={i.id}>
                <Td className="font-mono text-xs">{i.callNumber}<div className="text-slate-500">{i.barcode}</div></Td>
                <Td><Link to={`/staff/items/${i.id}`} className="hover:underline">{i.biblio.title}</Link></Td>
                <Td>{i.biblio.publicationYear ?? '—'}</Td>
                <Td>{i.homeBranch.name}</Td>
                <Td>{formatDate(i.acquiredAt)}</Td>
                <Td className="text-right tabular-nums">{i._count.loans}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
