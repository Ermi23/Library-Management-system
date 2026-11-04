import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Newspaper, PackageCheck, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, relativeDays } from '@/lib/format';
import { useBranches, useItemTypes, useTitle } from '@/lib/hooks';
import type { BiblioSummary } from '@/lib/types';
import { BiblioPicker } from '@/components/pickers';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CardHeader, Checkbox, DescriptionList, ErrorMessage, Field, Input, LoadingBlock, Modal, ModalFooter, PageHeader, QueryState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

const FREQUENCIES = { WEEKLY: 'Weekly', BIWEEKLY: 'Every two weeks', MONTHLY: 'Monthly', BIMONTHLY: 'Every two months', QUARTERLY: 'Quarterly', SEMIANNUAL: 'Twice a year', ANNUAL: 'Yearly' } as const;
type Frequency = keyof typeof FREQUENCIES;

interface Subscription {
  id: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  labelPattern: string;
  createItems: boolean;
  isActive: boolean;
  notes: string | null;
  biblio: { id: string; title: string; issn: string | null };
  vendor: { id: string; name: string } | null;
  branch: { id: string; name: string };
  itemType: { id: string; name: string } | null;
  nextIssue?: { label: string; expectedOn: string } | null;
  lateCount?: number;
}

interface Issue {
  id: string;
  number: number;
  label: string;
  expectedOn: string;
  receivedOn: string | null;
  status: 'EXPECTED' | 'RECEIVED' | 'MISSING';
  late: boolean;
  item: { id: string; barcode: string } | null;
}

export function SerialsPage() {
  useTitle('Serials');
  const [creating, setCreating] = useState(false);
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: () => api<Subscription[]>('/serials/subscriptions') });
  const late = useQuery({ queryKey: ['serials', 'late'], queryFn: () => api<(Issue & { subscription: Subscription })[]>('/serials/late') });
  return (
    <>
      <PageHeader
        title="Serials"
        description="Magazine, journal and newspaper subscriptions. Expected issues are predicted from the frequency; check them in as they arrive."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New subscription</Button>}
      />
      {!!late.data?.length && (
        <Card className="mb-6 border-amber-200">
          <CardHeader title={`Late issues (${late.data.length})`} description="Not received a week after the expected date: claim them from the vendor" />
          <Table>
            <THead><Th>Title</Th><Th>Issue</Th><Th>Expected</Th><Th>Vendor</Th></THead>
            <TBody>
              {late.data.map((i) => (
                <tr key={i.id}>
                  <Td><Link to={`/staff/serials/${i.subscription.id}`} className="font-medium hover:underline">{i.subscription.biblio.title}</Link></Td>
                  <Td>{i.label}</Td>
                  <Td className="text-red-600">{formatDate(i.expectedOn)} ({relativeDays(i.expectedOn)})</Td>
                  <Td>{i.subscription.vendor?.name ?? '—'}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Card>
        <QueryState query={subs} empty={{ when: !subs.data?.length, icon: <Newspaper className="size-10" />, title: 'No subscriptions yet' }}>
          <Table>
            <THead><Th>Title</Th><Th>Frequency</Th><Th>Branch</Th><Th>Vendor</Th><Th>Next expected</Th><Th>Status</Th></THead>
            <TBody>
              {subs.data?.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td>
                    <Link to={`/staff/serials/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.biblio.title}</Link>
                    {s.biblio.issn && <div className="font-mono text-xs text-slate-500">ISSN {s.biblio.issn}</div>}
                  </Td>
                  <Td>{FREQUENCIES[s.frequency]}</Td>
                  <Td>{s.branch.name}</Td>
                  <Td>{s.vendor?.name ?? '—'}</Td>
                  <Td>{s.nextIssue ? <>{s.nextIssue.label}<div className="text-xs text-slate-500">{formatDate(s.nextIssue.expectedOn)}</div></> : '—'}</Td>
                  <Td className="space-x-1">
                    {s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>}
                    {!!s.lateCount && <Badge tone="red">{s.lateCount} late</Badge>}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </QueryState>
      </Card>
      {creating && <SubscriptionModal onClose={() => setCreating(false)} />}
    </>
  );
}

function SubscriptionModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const branches = useBranches();
  const itemTypes = useItemTypes();
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api<{ id: string; name: string }[]>('/acquisitions/vendors') });
  const [biblio, setBiblio] = useState<BiblioSummary | null>(null);
  const [f, setF] = useState({
    vendorId: '',
    branchId: '',
    itemTypeId: '',
    frequency: 'MONTHLY' as Frequency,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    labelPattern: 'No. {n} ({date})',
    firstNumber: '1',
    createItems: true,
    predict: '12',
  });
  const branchId = f.branchId || branches.data?.[0]?.id || '';
  const itemTypeId = f.itemTypeId || itemTypes.data?.find((t) => t.code === 'MAG')?.id || '';
  const save = useMutation({
    mutationFn: () => api('/serials/subscriptions', { method: 'POST', body: { ...f, branchId, itemTypeId, biblioId: biblio?.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
  });
  return (
    <Modal open title="New subscription" onClose={onClose} size="lg">
      <div className="space-y-4">
        <Field label="Serial title" required hint="Catalog the magazine or journal first (with its ISSN and 0 copies).">
          <BiblioPicker value={biblio} onChange={setBiblio} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Frequency">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })}>
              {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="First issue expected"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Subscription ends"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Branch">
            <Select value={branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Vendor">
            <Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>
              <option value="">—</option>
              {vendors.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Item type for issues">
            <Select value={itemTypeId} onChange={(e) => setF({ ...f, itemTypeId: e.target.value })}>
              {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Issue label" hint="{n} = number, {date} = month" className="sm:col-span-2">
            <Input value={f.labelPattern} onChange={(e) => setF({ ...f, labelPattern: e.target.value })} />
          </Field>
          <Field label="First issue number"><Input type="number" min={1} value={f.firstNumber} onChange={(e) => setF({ ...f, firstNumber: e.target.value })} /></Field>
        </div>
        <Checkbox label="Create a circulating copy (with barcode) for each issue received" checked={f.createItems} onChange={(v) => setF({ ...f, createItems: v })} />
        <ErrorMessage error={save.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!biblio} loading={save.isPending} onClick={() => save.mutate()}>Create subscription</Button>
      </ModalFooter>
    </Modal>
  );
}

export function SubscriptionPage() {
  const { id } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const sub = useQuery({ queryKey: ['subscription', id], queryFn: () => api<Subscription & { issues: Issue[] }>(`/serials/subscriptions/${id}`) });
  useTitle(sub.data?.biblio.title ?? 'Subscription');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription', id] });
    queryClient.invalidateQueries({ queryKey: ['serials'] });
  };

  async function act(path: string, success: string, body?: unknown) {
    try {
      const r = await api<{ item?: { barcode: string } | null }>(path, { method: 'POST', body });
      toast.success(r?.item ? `${success} Copy ${r.item.barcode} created.` : success);
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  if (sub.isLoading) return <LoadingBlock />;
  if (!sub.data) return <ErrorMessage error={sub.error} />;
  const s = sub.data;
  return (
    <>
      <PageHeader
        back={{ to: '/staff/serials', label: 'Serials' }}
        title={s.biblio.title}
        description={`${FREQUENCIES[s.frequency]} · ${s.branch.name}${s.vendor ? ` · ${s.vendor.name}` : ''}`}
        actions={<Button variant="secondary" onClick={() => act(`/serials/subscriptions/${id}/generate`, 'Next issues predicted.', { count: 6 })}><CalendarPlus className="size-4" /> Predict 6 more issues</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader title="Issues" />
          <Table>
            <THead><Th>Issue</Th><Th>Expected</Th><Th>Status</Th><Th>Copy</Th><Th /></THead>
            <TBody>
              {s.issues.map((i) => (
                <tr key={i.id} className={i.late ? 'bg-red-50/40' : undefined}>
                  <Td className="font-medium">{i.label}</Td>
                  <Td>{formatDate(i.expectedOn)}</Td>
                  <Td>
                    {i.status === 'RECEIVED' ? <Badge tone="green">Received {formatDate(i.receivedOn)}</Badge> : i.status === 'MISSING' ? <Badge tone="red">Missing</Badge> : i.late ? <Badge tone="red">Late</Badge> : <Badge>Expected</Badge>}
                  </Td>
                  <Td>{i.item ? <Link className="font-mono text-xs text-brand-700 hover:underline" to={`/staff/items/${i.item.id}`}>{i.item.barcode}</Link> : '—'}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {i.status === 'EXPECTED' && (
                      <>
                        <Button size="sm" variant="success" onClick={() => act(`/serials/issues/${i.id}/receive`, `${i.label} received.`)}><PackageCheck className="size-3.5" /> Receive</Button>
                        <Button size="sm" variant="ghost" onClick={() => act(`/serials/issues/${i.id}/missing`, `${i.label} marked missing.`)}>Missing</Button>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="self-start p-4">
          <DescriptionList
            items={[
              { label: 'ISSN', value: s.biblio.issn },
              { label: 'Started', value: formatDate(s.startDate) },
              { label: 'Ends', value: s.endDate ? formatDate(s.endDate) : 'Open-ended' },
              { label: 'Label pattern', value: s.labelPattern },
              { label: 'Creates copies', value: s.createItems ? `Yes (${s.itemType?.name ?? 'Magazine'})` : 'No' },
              { label: 'Notes', value: s.notes },
            ]}
          />
          <Link to={`/staff/catalog/${s.biblio.id}`} className="mt-4 inline-block text-sm text-brand-700 hover:underline">Open catalog record →</Link>
        </Card>
      </div>
    </>
  );
}
