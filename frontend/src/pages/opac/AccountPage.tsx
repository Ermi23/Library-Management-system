import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, relativeDays } from '@/lib/format';
import { useTitle } from '@/lib/hooks';
import type { Paged } from '@/lib/types';
import { useToast } from '@/components/toast';
import { Alert, Badge, BookCover, Button, Card, EmptyState, ErrorMessage, Field, Input, LoadingBlock, Pagination, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

interface Account {
  user: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    cardNumber: string | null;
    status: string;
    expiresAt: string | null;
    patronCategory: { name: string } | null;
    homeBranch: { name: string } | null;
  };
  loans: {
    id: string;
    dueAt: string;
    checkedOutAt: string;
    renewals: number;
    overdue: boolean;
    accruedFine: number;
    canRenew: boolean;
    renewalsLeft: number;
    item: { barcode: string; biblio: { id: string; title: string; authors: string[]; coverUrl: string | null } };
  }[];
  holds: { id: string; status: string; placedAt: string; expiresAt: string | null; position: number | null; biblio: { id: string; title: string; authors: string[] }; pickupBranch: { name: string } }[];
  fines: { id: string; type: string; description: string | null; amount: string; outstanding: string; createdAt: string }[];
  outstanding: number;
  unreadNotices: number;
  currency: string;
}

type Tab = 'loans' | 'holds' | 'fines' | 'history' | 'messages' | 'profile';

export function AccountPage() {
  useTitle('My account');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('loans');
  const account = useQuery({ queryKey: ['opac', 'account'], queryFn: () => api<Account>('/opac/account') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['opac', 'account'] });

  async function renew(id: string) {
    try {
      const loan = await api<{ dueAt: string }>(`/opac/loans/${id}/renew`, { method: 'POST' });
      toast.success(`Renewed. Now due ${formatDate(loan.dueAt)}.`);
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  async function cancelHold(id: string) {
    try {
      await api(`/opac/holds/${id}/cancel`, { method: 'POST' });
      toast.success('Hold cancelled.');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  if (account.isLoading) return <LoadingBlock />;
  if (!account.data) return <div className="mx-auto max-w-5xl p-6"><ErrorMessage error={account.error} /></div>;
  const a = account.data;
  const expired = a.user.expiresAt && new Date(a.user.expiresAt) < new Date();
  const ready = a.holds.filter((h) => h.status === 'READY');
  const overdue = a.loans.filter((l) => l.overdue);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Hello, {a.user.firstName}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <CreditCard className="size-4" /> Card <span className="font-mono">{a.user.cardNumber}</span>
            {a.user.patronCategory && <> · {a.user.patronCategory.name}</>}
            {a.user.expiresAt && <> · {expired ? <span className="text-red-600">expired {formatDate(a.user.expiresAt)}</span> : `valid until ${formatDate(a.user.expiresAt)}`}</>}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2"><div className="text-lg font-semibold">{a.loans.length}</div><div className="text-xs text-slate-500">Borrowed</div></div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2"><div className="text-lg font-semibold">{a.holds.length}</div><div className="text-xs text-slate-500">Holds</div></div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2"><div className={`text-lg font-semibold ${a.outstanding > 0 ? 'text-red-600' : ''}`}>{formatMoney(a.outstanding, a.currency)}</div><div className="text-xs text-slate-500">Owed</div></div>
        </div>
      </div>

      <div className="mb-6 space-y-3">
        {ready.length > 0 && <Alert tone="green" title={`${ready.length} hold${ready.length === 1 ? ' is' : 's are'} ready to collect`}>{ready.map((h) => <div key={h.id}>{h.biblio.title} at {h.pickupBranch.name}{h.expiresAt && `, by ${formatDate(h.expiresAt)}`}</div>)}</Alert>}
        {overdue.length > 0 && <Alert tone="red" icon={<AlertTriangle className="size-4" />} title={`${overdue.length} item${overdue.length === 1 ? ' is' : 's are'} overdue`}>Please return them as soon as possible. Fines are accruing.</Alert>}
        {expired && <Alert tone="amber" title="Your membership has expired">Visit the library to renew it.</Alert>}
      </div>

      <Card>
        <Tabs<Tab>
          className="px-4 pt-2"
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === 'messages' && a.unreadNotices) api('/opac/account/notices/read', { method: 'POST' }).then(refresh);
          }}
          tabs={[
            { value: 'loans', label: 'Checked out', count: a.loans.length },
            { value: 'holds', label: 'Holds', count: a.holds.length },
            { value: 'fines', label: 'Fines', count: a.fines.length },
            { value: 'history', label: 'Reading history' },
            { value: 'messages', label: 'Messages', count: a.unreadNotices || undefined },
            { value: 'profile', label: 'My details' },
          ]}
        />
        {tab === 'loans' &&
          (a.loans.length ? (
            <ul className="divide-y divide-slate-100">
              {a.loans.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-4 p-4">
                  <BookCover url={l.item.biblio.coverUrl} title={l.item.biblio.title} className="h-16 w-11" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/record/${l.item.biblio.id}`} className="font-medium text-slate-900 hover:underline">{l.item.biblio.title}</Link>
                    <div className="text-sm text-slate-600">{l.item.biblio.authors[0]}</div>
                    <div className={`mt-1 text-sm ${l.overdue ? 'font-medium text-red-600' : 'text-slate-600'}`}>
                      Due {formatDate(l.dueAt)} ({relativeDays(l.dueAt)}){l.accruedFine > 0 && ` · fine so far ${formatMoney(l.accruedFine, a.currency)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <Button size="sm" variant="secondary" disabled={!l.canRenew} onClick={() => renew(l.id)}>Renew</Button>
                    <div className="mt-1 text-xs text-slate-500">{l.canRenew ? `${l.renewalsLeft} renewal${l.renewalsLeft === 1 ? '' : 's'} left` : l.renewalsLeft === 0 ? 'No renewals left' : 'Someone is waiting for it'}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="You have nothing checked out" action={<Link to="/"><Button variant="secondary">Find something to read</Button></Link>} />
          ))}
        {tab === 'holds' &&
          (a.holds.length ? (
            <Table>
              <THead><Th>Title</Th><Th>Pickup</Th><Th>Status</Th><Th>Placed</Th><Th /></THead>
              <TBody>
                {a.holds.map((h) => (
                  <tr key={h.id}>
                    <Td><Link to={`/record/${h.biblio.id}`} className="font-medium hover:underline">{h.biblio.title}</Link></Td>
                    <Td>{h.pickupBranch.name}</Td>
                    <Td>
                      {h.status === 'READY' ? <Badge tone="green">Ready to collect</Badge> : h.status === 'IN_TRANSIT' ? <Badge tone="amber">On its way</Badge> : <Badge>Waiting · #{h.position} in queue</Badge>}
                      {h.status === 'READY' && h.expiresAt && <div className="mt-1 text-xs text-slate-500">Collect by {formatDate(h.expiresAt)}</div>}
                    </Td>
                    <Td>{formatDate(h.placedAt)}</Td>
                    <Td className="text-right"><Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => cancelHold(h.id)}>Cancel</Button></Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No holds" description="Reserve a title from its catalog page and we will tell you when it is ready." />
          ))}
        {tab === 'fines' &&
          (a.fines.length ? (
            <>
              <Table>
                <THead><Th>Date</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th className="text-right">Outstanding</Th></THead>
                <TBody>
                  {a.fines.map((f) => (
                    <tr key={f.id}>
                      <Td>{formatDate(f.createdAt)}</Td>
                      <Td>{f.description}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(f.amount, a.currency)}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatMoney(f.outstanding, a.currency)}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
              <p className="border-t border-slate-100 p-4 text-sm text-slate-600">Fines can be paid at any library desk.</p>
            </>
          ) : (
            <EmptyState title="You don't owe anything" />
          ))}
        {tab === 'history' && <HistoryTab />}
        {tab === 'messages' && <MessagesTab />}
        {tab === 'profile' && <ProfileTab account={a} onSaved={refresh} />}
      </Card>
    </div>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['opac', 'history', page],
    queryFn: () => api<Paged<{ id: string; checkedOutAt: string; returnedAt: string; item: { biblio: { id: string; title: string; authors: string[] } } }>>('/opac/account/history', { query: { page } }),
  });
  if (history.isLoading) return <LoadingBlock />;
  if (!history.data?.data.length) return <EmptyState title="No reading history yet" />;
  return (
    <>
      <Table>
        <THead><Th>Title</Th><Th>Borrowed</Th><Th>Returned</Th></THead>
        <TBody>
          {history.data.data.map((l) => (
            <tr key={l.id}>
              <Td><Link to={`/record/${l.item.biblio.id}`} className="hover:underline">{l.item.biblio.title}</Link><div className="text-xs text-slate-500">{l.item.biblio.authors[0]}</div></Td>
              <Td>{formatDate(l.checkedOutAt)}</Td>
              <Td>{formatDate(l.returnedAt)}</Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <Pagination page={history.data.page} totalPages={history.data.totalPages} onChange={setPage} />
    </>
  );
}

function MessagesTab() {
  const [page, setPage] = useState(1);
  const notices = useQuery({
    queryKey: ['opac', 'notices', page],
    queryFn: () => api<Paged<{ id: string; subject: string; body: string; createdAt: string; readAt: string | null }>>('/opac/account/notices', { query: { page } }),
  });
  if (notices.isLoading) return <LoadingBlock />;
  if (!notices.data?.data.length) return <EmptyState title="No messages" />;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {notices.data.data.map((n) => (
          <li key={n.id} className="px-4 py-3">
            <div className="flex justify-between gap-3">
              <span className="font-medium text-slate-900">{n.subject}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatDateTime(n.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{n.body}</p>
          </li>
        ))}
      </ul>
      <Pagination page={notices.data.page} totalPages={notices.data.totalPages} onChange={setPage} />
    </>
  );
}

function ProfileTab({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(account.user.phone ?? '');
  const [address, setAddress] = useState(account.user.address ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const save = useMutation({
    mutationFn: () => api('/opac/account', { method: 'PATCH', body: { phone, address } }),
    onSuccess: () => {
      toast.success('Details saved.');
      onSaved();
    },
  });
  const changePw = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: pw }),
    onSuccess: () => {
      toast.success('Password changed.');
      setPw({ currentPassword: '', newPassword: '' });
    },
  });
  return (
    <div className="grid gap-8 p-4 md:grid-cols-2">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <h3 className="font-semibold text-slate-900">Contact details</h3>
        <Field label="Email" hint="Ask library staff to change your email"><Input value={account.user.email ?? ''} disabled /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <ErrorMessage error={save.error} />
        <Button type="submit" loading={save.isPending}>Save</Button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }} className="space-y-4">
        <h3 className="font-semibold text-slate-900">Change password</h3>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={8} /></Field>
        <ErrorMessage error={changePw.error} />
        <Button type="submit" variant="secondary" loading={changePw.isPending}>Change password</Button>
      </form>
    </div>
  );
}
