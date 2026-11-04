import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Plus, Send, ShoppingCart, Trash2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, fullName } from '@/lib/format';
import { useBranches, useCurrency, useItemTypes, useTitle } from '@/lib/hooks';
import type { BiblioSummary, Paged } from '@/lib/types';
import { OverrideCancelled, useConfirm, useOverridable } from '@/components/dialogs';
import { BiblioPicker } from '@/components/pickers';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CardHeader, Checkbox, DescriptionList, ErrorMessage, Field, Input, LoadingBlock, Modal, ModalFooter, PageHeader, Pagination, QueryState, Select, Stat, Table, TBody, Td, Textarea, Th, THead, Tabs } from '@/components/ui';

type OrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
const ORDER_TONE = { DRAFT: 'gray', ORDERED: 'blue', PARTIALLY_RECEIVED: 'amber', RECEIVED: 'green', CANCELLED: 'red' } as const;
const orderLabel = (s: OrderStatus) => s.replace('_', ' ').toLowerCase();

interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  accountNumber: string | null;
  discountPercent: string | null;
  notes: string | null;
  isActive: boolean;
  _count?: { orders: number; subscriptions: number };
}

interface Fund {
  id: string;
  code: string;
  name: string;
  fiscalYear: number;
  allocated: string;
  committed: number;
  spent: number;
  available: number;
  isActive: boolean;
  branchId: string | null;
  branch: { name: string } | null;
}

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  orderedAt: string | null;
  createdAt: string;
  vendor: { id: string; name: string };
  branch: { name: string };
  totals: { total: number; received: number; copies: number; copiesReceived: number };
}

type Tab = 'orders' | 'vendors' | 'funds';

export function AcquisitionsPage() {
  useTitle('Acquisitions');
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'orders';
  const [creating, setCreating] = useState<Tab | null>(null);
  return (
    <>
      <PageHeader
        title="Acquisitions"
        description="Order new material from vendors, track spending against funds, and receive copies straight into the catalog."
        actions={
          <Button onClick={() => setCreating(tab)}>
            <Plus className="size-4" /> {tab === 'orders' ? 'New order' : tab === 'vendors' ? 'Add vendor' : 'Add fund'}
          </Button>
        }
      />
      <Card>
        <Tabs<Tab> className="px-4 pt-2" value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: 'orders', label: 'Purchase orders' }, { value: 'vendors', label: 'Vendors' }, { value: 'funds', label: 'Funds & budgets' }]} />
        {tab === 'orders' && <OrderList />}
        {tab === 'vendors' && <VendorList />}
        {tab === 'funds' && <FundList />}
      </Card>
      {creating === 'orders' && <NewOrderModal onClose={() => setCreating(null)} />}
      {creating === 'vendors' && <VendorModal vendor={null} onClose={() => setCreating(null)} />}
      {creating === 'funds' && <FundModal fund={null} onClose={() => setCreating(null)} />}
    </>
  );
}

function OrderList() {
  const currency = useCurrency();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const orders = useQuery({ queryKey: ['orders', status, page], queryFn: () => api<Paged<OrderSummary>>('/acquisitions/orders', { query: { status, page } }) });
  return (
    <>
      <div className="border-b border-slate-200 p-4">
        <Select className="w-52" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All orders</option>
          {(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as OrderStatus[]).map((s) => <option key={s} value={s}>{orderLabel(s)}</option>)}
        </Select>
      </div>
      <QueryState query={orders} empty={{ when: !orders.data?.data.length, icon: <ShoppingCart className="size-10" />, title: 'No purchase orders' }}>
        <Table>
          <THead><Th>Order</Th><Th>Vendor</Th><Th>Receiving branch</Th><Th>Copies</Th><Th className="text-right">Total</Th><Th>Status</Th></THead>
          <TBody>
            {orders.data?.data.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td>
                  <Link to={`/staff/acquisitions/orders/${o.id}`} className="font-mono font-medium text-brand-700 hover:underline">{o.orderNumber}</Link>
                  <div className="text-xs text-slate-500">{o.orderedAt ? `ordered ${formatDate(o.orderedAt)}` : `created ${formatDate(o.createdAt)}`}</div>
                </Td>
                <Td>{o.vendor.name}</Td>
                <Td className="text-slate-600">{o.branch.name}</Td>
                <Td className="tabular-nums">{o.totals.copiesReceived}/{o.totals.copies}</Td>
                <Td className="text-right tabular-nums">{formatMoney(o.totals.total, currency)}</Td>
                <Td><Badge tone={ORDER_TONE[o.status]}>{orderLabel(o.status)}</Badge></Td>
              </tr>
            ))}
          </TBody>
        </Table>
        {orders.data && <Pagination page={orders.data.page} totalPages={orders.data.totalPages} total={orders.data.total} onChange={setPage} />}
      </QueryState>
    </>
  );
}

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const branches = useBranches();
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api<Vendor[]>('/acquisitions/vendors') });
  const [f, setF] = useState({ vendorId: '', branchId: '', expectedAt: '', notes: '' });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/acquisitions/orders', { method: 'POST', body: f }),
    onSuccess: (o) => navigate(`/staff/acquisitions/orders/${o.id}`),
  });
  return (
    <Modal open title="New purchase order" onClose={onClose} size="sm">
      <div className="space-y-4">
        <Field label="Vendor" required hint={!vendors.data?.length ? 'Add a vendor first (Vendors tab).' : undefined}>
          <Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>
            <option value="">Choose a vendor</option>
            {vendors.data?.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Receiving branch" hint="New copies are added here">
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">Working branch</option>
            {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Expected delivery">
          <Input type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
        </Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorMessage error={create.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!f.vendorId} loading={create.isPending} onClick={() => create.mutate()}>Create draft</Button>
      </ModalFooter>
    </Modal>
  );
}

function VendorList() {
  const [editing, setEditing] = useState<Vendor | null>(null);
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api<Vendor[]>('/acquisitions/vendors') });
  return (
    <QueryState query={vendors} empty={{ when: !vendors.data?.length, title: 'No vendors yet' }}>
      <Table>
        <THead><Th>Vendor</Th><Th>Contact</Th><Th>Discount</Th><Th>Orders</Th><Th>Status</Th><Th /></THead>
        <TBody>
          {vendors.data?.map((v) => (
            <tr key={v.id}>
              <Td><div className="font-medium">{v.name}</div>{v.accountNumber && <div className="text-xs text-slate-500">Account {v.accountNumber}</div>}</Td>
              <Td className="text-slate-600">{[v.contactName, v.email, v.phone].filter(Boolean).join(' · ')}</Td>
              <Td>{v.discountPercent ? `${Number(v.discountPercent)}%` : '—'}</Td>
              <Td className="tabular-nums">{v._count?.orders}</Td>
              <Td>{v.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(v)}>Edit</Button></Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {editing && <VendorModal vendor={editing} onClose={() => setEditing(null)} />}
    </QueryState>
  );
}

function VendorModal({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    name: vendor?.name ?? '',
    contactName: vendor?.contactName ?? '',
    email: vendor?.email ?? '',
    phone: vendor?.phone ?? '',
    address: vendor?.address ?? '',
    website: vendor?.website ?? '',
    accountNumber: vendor?.accountNumber ?? '',
    discountPercent: vendor?.discountPercent ?? '',
    notes: vendor?.notes ?? '',
    isActive: vendor?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (vendor ? api(`/acquisitions/vendors/${vendor.id}`, { method: 'PATCH', body: f }) : api('/acquisitions/vendors', { method: 'POST', body: f })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      onClose();
    },
  });
  const text = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}><Input value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  return (
    <Modal open title={vendor ? `Edit ${vendor.name}` : 'Add vendor'} onClose={onClose} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {text('name', 'Name', { required: true, autoFocus: true })}
          {text('contactName', 'Contact person')}
          {text('email', 'Email', { type: 'email' })}
          {text('phone', 'Phone')}
          {text('website', 'Website')}
          {text('accountNumber', 'Our account number')}
          {text('discountPercent', 'Discount %', { inputMode: 'decimal' })}
          {text('address', 'Address')}
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Checkbox label="Active" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
        <ErrorMessage error={save.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function FundList() {
  const currency = useCurrency();
  const [editing, setEditing] = useState<Fund | null>(null);
  const funds = useQuery({ queryKey: ['funds'], queryFn: () => api<Fund[]>('/acquisitions/funds') });
  return (
    <QueryState query={funds} empty={{ when: !funds.data?.length, title: 'No funds yet', description: 'Funds track how much of each budget is committed and spent.' }}>
      <Table>
        <THead><Th>Fund</Th><Th>Year</Th><Th className="text-right">Allocated</Th><Th className="text-right">Committed</Th><Th className="text-right">Spent</Th><Th className="text-right">Available</Th><Th>Used</Th><Th /></THead>
        <TBody>
          {funds.data?.map((f) => {
            const allocated = Number(f.allocated);
            const used = allocated ? Math.min(100, ((f.spent + f.committed) / allocated) * 100) : 0;
            return (
              <tr key={f.id}>
                <Td><div className="font-medium">{f.name}</div><div className="font-mono text-xs text-slate-500">{f.code}{f.branch && ` · ${f.branch.name}`}</div></Td>
                <Td>{f.fiscalYear}</Td>
                <Td className="text-right tabular-nums">{formatMoney(allocated, currency)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(f.committed, currency)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(f.spent, currency)}</Td>
                <Td className={`text-right font-medium tabular-nums ${f.available < 0 ? 'text-red-600' : ''}`}>{formatMoney(f.available, currency)}</Td>
                <Td className="w-32">
                  <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${used > 90 ? 'bg-red-500' : 'bg-[#2a78d6]'}`} style={{ width: `${used}%` }} /></div>
                  <div className="mt-0.5 text-xs text-slate-500">{used.toFixed(0)}%</div>
                </Td>
                <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button></Td>
              </tr>
            );
          })}
        </TBody>
      </Table>
      {editing && <FundModal fund={editing} onClose={() => setEditing(null)} />}
    </QueryState>
  );
}

function FundModal({ fund, onClose }: { fund: Fund | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const branches = useBranches();
  const [f, setF] = useState({
    code: fund?.code ?? '',
    name: fund?.name ?? '',
    fiscalYear: String(fund?.fiscalYear ?? new Date().getFullYear()),
    allocated: fund?.allocated ?? '',
    branchId: fund?.branchId ?? '',
    isActive: fund?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (fund ? api(`/acquisitions/funds/${fund.id}`, { method: 'PATCH', body: f }) : api('/acquisitions/funds', { method: 'POST', body: f })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funds'] });
      onClose();
    },
  });
  return (
    <Modal open title={fund ? `Edit fund ${fund.code}` : 'Add fund'} onClose={onClose} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required><Input className="font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required /></Field>
          <Field label="Fiscal year" required><Input inputMode="numeric" value={f.fiscalYear} onChange={(e) => setF({ ...f, fiscalYear: e.target.value })} required /></Field>
        </div>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Allocated amount" required><Input inputMode="decimal" value={f.allocated} onChange={(e) => setF({ ...f, allocated: e.target.value })} required /></Field>
        <Field label="Branch (optional)">
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">All branches</option>
            {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Checkbox label="Active" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
        <ErrorMessage error={save.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------

interface OrderDetail extends Omit<OrderSummary, 'vendor'> {
  expectedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  vendor: { id: string; name: string; email: string | null; discountPercent: string | null };
  createdBy: { firstName: string; lastName: string } | null;
  lines: {
    id: string;
    quantity: number;
    quantityReceived: number;
    unitPrice: string;
    notes: string | null;
    biblio: { id: string; title: string; authors: string[]; isbn13: string | null };
    fund: { id: string; code: string; name: string } | null;
    itemType: { id: string; name: string };
    items: { id: string; barcode: string; status: string }[];
  }[];
}

export function OrderDetailPage() {
  const { id } = useParams();
  const currency = useCurrency();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { run, dialog } = useOverridable();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [addingLine, setAddingLine] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api<OrderDetail>(`/acquisitions/orders/${id}`) });
  useTitle(order.data?.orderNumber ?? 'Order');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['order', id] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['funds'] });
  };

  async function place() {
    try {
      await run((override) => api(`/acquisitions/orders/${id}/place`, { method: 'POST', body: { override } }), 'Place order anyway?');
      toast.success('Order placed.');
      refresh();
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err);
    }
  }

  async function cancel() {
    const anyReceived = order.data?.lines.some((l) => l.quantityReceived > 0);
    const ok = await confirm({
      title: anyReceived ? 'Close this order?' : 'Cancel this order?',
      body: anyReceived ? 'Copies already received stay in the catalog; the rest is no longer expected.' : 'The order will be cancelled and its funds released.',
      confirmLabel: anyReceived ? 'Close order' : 'Cancel order',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/acquisitions/orders/${id}/cancel`, { method: 'POST' });
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  async function removeLine(lineId: string) {
    try {
      await api(`/acquisitions/orders/${id}/lines/${lineId}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  if (order.isLoading) return <LoadingBlock />;
  if (!order.data) return <ErrorMessage error={order.error} />;
  const o = order.data;
  const draft = o.status === 'DRAFT';
  const receivable = o.status === 'ORDERED' || o.status === 'PARTIALLY_RECEIVED';

  return (
    <>
      {dialog}
      {confirmDialog}
      <PageHeader
        back={{ to: '/staff/acquisitions', label: 'Acquisitions' }}
        title={<span className="font-mono">{o.orderNumber}</span>}
        description={<span className="flex items-center gap-2"><Badge tone={ORDER_TONE[o.status]}>{orderLabel(o.status)}</Badge> {o.vendor.name}</span>}
        actions={
          <>
            {draft && <Button variant="secondary" onClick={() => setAddingLine(true)}><Plus className="size-4" /> Add title</Button>}
            {draft && <Button onClick={place} disabled={!o.lines.length}><Send className="size-4" /> Place order</Button>}
            {receivable && <Button variant="success" onClick={() => setReceiving(true)}><PackageCheck className="size-4" /> Receive</Button>}
            {(draft || receivable) && <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={cancel}><XCircle className="size-4" /> {o.lines.some((l) => l.quantityReceived) ? 'Close' : 'Cancel'}</Button>}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Order total" value={formatMoney(o.totals.total, currency)} />
        <Stat label="Received value" value={formatMoney(o.totals.received, currency)} tone="green" />
        <Stat label="Copies" value={`${o.totals.copiesReceived} / ${o.totals.copies}`} hint="received / ordered" />
        <Stat label="Vendor discount" value={o.vendor.discountPercent ? `${Number(o.vendor.discountPercent)}%` : '—'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Titles on this order" />
          {o.lines.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No titles yet. <button className="text-brand-600 hover:underline" onClick={() => setAddingLine(true)}>Add a title</button>.</div>
          ) : (
            <Table>
              <THead><Th>Title</Th><Th>Fund</Th><Th>Type</Th><Th>Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Line total</Th><Th /></THead>
              <TBody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <Link to={`/staff/catalog/${l.biblio.id}`} className="font-medium hover:underline">{l.biblio.title}</Link>
                      <div className="text-xs text-slate-500">{[l.biblio.authors[0], l.biblio.isbn13].filter(Boolean).join(' · ')}</div>
                      {l.items.length > 0 && <div className="mt-1 font-mono text-xs text-emerald-700">{l.items.map((i) => i.barcode).join(', ')}</div>}
                    </Td>
                    <Td className="font-mono text-xs">{l.fund?.code ?? '—'}</Td>
                    <Td>{l.itemType.name}</Td>
                    <Td className="tabular-nums">{l.quantityReceived}/{l.quantity}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.unitPrice, currency)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.quantity * Number(l.unitPrice), currency)}</Td>
                    <Td>{draft && <Button size="sm" variant="ghost" onClick={() => removeLine(l.id)} aria-label="Remove line"><Trash2 className="size-3.5" /></Button>}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card className="self-start p-4">
          <DescriptionList
            items={[
              { label: 'Vendor', value: o.vendor.name },
              { label: 'Vendor email', value: o.vendor.email },
              { label: 'Receiving branch', value: o.branch.name },
              { label: 'Created', value: `${formatDate(o.createdAt)}${o.createdBy ? ` by ${fullName(o.createdBy)}` : ''}` },
              { label: 'Ordered', value: o.orderedAt && formatDate(o.orderedAt) },
              { label: 'Expected', value: o.expectedAt && formatDate(o.expectedAt) },
              { label: 'Closed', value: o.closedAt && formatDate(o.closedAt) },
              { label: 'Notes', value: o.notes },
            ]}
          />
        </Card>
      </div>
      {addingLine && <AddLineModal orderId={o.id} onClose={() => setAddingLine(false)} onDone={refresh} />}
      {receiving && <ReceiveModal order={o} onClose={() => setReceiving(false)} onDone={refresh} />}
    </>
  );
}

function AddLineModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => void }) {
  const itemTypes = useItemTypes();
  const funds = useQuery({ queryKey: ['funds'], queryFn: () => api<Fund[]>('/acquisitions/funds') });
  const [biblio, setBiblio] = useState<BiblioSummary | null>(null);
  const [f, setF] = useState({ itemTypeId: '', fundId: '', quantity: '1', unitPrice: '', notes: '' });
  const itemTypeId = f.itemTypeId || itemTypes.data?.find((t) => t.code === 'BOOK')?.id || '';
  const add = useMutation({
    mutationFn: () => api(`/acquisitions/orders/${orderId}/lines`, { method: 'POST', body: { ...f, itemTypeId, biblioId: biblio?.id } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="Add a title to the order" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title" required hint={<>Not in the catalog yet? <Link className="text-brand-600 underline" to="/staff/catalog/new" target="_blank">Add it first</Link> (with 0 copies).</>}>
          <BiblioPicker value={biblio} onChange={setBiblio} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" required><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Unit price" required><Input inputMode="decimal" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></Field>
          <Field label="Item type">
            <Select value={itemTypeId} onChange={(e) => setF({ ...f, itemTypeId: e.target.value })}>
              {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Fund">
            <Select value={f.fundId} onChange={(e) => setF({ ...f, fundId: e.target.value })}>
              <option value="">No fund</option>
              {funds.data?.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
            </Select>
          </Field>
        </div>
        <ErrorMessage error={add.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!biblio || !f.unitPrice} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
      </ModalFooter>
    </Modal>
  );
}

function ReceiveModal({ order, onClose, onDone }: { order: OrderDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const open = order.lines.filter((l) => l.quantityReceived < l.quantity);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, String(l.quantity - l.quantityReceived)])));
  const [status, setStatus] = useState('IN_PROCESSING');
  const receive = useMutation({
    mutationFn: () =>
      api<{ items: { barcode: string }[] }>(`/acquisitions/orders/${order.id}/receive`, {
        method: 'POST',
        body: { status, lines: open.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ lineId: l.id, quantity: Number(qty[l.id]) })) },
      }),
    onSuccess: (r) => {
      toast.success(`Received ${r.items.length} cop${r.items.length === 1 ? 'y' : 'ies'}: ${r.items.map((i) => i.barcode).join(', ')}`);
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="Receive delivery" onClose={onClose} size="lg">
      <p className="mb-3 text-sm text-slate-600">Enter how many copies arrived. Each copy is added to the catalog with a new barcode at {order.branch.name}.</p>
      <Table>
        <THead><Th>Title</Th><Th>Outstanding</Th><Th>Arrived</Th></THead>
        <TBody>
          {open.map((l) => (
            <tr key={l.id}>
              <Td>{l.biblio.title}</Td>
              <Td className="tabular-nums">{l.quantity - l.quantityReceived}</Td>
              <Td className="w-28"><Input type="number" min={0} max={l.quantity - l.quantityReceived} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <div className="mt-4 max-w-xs">
        <Field label="New copies start as">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="IN_PROCESSING">In processing (label & cover first)</option>
            <option value="AVAILABLE">Available</option>
          </Select>
        </Field>
      </div>
      <ErrorMessage error={receive.error} className="mt-3" />
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="success" loading={receive.isPending} onClick={() => receive.mutate()}>Receive</Button>
      </ModalFooter>
    </Modal>
  );
}
