import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Bookmark, CalendarPlus, CreditCard, Mail, Pencil, Printer, Receipt, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, fullName, relativeDays } from '@/lib/format';
import { usePaymentMethods, usePublicSettings, useTitle } from '@/lib/hooks';
import type { Fine, Hold, Paged, PatronSummary, User } from '@/lib/types';
import { Barcode } from '@/components/Barcode';
import { OverrideCancelled, useConfirm, useOverridable } from '@/components/dialogs';
import { PatronPanel } from '@/components/PatronPanel';
import { useToast } from '@/components/toast';
import { UserModal } from '@/components/UserModal';
import {
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  ModalFooter,
  PageHeader,
  Pagination,
  Select,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tabs,
} from '@/components/ui';
import { HoldTable, PlaceHoldModal } from '../circulation/HoldsPage';
import { FINE_TYPE } from '../circulation/FinesPage';

type Tab = 'loans' | 'holds' | 'fines' | 'history' | 'notices' | 'profile';

export function PatronDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'loans';
  const toast = useToast();
  const queryClient = useQueryClient();
  const { run, dialog } = useOverridable();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [placingHold, setPlacingHold] = useState(false);
  const [printing, setPrinting] = useState(false);

  const summary = useQuery({ queryKey: ['patron', id], queryFn: () => api<PatronSummary>(`/patrons/${id}`) });
  const user = useQuery({ queryKey: ['users', id], queryFn: () => api<User>(`/users/${id}`) });
  useTitle(summary.data ? fullName(summary.data.patron) : 'Patron');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['patron', id] });
    queryClient.invalidateQueries({ queryKey: ['patron-fines', id] });
  };

  async function renewLoan(loanId: string) {
    try {
      const loan = await run((override) => api<{ dueAt: string }>(`/circulation/loans/${loanId}/renew`, { method: 'POST', body: { override } }), 'Renew anyway?');
      toast.success(`Renewed until ${formatDate(loan.dueAt)}.`);
      refresh();
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err);
    }
  }

  async function renewAll() {
    for (const l of summary.data?.loans ?? []) await renewLoan(l.id);
  }

  async function markLost(itemId: string, title: string) {
    const ok = await confirm({ title: 'Mark as lost?', body: <>The loan of <b>{title}</b> is closed and the patron is charged the replacement cost. The charge is waived if the item is returned.</>, confirmLabel: 'Mark lost', danger: true });
    if (!ok) return;
    try {
      await api(`/catalog/items/${itemId}/status`, { method: 'POST', body: { status: 'LOST', note: 'Reported lost by patron' } });
      toast.success('Marked lost and replacement charged.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  async function renewMembership() {
    try {
      const r = await api<{ expiresAt: string }>(`/patrons/${id}/renew-membership`, { method: 'POST' });
      toast.success(`Membership extended to ${formatDate(r.expiresAt)}.`);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['users', id] });
    } catch (err) {
      toast.error(err);
    }
  }

  async function cancelHold(h: Hold) {
    const ok = await confirm({ title: 'Cancel hold?', body: <>Cancel the hold on <b>{h.biblio.title}</b>?</>, confirmLabel: 'Cancel hold', danger: true });
    if (!ok) return;
    try {
      await api(`/holds/${h.id}/cancel`, { method: 'POST' });
      toast.success('Hold cancelled.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  if (summary.isLoading) return <LoadingBlock />;
  if (summary.error || !summary.data) return <ErrorMessage error={summary.error} />;
  const s = summary.data;
  const p = s.patron;
  const setTab = (t: Tab) => setParams({ tab: t });

  return (
    <>
      {dialog}
      {confirmDialog}
      <PageHeader
        back={{ to: '/staff/patrons', label: 'Patrons' }}
        title={fullName(p)}
        actions={
          <>
            <Button onClick={() => navigate(`/staff/circulation?mode=checkout&patron=${p.id}`)}><ArrowLeftRight className="size-4" /> Check out</Button>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={!user.data}><Pencil className="size-4" /> Edit</Button>
            <Button variant="secondary" onClick={renewMembership}><CalendarPlus className="size-4" /> Renew membership</Button>
            <Button variant="secondary" onClick={() => setPrinting(true)}><CreditCard className="size-4" /> Library card</Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="self-start p-4">
          <PatronPanel summary={s} />
        </Card>
        <Card className="min-w-0">
          <Tabs<Tab>
            className="px-4 pt-2"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'loans', label: 'Checkouts', count: s.loans.length },
              { value: 'holds', label: 'Holds', count: s.holds.length },
              { value: 'fines', label: 'Fines', count: undefined },
              { value: 'history', label: 'History', count: s.totalLoans },
              { value: 'notices', label: 'Notices' },
              { value: 'profile', label: 'Profile' },
            ]}
          />
          {tab === 'loans' &&
            (s.loans.length ? (
              <>
                <div className="flex justify-end border-b border-slate-100 px-4 py-2">
                  <Button size="sm" variant="secondary" onClick={renewAll}><RefreshCw className="size-3.5" /> Renew all</Button>
                </div>
                <Table>
                  <THead><Th>Title</Th><Th>Checked out</Th><Th>Due</Th><Th className="text-right">Fine so far</Th><Th /></THead>
                  <TBody>
                    {s.loans.map((l) => (
                      <tr key={l.id} className={l.overdue ? 'bg-red-50/40' : undefined}>
                        <Td>
                          <Link to={`/staff/catalog/${l.item.biblio.id}`} className="font-medium hover:underline">{l.item.biblio.title}</Link>
                          <div className="font-mono text-xs text-slate-500">{l.item.barcode}</div>
                        </Td>
                        <Td>{formatDate(l.checkedOutAt)}</Td>
                        <Td>
                          <div className={l.overdue ? 'font-medium text-red-600' : ''}>{formatDate(l.dueAt)}</div>
                          <div className="text-xs text-slate-500">{l.overdue ? <Badge tone="red">Overdue</Badge> : relativeDays(l.dueAt)}{l.renewals > 0 && ` · renewed ${l.renewals}×`}</div>
                        </Td>
                        <Td className="text-right tabular-nums">{l.accruedFine ? formatMoney(l.accruedFine, s.currency) : '—'}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <Button size="sm" variant="secondary" onClick={() => renewLoan(l.id)}>Renew</Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => markLost(l.item.id, l.item.biblio.title)}>Lost</Button>
                        </Td>
                      </tr>
                    ))}
                  </TBody>
                </Table>
              </>
            ) : (
              <EmptyState title="Nothing checked out" action={<Button onClick={() => navigate(`/staff/circulation?mode=checkout&patron=${p.id}`)}>Check out items</Button>} />
            ))}

          {tab === 'holds' && (
            <>
              <div className="flex justify-end border-b border-slate-100 px-4 py-2">
                <Button size="sm" variant="secondary" onClick={() => setPlacingHold(true)}><Bookmark className="size-3.5" /> Place hold</Button>
              </div>
              {s.holds.length ? <HoldTable holds={s.holds} onCancel={cancelHold} showItem /> : <EmptyState title="No active holds" />}
            </>
          )}

          {tab === 'fines' && <FinesTab patronId={p.id} currency={s.currency} onChange={refresh} />}
          {tab === 'history' && <HistoryTab patronId={p.id} />}
          {tab === 'notices' && <NoticesTab patronId={p.id} />}
          {tab === 'profile' && (
            <div className="p-4">
              <DescriptionList
                items={[
                  { label: 'Email', value: p.email },
                  { label: 'Phone', value: p.phone },
                  { label: 'Address', value: p.address },
                  { label: 'Date of birth', value: p.dateOfBirth ? formatDate(p.dateOfBirth) : null },
                  { label: 'Card number', value: p.cardNumber },
                  { label: 'Category', value: p.patronCategory?.name },
                  { label: 'Home branch', value: p.homeBranch?.name },
                  { label: 'Member since', value: formatDate(p.createdAt) },
                  { label: 'Membership expires', value: formatDate(p.expiresAt) },
                  { label: 'Last online sign-in', value: p.lastLoginAt ? formatDateTime(p.lastLoginAt) : 'Never' },
                  { label: 'Total loans', value: s.totalLoans },
                ]}
              />
            </div>
          )}
        </Card>
      </div>

      {editing && user.data && <UserModal user={user.data} onClose={() => setEditing(false)} onSaved={() => { refresh(); queryClient.invalidateQueries({ queryKey: ['users', id] }); }} />}
      {placingHold && user.data && <PlaceHoldModal patron={user.data} onClose={() => { setPlacingHold(false); refresh(); }} />}
      {printing && <LibraryCardModal summary={s} onClose={() => setPrinting(false)} />}
    </>
  );
}

function FinesTab({ patronId, currency, onChange }: { patronId: string; currency: string; onChange: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [charging, setCharging] = useState(false);
  const fines = useQuery({ queryKey: ['patron-fines', patronId], queryFn: () => api<Paged<Fine>>('/fines', { query: { patronId, pageSize: 100 } }) });
  const outstanding = fines.data?.data.filter((f) => f.status === 'OUTSTANDING') ?? [];
  const selectedTotal = outstanding.filter((f) => selected.includes(f.id)).reduce((s, f) => s + Number(f.outstanding), 0);
  const total = outstanding.reduce((s, f) => s + Number(f.outstanding), 0);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['patron-fines', patronId] });
    setSelected([]);
    onChange();
  };

  async function waive(f: Fine) {
    const ok = await confirm({ title: 'Waive this charge?', body: `${FINE_TYPE[f.type]}: ${f.description} (${formatMoney(f.outstanding, currency)})`, confirmLabel: 'Waive' });
    if (!ok) return;
    try {
      await api(`/fines/${f.id}/waive`, { method: 'POST', body: { reason: 'Waived by staff' } });
      toast.success('Charge waived.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div className="text-sm">
          Outstanding: <b className={total > 0 ? 'text-red-600' : ''}>{formatMoney(total, currency)}</b>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setCharging(true)}>Add charge</Button>
          <Button size="sm" variant="success" disabled={total <= 0} onClick={() => setPaying(true)}>
            <Receipt className="size-3.5" /> {selected.length ? `Pay selected (${formatMoney(selectedTotal, currency)})` : 'Take payment'}
          </Button>
        </div>
      </div>
      {fines.isLoading ? (
        <LoadingBlock />
      ) : !fines.data?.data.length ? (
        <EmptyState title="No fines or charges" />
      ) : (
        <Table>
          <THead><Th /><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th className="text-right">Outstanding</Th><Th /></THead>
          <TBody>
            {fines.data.data.map((f) => (
              <tr key={f.id}>
                <Td>
                  {f.status === 'OUTSTANDING' && (
                    <input
                      type="checkbox"
                      aria-label="Select charge"
                      className="size-4 rounded border-slate-300"
                      checked={selected.includes(f.id)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))}
                    />
                  )}
                </Td>
                <Td className="whitespace-nowrap">{formatDate(f.createdAt)}</Td>
                <Td>{FINE_TYPE[f.type]}</Td>
                <Td className="text-slate-600">{f.description}</Td>
                <Td><Badge tone={f.status === 'OUTSTANDING' ? 'red' : f.status === 'PAID' ? 'green' : 'gray'}>{f.status.toLowerCase()}</Badge></Td>
                <Td className="text-right tabular-nums">{formatMoney(f.amount, currency)}</Td>
                <Td className="text-right font-medium tabular-nums">{formatMoney(f.outstanding, currency)}</Td>
                <Td className="text-right">{f.status === 'OUTSTANDING' && <Button size="sm" variant="ghost" onClick={() => waive(f)}>Waive</Button>}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {paying && <PaymentModal patronId={patronId} currency={currency} amount={selected.length ? selectedTotal : total} fineIds={selected.length ? selected : undefined} onClose={() => setPaying(false)} onDone={refresh} />}
      {charging && <ChargeModal patronId={patronId} onClose={() => setCharging(false)} onDone={refresh} />}
    </>
  );
}

function PaymentModal({ patronId, currency, amount, fineIds, onClose, onDone }: { patronId: string; currency: string; amount: number; fineIds?: string[]; onClose: () => void; onDone: () => void }) {
  const methods = usePaymentMethods();
  const toast = useToast();
  const [value, setValue] = useState(amount.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const pay = useMutation({
    mutationFn: () => api<{ remainingBalance: number }>('/fines/pay', { method: 'POST', body: { patronId, amount: Number(value), method, fineIds } }),
    onSuccess: (r) => {
      toast.success(`Payment of ${formatMoney(value, currency)} recorded. Remaining balance ${formatMoney(r.remainingBalance, currency)}.`);
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="Take payment" onClose={onClose} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); pay.mutate(); }} className="space-y-4">
        <Field label={`Amount (${currency})`} hint={`Owed: ${formatMoney(amount, currency)}. Partial payments are applied oldest first.`}>
          <Input inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.data?.map((m) => <option key={m} value={m}>{m.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
        </Field>
        <ErrorMessage error={pay.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="success" loading={pay.isPending}>Record payment</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function ChargeModal({ patronId, onClose, onDone }: { patronId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ type: 'MANUAL', amount: '', description: '' });
  const charge = useMutation({
    mutationFn: () => api('/fines', { method: 'POST', body: { ...f, patronId } }),
    onSuccess: () => {
      toast.success('Charge added. The patron has been notified.');
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="Add a charge" onClose={onClose} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); charge.mutate(); }} className="space-y-4">
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="MANUAL">Other charge</option>
            <option value="DAMAGE">Damage</option>
            <option value="LOST">Lost item</option>
          </Select>
        </Field>
        <Field label="Amount" required>
          <Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
        </Field>
        <Field label="Description" required>
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required />
        </Field>
        <ErrorMessage error={charge.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={charge.isPending}>Add charge</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function HistoryTab({ patronId }: { patronId: string }) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['patron', patronId, 'history', page],
    queryFn: () =>
      api<Paged<{ id: string; checkedOutAt: string; dueAt: string; returnedAt: string; item: { barcode: string; biblio: { id: string; title: string } } }>>(`/patrons/${patronId}/history`, { query: { page, pageSize: 20 } }),
  });
  if (history.isLoading) return <LoadingBlock />;
  if (!history.data?.data.length) return <EmptyState title="No past loans" />;
  return (
    <>
      <Table>
        <THead><Th>Title</Th><Th>Checked out</Th><Th>Due</Th><Th>Returned</Th></THead>
        <TBody>
          {history.data.data.map((l) => (
            <tr key={l.id}>
              <Td>
                <Link to={`/staff/catalog/${l.item.biblio.id}`} className="hover:underline">{l.item.biblio.title}</Link>
                <div className="font-mono text-xs text-slate-500">{l.item.barcode}</div>
              </Td>
              <Td>{formatDate(l.checkedOutAt)}</Td>
              <Td>{formatDate(l.dueAt)}</Td>
              <Td className={new Date(l.returnedAt) > new Date(l.dueAt) ? 'text-red-600' : ''}>{formatDate(l.returnedAt)}</Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <Pagination page={history.data.page} totalPages={history.data.totalPages} total={history.data.total} onChange={setPage} />
    </>
  );
}

function NoticesTab({ patronId }: { patronId: string }) {
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const notices = useQuery({
    queryKey: ['patron', patronId, 'notices', page],
    queryFn: () => api<Paged<{ id: string; type: string; channel: string; status: string; subject: string; body: string; createdAt: string; error: string | null }>>(`/patrons/${patronId}/notices`, { query: { page, pageSize: 20 } }),
  });
  return (
    <>
      <div className="flex justify-end border-b border-slate-100 px-4 py-2">
        <Button size="sm" variant="secondary" onClick={() => setComposing(true)}><Mail className="size-3.5" /> Send message</Button>
      </div>
      {notices.isLoading ? (
        <LoadingBlock />
      ) : !notices.data?.data.length ? (
        <EmptyState title="No notices sent yet" />
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {notices.data.data.map((n) => (
              <li key={n.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{n.subject}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <Badge tone={n.channel === 'EMAIL' ? 'blue' : 'gray'}>{n.channel === 'EMAIL' ? 'email' : 'in-app'}</Badge>
                    {n.status === 'FAILED' && <Badge tone="red">failed</Badge>}
                    {formatDateTime(n.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{n.body}</p>
                {n.error && <p className="mt-1 text-xs text-red-600">{n.error}</p>}
              </li>
            ))}
          </ul>
          <Pagination page={notices.data.page} totalPages={notices.data.totalPages} total={notices.data.total} onChange={setPage} />
        </>
      )}
      {composing && <ComposeModal patronId={patronId} onClose={() => setComposing(false)} />}
    </>
  );
}

function ComposeModal({ patronId, onClose }: { patronId: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => api('/notices', { method: 'POST', body: { patronId, subject, body } }),
    onSuccess: () => {
      toast.success('Message sent.');
      queryClient.invalidateQueries({ queryKey: ['patron', patronId, 'notices'] });
      onClose();
    },
  });
  return (
    <Modal open title="Send a message" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-4">
        <Field label="Subject" required><Input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} required /></Field>
        <Field label="Message" required hint="Shown in the patron's online account, and emailed if email is configured."><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} required /></Field>
        <ErrorMessage error={send.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={send.isPending}>Send</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function LibraryCardModal({ summary, onClose }: { summary: PatronSummary; onClose: () => void }) {
  const settings = usePublicSettings();
  const p = summary.patron;
  return (
    <Modal open title="Library card" onClose={onClose} size="sm">
      <div className="flex justify-center">
        <div id="library-card" className="w-[340px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm print:shadow-none">
          <div className="bg-brand-900 px-4 py-2 text-white">
            <div className="text-sm font-semibold">{settings.data?.libraryName ?? 'Library'}</div>
            <div className="text-[10px] text-brand-100">Library card</div>
          </div>
          <div className="space-y-1 px-4 py-3">
            <div className="text-lg font-semibold text-slate-900">{fullName(p)}</div>
            <div className="text-xs text-slate-600">
              {p.patronCategory?.name}
              {p.expiresAt && ` · valid until ${formatDate(p.expiresAt)}`}
            </div>
            {p.cardNumber && (
              <div className="flex justify-center pt-2">
                <Barcode value={p.cardNumber} height={46} width={1.8} />
              </div>
            )}
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={() => printCard()}><Printer className="size-4" /> Print card</Button>
      </ModalFooter>
    </Modal>
  );
}

/** Prints only the card by copying it into a minimal print window. */
function printCard() {
  const card = document.getElementById('library-card');
  if (!card) return;
  const win = window.open('', '_blank', 'width=420,height=360');
  if (!win) return window.print();
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('');
  win.document.write(`<!doctype html><html><head><title>Library card</title>${styles}</head><body style="padding:16px">${card.outerHTML}</body></html>`);
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
    win.close();
  };
}
