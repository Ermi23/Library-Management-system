import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, fullName, relativeDays } from '@/lib/format';
import { useBranches, useTitle } from '@/lib/hooks';
import type { BiblioSummary, Hold, Paged, User } from '@/lib/types';
import { OverrideCancelled, useConfirm, useOverridable } from '@/components/dialogs';
import { BiblioPicker, PatronPicker } from '@/components/pickers';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorMessage, Field, Input, Modal, ModalFooter, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

type Tab = 'pull' | 'shelf' | 'active';

const HOLD_TONE = { PENDING: 'gray', IN_TRANSIT: 'amber', READY: 'purple', FULFILLED: 'green', CANCELLED: 'gray', EXPIRED: 'red' } as const;

interface PullHold extends Hold {
  biblio: Hold['biblio'] & { items: { id: string; barcode: string; callNumber: string | null; shelfLocation: string | null; currentBranch: { id: string; name: string } }[] };
}

export function HoldsPage() {
  useTitle('Holds');
  const [tab, setTab] = useState<Tab>('pull');
  const [page, setPage] = useState(1);
  const [placing, setPlacing] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const toPull = useQuery({ queryKey: ['holds', 'pull'], queryFn: () => api<PullHold[]>('/holds/to-pull'), enabled: tab === 'pull' });
  const shelf = useQuery({ queryKey: ['holds', 'shelf'], queryFn: () => api<Hold[]>('/holds/shelf'), enabled: tab === 'shelf' });
  const active = useQuery({
    queryKey: ['holds', 'active', page],
    queryFn: () => api<Paged<Hold>>('/holds', { query: { active: 'true', page, pageSize: 25 } }),
    enabled: tab === 'active',
  });

  async function cancel(hold: Hold) {
    const ok = await confirm({
      title: 'Cancel hold?',
      body: <>Cancel {fullName(hold.patron)}&apos;s hold on <b>{hold.biblio.title}</b>? The patron is notified.</>,
      confirmLabel: 'Cancel hold',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await api<{ route: { message: string } | null }>(`/holds/${hold.id}/cancel`, { method: 'POST' });
      toast.success(result.route ? `Hold cancelled. ${result.route.message}` : 'Hold cancelled.');
      queryClient.invalidateQueries({ queryKey: ['holds'] });
    } catch (err) {
      toast.error(err);
    }
  }

  const expiredOnShelf = shelf.data?.filter((h) => h.expired).length ?? 0;

  return (
    <>
      {confirmDialog}
      <PageHeader
        title="Holds"
        description="Reservations placed by patrons. Check in a pulled copy to trap it for the next patron in the queue."
        actions={
          <Button onClick={() => setPlacing(true)}>
            <Plus className="size-4" /> Place hold
          </Button>
        }
      />
      <Card>
        <Tabs<Tab>
          className="px-4 pt-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'pull', label: 'Holds to pull', count: toPull.data?.length },
            { value: 'shelf', label: 'Hold shelf (your branch)', count: shelf.data?.length },
            { value: 'active', label: 'All active holds', count: active.data?.total },
          ]}
        />

        {tab === 'pull' && (
          <QueryState query={toPull} empty={{ when: !toPull.data?.length, icon: <Bookmark className="size-10" />, title: 'Nothing to pull', description: 'Pending holds with a copy on the shelf appear here.' }}>
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">Take these copies off the shelf and check them in at the circulation desk.</div>
            <Table>
              <THead>
                <Th>Title</Th>
                <Th>Copies on shelf</Th>
                <Th>For</Th>
                <Th>Pickup</Th>
                <Th>Placed</Th>
              </THead>
              <TBody>
                {toPull.data?.map((h) => (
                  <tr key={h.id}>
                    <Td>
                      <Link to={`/staff/catalog/${h.biblio.id}`} className="font-medium hover:underline">{h.biblio.title}</Link>
                    </Td>
                    <Td>
                      {h.biblio.items.map((i) => (
                        <div key={i.id} className="text-xs">
                          <span className="font-mono">{i.barcode}</span> · {i.callNumber ?? '—'} · {i.currentBranch.name}
                          {i.shelfLocation && ` · ${i.shelfLocation}`}
                        </div>
                      ))}
                    </Td>
                    <Td>{h.patron && <Link to={`/staff/patrons/${h.patron.id}`} className="text-brand-700 hover:underline">{fullName(h.patron)}</Link>}</Td>
                    <Td>{h.pickupBranch.name}</Td>
                    <Td className="whitespace-nowrap">{formatDate(h.placedAt)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </QueryState>
        )}

        {tab === 'shelf' && (
          <QueryState query={shelf} empty={{ when: !shelf.data?.length, title: 'The hold shelf is empty' }}>
            {expiredOnShelf > 0 && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                {expiredOnShelf} hold{expiredOnShelf === 1 ? ' has' : 's have'} passed the pickup date. Cancel to pass the copy to the next patron.
              </div>
            )}
            <HoldTable holds={shelf.data ?? []} onCancel={cancel} showItem />
          </QueryState>
        )}

        {tab === 'active' && (
          <QueryState query={active} empty={{ when: !active.data?.data.length, title: 'No active holds' }}>
            <HoldTable holds={active.data?.data ?? []} onCancel={cancel} showItem />
            {active.data && <Pagination page={active.data.page} totalPages={active.data.totalPages} total={active.data.total} onChange={setPage} />}
          </QueryState>
        )}
      </Card>
      {placing && <PlaceHoldModal onClose={() => setPlacing(false)} />}
    </>
  );
}

export function HoldTable({ holds, onCancel, showItem }: { holds: Hold[]; onCancel?: (h: Hold) => void; showItem?: boolean }) {
  return (
    <Table>
      <THead>
        <Th>Title</Th>
        <Th>Patron</Th>
        <Th>Status</Th>
        <Th>Pickup</Th>
        {showItem && <Th>Copy</Th>}
        <Th>Placed</Th>
        <Th />
      </THead>
      <TBody>
        {holds.map((h) => (
          <tr key={h.id} className={h.expired ? 'bg-amber-50/50' : undefined}>
            <Td>
              <Link to={`/staff/catalog/${h.biblio.id}`} className="font-medium hover:underline">{h.biblio.title}</Link>
            </Td>
            <Td>
              {h.patron && (
                <>
                  <Link to={`/staff/patrons/${h.patron.id}`} className="text-brand-700 hover:underline">{fullName(h.patron)}</Link>
                  <div className="text-xs text-slate-500">{[h.patron.cardNumber, h.patron.phone].filter(Boolean).join(' · ')}</div>
                </>
              )}
            </Td>
            <Td>
              <Badge tone={HOLD_TONE[h.status]}>{h.status.replace('_', ' ').toLowerCase()}</Badge>
              {h.status === 'READY' && h.expiresAt && (
                <div className={`mt-1 text-xs ${h.expired ? 'font-medium text-red-600' : 'text-slate-500'}`}>until {formatDate(h.expiresAt)} ({relativeDays(h.expiresAt)})</div>
              )}
            </Td>
            <Td>{h.pickupBranch.name}</Td>
            {showItem && <Td className="font-mono text-xs">{h.item?.barcode ?? '—'}</Td>}
            <Td className="whitespace-nowrap">{formatDate(h.placedAt)}</Td>
            <Td className="text-right">
              {onCancel && ['PENDING', 'IN_TRANSIT', 'READY'].includes(h.status) && (
                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => onCancel(h)}>
                  Cancel
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

export function PlaceHoldModal({ onClose, biblio: initialBiblio, patron: initialPatron }: { onClose: () => void; biblio?: BiblioSummary | null; patron?: User | null }) {
  const [biblio, setBiblio] = useState<BiblioSummary | null>(initialBiblio ?? null);
  const [patron, setPatron] = useState<User | null>(initialPatron ?? null);
  const [pickupBranchId, setPickup] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const branches = useBranches();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { run, dialog } = useOverridable();

  const place = useMutation({
    mutationFn: () =>
      run(
        (override) =>
          api<{ position: number; copiesOnShelf: number }>('/holds', {
            method: 'POST',
            body: { biblioId: biblio!.id, patronId: patron!.id, pickupBranchId: pickupBranchId || undefined, expiresAt: expiresAt || undefined, override },
          }),
        'Place hold anyway?',
      ),
    onSuccess: (r) => {
      toast.success(`Hold placed. Queue position ${r.position}.${r.copiesOnShelf ? ' A copy is on the shelf: see "Holds to pull".' : ''}`);
      queryClient.invalidateQueries();
      onClose();
    },
    onError: (err) => {
      if (err instanceof OverrideCancelled) place.reset();
    },
  });

  return (
    <Modal open title="Place a hold" onClose={onClose}>
      {dialog}
      <div className="space-y-4">
        <Field label="Title" required>
          <BiblioPicker value={biblio} onChange={setBiblio} autoFocus={!initialBiblio} />
        </Field>
        <Field label="Patron" required>
          <PatronPicker value={patron} onChange={setPatron} autoFocus={!!initialBiblio} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pickup branch" hint="Defaults to your working branch">
            <Select value={pickupBranchId} onChange={(e) => setPickup(e.target.value)}>
              <option value="">Working branch</option>
              {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Not needed after" hint="Optional">
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>
        {!(place.error instanceof OverrideCancelled) && <ErrorMessage error={place.error} />}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => place.mutate()} disabled={!biblio || !patron} loading={place.isPending}>Place hold</Button>
      </ModalFooter>
    </Modal>
  );
}
