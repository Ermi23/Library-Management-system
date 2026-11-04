import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useBranches, useTitle } from '@/lib/hooks';
import type { Paged } from '@/lib/types';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorMessage, Field, Input, Modal, ModalFooter, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

interface Transfer {
  id: string;
  status: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  reason: string | null;
  sentAt: string;
  receivedAt: string | null;
  item: { id: string; barcode: string; callNumber: string | null; biblio: { id: string; title: string } };
  fromBranch: { name: string };
  toBranch: { name: string };
}

type Tab = 'incoming' | 'outgoing' | 'all' | 'history';

const REASONS: Record<string, string> = { HOLD: 'For a hold', RETURN_HOME: 'Return to home branch', MANUAL: 'Manual transfer' };

export function TransfersPage() {
  useTitle('Transfers');
  const [tab, setTab] = useState<Tab>('incoming');
  const [page, setPage] = useState(1);
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const transfers = useQuery({
    queryKey: ['transfers', tab, page],
    queryFn: () =>
      api<Paged<Transfer>>('/transfers', {
        query: { direction: tab === 'history' || tab === 'all' ? 'all' : tab, status: tab === 'history' ? undefined : 'IN_TRANSIT', page, pageSize: 25 },
      }),
  });

  async function act(t: Transfer, action: 'receive' | 'cancel') {
    try {
      const result = await api<{ route?: { message: string } }>(`/transfers/${t.id}/${action}`, { method: 'POST' });
      toast.success(action === 'receive' ? `Received. ${result.route?.message ?? ''}` : 'Transfer cancelled; the copy is back on the shelf at the sending branch.');
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Copies moving between branches. Receiving a transfer is the same as checking the copy in at the destination."
        actions={<Button onClick={() => setSending(true)}><Send className="size-4" /> Send an item</Button>}
      />
      <Card>
        <Tabs<Tab>
          className="px-4 pt-2"
          value={tab}
          onChange={(t) => { setTab(t); setPage(1); }}
          tabs={[
            { value: 'incoming', label: 'Coming to this branch' },
            { value: 'outgoing', label: 'Sent from this branch' },
            { value: 'all', label: 'All in transit' },
            { value: 'history', label: 'History' },
          ]}
        />
        <QueryState query={transfers} empty={{ when: !transfers.data?.data.length, icon: <Truck className="size-10" />, title: 'No transfers' }}>
          <Table>
            <THead>
              <Th>Item</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Reason</Th>
              <Th>Sent</Th>
              <Th>Status</Th>
              <Th />
            </THead>
            <TBody>
              {transfers.data?.data.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link to={`/staff/catalog/${t.item.biblio.id}`} className="font-medium hover:underline">{t.item.biblio.title}</Link>
                    <div className="font-mono text-xs text-slate-500">{t.item.barcode}</div>
                  </Td>
                  <Td>{t.fromBranch.name}</Td>
                  <Td>{t.toBranch.name}</Td>
                  <Td className="text-slate-600">{REASONS[t.reason ?? ''] ?? t.reason}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(t.sentAt)}</Td>
                  <Td>
                    <Badge tone={t.status === 'IN_TRANSIT' ? 'amber' : t.status === 'RECEIVED' ? 'green' : 'gray'}>{t.status.replace('_', ' ').toLowerCase()}</Badge>
                    {t.receivedAt && <div className="mt-1 text-xs text-slate-500">{formatDateTime(t.receivedAt)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {t.status === 'IN_TRANSIT' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => act(t, 'receive')}>Receive</Button>
                        <Button size="sm" variant="ghost" onClick={() => act(t, 'cancel')}>Cancel</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {transfers.data && <Pagination page={transfers.data.page} totalPages={transfers.data.totalPages} total={transfers.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
      {sending && <SendModal onClose={() => setSending(false)} />}
    </>
  );
}

function SendModal({ onClose }: { onClose: () => void }) {
  const [barcode, setBarcode] = useState('');
  const [toBranchId, setTo] = useState('');
  const branches = useBranches();
  const toast = useToast();
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () => api<Transfer>('/transfers', { method: 'POST', body: { barcode, toBranchId } }),
    onSuccess: (t) => {
      toast.success(`Sending "${t.item.biblio.title}" to ${t.toBranch.name}.`);
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      onClose();
    },
  });
  return (
    <Modal open title="Send an item to another branch" onClose={onClose} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-4">
        <Field label="Item barcode" required>
          <Input autoFocus className="font-mono" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </Field>
        <Field label="Destination" required>
          <Select value={toBranchId} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Choose a branch</option>
            {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <ErrorMessage error={send.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={send.isPending} disabled={!barcode || !toBranchId}>Send</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
