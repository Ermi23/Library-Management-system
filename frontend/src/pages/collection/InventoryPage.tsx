import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Download, HelpCircle, MapPin, Play, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadCsv, formatDate, formatDateTime, fullName, ITEM_STATUS } from '@/lib/format';
import { useBranches, useTitle } from '@/lib/hooks';
import type { ItemStatus, Paged } from '@/lib/types';
import { useConfirm } from '@/components/dialogs';
import { ScanInput } from '@/components/ScanInput';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CardHeader, Checkbox, cn, ErrorMessage, Field, Input, ItemStatusBadge, LoadingBlock, Modal, ModalFooter, PageHeader, Pagination, QueryState, Select, Stat, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

interface Session {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  shelfLocation: string | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  branch: { id: string; name: string };
  startedBy: { firstName: string; lastName: string };
  _count?: { scans: number };
}

type Tab = 'sessions' | 'status';

export function InventoryPage() {
  useTitle('Inventory');
  const [tab, setTab] = useState<Tab>('sessions');
  const [starting, setStarting] = useState(false);
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock-take by scanning shelves, and review copies that are lost, missing, damaged or withdrawn."
        actions={<Button onClick={() => setStarting(true)}><Play className="size-4" /> Start stock-take</Button>}
      />
      <Card>
        <Tabs<Tab> className="px-4 pt-2" value={tab} onChange={setTab} tabs={[{ value: 'sessions', label: 'Stock-take sessions' }, { value: 'status', label: 'Copies by status' }]} />
        {tab === 'sessions' ? <SessionList /> : <ItemsByStatus />}
      </Card>
      {starting && <StartModal onClose={() => setStarting(false)} />}
    </>
  );
}

function SessionList() {
  const [page, setPage] = useState(1);
  const sessions = useQuery({ queryKey: ['inventory', 'sessions', page], queryFn: () => api<Paged<Session>>('/inventory/sessions', { query: { page } }) });
  return (
    <QueryState query={sessions} empty={{ when: !sessions.data?.data.length, icon: <ClipboardList className="size-10" />, title: 'No stock-takes yet', description: 'Start one, then walk the shelves scanning every copy.' }}>
      <Table>
        <THead><Th>Started</Th><Th>Branch / location</Th><Th>By</Th><Th>Scanned</Th><Th>Status</Th></THead>
        <TBody>
          {sessions.data?.data.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <Td><Link to={`/staff/inventory/${s.id}`} className="font-medium text-brand-700 hover:underline">{formatDateTime(s.startedAt)}</Link></Td>
              <Td>{s.branch.name}{s.shelfLocation && <span className="text-slate-500"> · {s.shelfLocation}</span>}</Td>
              <Td>{fullName(s.startedBy)}</Td>
              <Td className="tabular-nums">{s._count?.scans}</Td>
              <Td><Badge tone={s.status === 'OPEN' ? 'blue' : s.status === 'COMPLETED' ? 'green' : 'gray'}>{s.status.toLowerCase()}</Badge></Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {sessions.data && <Pagination page={sessions.data.page} totalPages={sessions.data.totalPages} total={sessions.data.total} onChange={setPage} />}
    </QueryState>
  );
}

function StartModal({ onClose }: { onClose: () => void }) {
  const branches = useBranches();
  const navigate = useNavigate();
  const locations = useQuery({ queryKey: ['lookups', 'shelf-locations'], queryFn: () => api<string[]>('/lookups/shelf-locations') });
  const [branchId, setBranchId] = useState('');
  const [shelfLocation, setShelf] = useState('');
  const start = useMutation({
    mutationFn: () => api<Session>('/inventory/sessions', { method: 'POST', body: { branchId: branchId || undefined, shelfLocation } }),
    onSuccess: (s) => navigate(`/staff/inventory/${s.id}`),
  });
  return (
    <Modal open title="Start a stock-take" onClose={onClose} size="sm">
      <div className="space-y-4">
        <Field label="Branch" hint="Defaults to your working branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Working branch</option>
            {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Shelf location (optional)" hint="Limit the count to one area, e.g. Fiction">
          <Input list="shelf-locations" value={shelfLocation} onChange={(e) => setShelf(e.target.value)} />
          <datalist id="shelf-locations">{locations.data?.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
        <ErrorMessage error={start.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={start.isPending} onClick={() => start.mutate()}>Start</Button>
      </ModalFooter>
    </Modal>
  );
}

const RESULT_STYLE = {
  FOUND: { label: 'Found', tone: 'green', icon: CheckCircle2 },
  WRONG_BRANCH: { label: 'Wrong branch', tone: 'amber', icon: MapPin },
  CHECKED_OUT: { label: 'Shows as on loan', tone: 'amber', icon: HelpCircle },
  UNKNOWN_BARCODE: { label: 'Unknown barcode', tone: 'red', icon: XCircle },
} as const;

interface SessionDetail extends Session {
  stats: { expected: number; scannedExpected: number; notYetScanned: number; results: Record<string, number> };
  recentScans: { id: string; barcode: string; result: keyof typeof RESULT_STYLE; scannedAt: string; item: { id: string; barcode: string; callNumber: string | null; biblio: { title: string }; currentBranch: { name: string } } | null }[];
}

export function InventorySessionPage() {
  const { id } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [missingPage, setMissingPage] = useState(1);
  const [markMissing, setMarkMissing] = useState(true);
  const [last, setLast] = useState<{ message: string; result: keyof typeof RESULT_STYLE; title?: string } | null>(null);
  const session = useQuery({ queryKey: ['inventory', id], queryFn: () => api<SessionDetail>(`/inventory/sessions/${id}`) });
  const missing = useQuery({
    queryKey: ['inventory', id, 'missing', missingPage],
    queryFn: () => api<Paged<{ id: string; barcode: string; callNumber: string | null; shelfLocation: string | null; status: ItemStatus; lastSeenAt: string | null; biblio: { id: string; title: string } }>>(`/inventory/sessions/${id}/missing`, { query: { page: missingPage, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  useTitle('Stock-take');

  async function scan(barcode: string) {
    try {
      const r = await api<{ scan: { result: keyof typeof RESULT_STYLE }; item: { biblio: { title: string } } | null; message: string; duplicate: boolean }>(`/inventory/sessions/${id}/scan`, { method: 'POST', body: { barcode } });
      setLast({ message: r.message, result: r.scan.result, title: r.item?.biblio.title });
      queryClient.invalidateQueries({ queryKey: ['inventory', id] });
    } catch (err) {
      toast.error(err);
      throw err;
    }
  }

  async function complete() {
    const ok = await confirm({
      title: 'Finish this stock-take?',
      body: markMissing ? `${session.data?.stats.notYetScanned ?? 0} copies that were not scanned will be marked missing.` : 'Unscanned copies will keep their current status.',
      confirmLabel: 'Finish',
    });
    if (!ok) return;
    try {
      const r = await api<{ markedMissing: number }>(`/inventory/sessions/${id}/complete`, { method: 'POST', body: { markMissing } });
      toast.success(`Stock-take complete. ${r.markedMissing} cop${r.markedMissing === 1 ? 'y' : 'ies'} marked missing.`);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      toast.error(err);
    }
  }

  if (session.isLoading) return <LoadingBlock />;
  if (!session.data) return <ErrorMessage error={session.error} />;
  const s = session.data;
  const open = s.status === 'OPEN';
  const pct = s.stats.expected ? Math.round((s.stats.scannedExpected / s.stats.expected) * 100) : 0;

  return (
    <>
      {dialog}
      <PageHeader
        back={{ to: '/staff/inventory', label: 'Inventory' }}
        title={`Stock-take: ${s.branch.name}${s.shelfLocation ? ` · ${s.shelfLocation}` : ''}`}
        description={`Started ${formatDateTime(s.startedAt)} by ${fullName(s.startedBy)}${s.completedAt ? ` · finished ${formatDateTime(s.completedAt)}` : ''}`}
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              const all = await api<Paged<{ barcode: string; callNumber: string | null; status: string; biblio: { title: string }; lastSeenAt: string | null }>>(`/inventory/sessions/${id}/missing`, { query: { pageSize: 100 } });
              downloadCsv(`stocktake-missing-${id}.csv`, all.data.map((i) => ({ barcode: i.barcode, title: i.biblio.title, callNumber: i.callNumber, status: i.status, lastSeen: formatDate(i.lastSeenAt) })));
            }}
          >
            <Download className="size-4" /> Unscanned list
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Expected on shelf" value={s.stats.expected} />
        <Stat label="Scanned" value={`${s.stats.scannedExpected} (${pct}%)`} tone="green" />
        <Stat label="Not yet scanned" value={s.stats.notYetScanned} tone={s.stats.notYetScanned ? 'amber' : undefined} />
        <Stat label="Problems" value={(s.stats.results.WRONG_BRANCH ?? 0) + (s.stats.results.CHECKED_OUT ?? 0) + (s.stats.results.UNKNOWN_BARCODE ?? 0)} tone="red" />
      </div>

      {open && (
        <Card className="mb-6 p-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-2 bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-4">
            <ScanInput onScan={scan} placeholder="Scan each copy on the shelf" buttonLabel="Record" />
          </div>
          {last && (
            <div className={cn('mt-3 rounded-lg border px-3 py-2 text-sm', last.result === 'FOUND' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : last.result === 'UNKNOWN_BARCODE' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
              <b>{RESULT_STYLE[last.result].label}</b>{last.title && `: ${last.title}`}. {last.message}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <Checkbox label="Mark unscanned copies as missing when finishing" checked={markMissing} onChange={setMarkMissing} />
            <Button variant="success" onClick={complete}>Finish stock-take</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent scans" />
          {s.recentScans.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {s.recentScans.map((sc) => {
                const style = RESULT_STYLE[sc.result];
                return (
                  <li key={sc.id} className="flex items-start justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{sc.item?.biblio.title ?? <span className="text-slate-500">Not in catalog</span>}</div>
                      <div className="font-mono text-xs text-slate-500">{sc.barcode}{sc.item?.callNumber && ` · ${sc.item.callNumber}`}</div>
                    </div>
                    <Badge tone={style.tone}>{style.label}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-slate-500">No scans yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title={open ? 'Not yet scanned' : 'Not scanned'} description="Copies the system expects on these shelves" />
          <QueryState query={missing} empty={{ when: !missing.data?.data.length, title: 'Everything expected has been scanned' }}>
            <Table>
              <THead><Th>Call number</Th><Th>Title</Th><Th>Status</Th></THead>
              <TBody>
                {missing.data?.data.map((i) => (
                  <tr key={i.id}>
                    <Td className="whitespace-nowrap font-mono text-xs">{i.callNumber ?? '—'}<div className="text-slate-500">{i.barcode}</div></Td>
                    <Td><Link to={`/staff/items/${i.id}`} className="hover:underline">{i.biblio.title}</Link></Td>
                    <Td><ItemStatusBadge status={i.status} /></Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            {missing.data && <Pagination page={missing.data.page} totalPages={missing.data.totalPages} total={missing.data.total} onChange={setMissingPage} />}
          </QueryState>
        </Card>
      </div>
    </>
  );
}

function ItemsByStatus() {
  const [status, setStatus] = useState<ItemStatus>('MISSING');
  const [page, setPage] = useState(1);
  const items = useQuery({
    queryKey: ['items', status, page],
    queryFn: () => api<Paged<{ id: string; barcode: string; callNumber: string | null; updatedAt: string; notes: string | null; biblio: { id: string; title: string }; homeBranch: { name: string }; currentBranch: { name: string } }>>('/catalog/items', { query: { status, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-slate-200 p-4">
        {(['MISSING', 'LOST', 'DAMAGED', 'IN_PROCESSING', 'WITHDRAWN', 'IN_TRANSIT', 'ON_HOLD_SHELF'] as ItemStatus[]).map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => { setStatus(s); setPage(1); }}>
            {ITEM_STATUS[s].label}
          </Button>
        ))}
      </div>
      <QueryState query={items} empty={{ when: !items.data?.data.length, title: `No ${ITEM_STATUS[status].label.toLowerCase()} copies` }}>
        <Table>
          <THead><Th>Barcode</Th><Th>Title</Th><Th>Call number</Th><Th>Home / current</Th><Th>Since</Th></THead>
          <TBody>
            {items.data?.data.map((i) => (
              <tr key={i.id}>
                <Td><Link to={`/staff/items/${i.id}`} className="font-mono text-xs text-brand-700 hover:underline">{i.barcode}</Link></Td>
                <Td><Link to={`/staff/catalog/${i.biblio.id}`} className="hover:underline">{i.biblio.title}</Link></Td>
                <Td className="font-mono text-xs">{i.callNumber}</Td>
                <Td className="text-slate-600">{i.homeBranch.name}{i.currentBranch.name !== i.homeBranch.name && ` / ${i.currentBranch.name}`}</Td>
                <Td>{formatDate(i.updatedAt)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
        {items.data && <Pagination page={items.data.page} totalPages={items.data.totalPages} total={items.data.total} onChange={setPage} />}
      </QueryState>
    </>
  );
}
