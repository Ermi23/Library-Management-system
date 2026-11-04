import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, BookCheck, BookUp, CheckCircle2, Printer, RefreshCw, Search, Truck, UserRound, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney, fullName, relativeDays } from '@/lib/format';
import { useCurrency, usePublicSettings, useTitle } from '@/lib/hooks';
import type { PatronSummary, User } from '@/lib/types';
import { OverrideCancelled, useOverridable } from '@/components/dialogs';
import { PatronPanel } from '@/components/PatronPanel';
import { PatronPicker } from '@/components/pickers';
import { ScanInput, type ScanInputHandle } from '@/components/ScanInput';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CardHeader, cn, EmptyState, Field, Input, LoadingBlock, PageHeader, Table, TBody, Td, Th, THead, Tabs } from '@/components/ui';

type Mode = 'checkout' | 'checkin' | 'renew';

export function CirculationPage() {
  useTitle('Circulation');
  const [params, setParams] = useSearchParams();
  const mode = (params.get('mode') as Mode) || 'checkout';
  return (
    <>
      <PageHeader title="Circulation desk" description="Scan library cards and item barcodes. Scanners that type and press Enter work out of the box." />
      <Tabs<Mode>
        className="mb-6 print:hidden"
        value={mode}
        onChange={(m) => setParams((p) => ({ ...Object.fromEntries(p), mode: m }))}
        tabs={[
          { value: 'checkout', label: <><BookUp className="size-4" /> Check out</> },
          { value: 'checkin', label: <><BookCheck className="size-4" /> Check in</> },
          { value: 'renew', label: <><RefreshCw className="size-4" /> Renew</> },
        ]}
      />
      {mode === 'checkout' && <Checkout />}
      {mode === 'checkin' && <Checkin />}
      {mode === 'renew' && <Renew />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Check out
// ---------------------------------------------------------------------------

interface SessionLoan {
  id: string;
  title: string;
  barcode: string;
  dueAt: string;
}

function Checkout() {
  const [params, setParams] = useSearchParams();
  const patronId = params.get('patron');
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const settings = usePublicSettings();
  const { run, dialog } = useOverridable();
  const [session, setSession] = useState<SessionLoan[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [searchByName, setSearchByName] = useState(false);
  const itemInput = useRef<ScanInputHandle>(null);

  const summary = useQuery({
    queryKey: ['circ-patron', patronId],
    queryFn: () => api<PatronSummary>(`/circulation/patrons/${patronId}/summary`),
    enabled: !!patronId,
  });

  function selectPatron(id: string | null) {
    setSession([]);
    setParams((p) => {
      const next = Object.fromEntries(p);
      if (id) next.patron = id;
      else delete next.patron;
      return next;
    });
  }

  async function findPatron(card: string) {
    try {
      const result = await api<PatronSummary>('/circulation/patrons/lookup', { query: { q: card } });
      queryClient.setQueryData(['circ-patron', result.patron.id], result);
      selectPatron(result.patron.id);
    } catch (err) {
      toast.error(err);
      throw err;
    }
  }

  async function checkoutItem(barcode: string) {
    if (!patronId) return;
    try {
      const result = await run(
        (override) =>
          api<{ loan: { id: string; dueAt: string; item: { barcode: string; biblio: { title: string } } }; holdFulfilled: boolean }>('/circulation/checkout', {
            method: 'POST',
            body: { patronId, barcode, override, dueAt: dueAt || undefined },
          }),
        'Check out anyway?',
      );
      setSession((s) => [{ id: result.loan.id, title: result.loan.item.biblio.title, barcode: result.loan.item.barcode, dueAt: result.loan.dueAt }, ...s]);
      toast.success(
        <>
          Checked out <b>{result.loan.item.biblio.title}</b>, due {formatDate(result.loan.dueAt)}.
          {result.holdFulfilled && ' Hold fulfilled.'}
        </>,
      );
      queryClient.invalidateQueries({ queryKey: ['circ-patron', patronId] });
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err);
      throw err;
    }
  }

  async function renewLoan(loanId: string) {
    try {
      const loan = await run((override) => api<{ dueAt: string }>(`/circulation/loans/${loanId}/renew`, { method: 'POST', body: { override } }), 'Renew anyway?');
      toast.success(`Renewed. New due date ${formatDate(loan.dueAt)}.`);
      queryClient.invalidateQueries({ queryKey: ['circ-patron', patronId] });
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err);
    }
  }

  if (!patronId) {
    return (
      <Card className="mx-auto max-w-2xl p-6">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
          <UserRound className="size-5 text-brand-600" /> Who is borrowing?
        </h2>
        <p className="mb-4 text-sm text-slate-500">Scan the patron&apos;s library card, or search by name.</p>
        {searchByName ? (
          <PatronPicker value={null} onChange={(u: User | null) => u && selectPatron(u.id)} autoFocus />
        ) : (
          <ScanInput onScan={findPatron} placeholder="Scan or type the library card number" buttonLabel="Find patron" />
        )}
        <button className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline" onClick={() => setSearchByName((v) => !v)}>
          <Search className="size-3.5" /> {searchByName ? 'Scan a card instead' : 'Search by name instead'}
        </button>
      </Card>
    );
  }

  if (summary.isLoading || !summary.data) {
    return summary.error ? (
      <Card className="p-6">
        <p className="text-sm text-red-600">{(summary.error as Error).message}</p>
        <Button className="mt-3" variant="secondary" onClick={() => selectPatron(null)}>
          Choose another patron
        </Button>
      </Card>
    ) : (
      <LoadingBlock />
    );
  }

  const s = summary.data;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_1fr] print:block">
      {dialog}
      <div className="space-y-4 print:hidden">
        <Card className="p-4">
          <PatronPanel summary={s} compact />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => selectPatron(null)}>
              <UserRound className="size-4" /> Next patron
            </Button>
            <Link to={`/staff/patrons/${s.patron.id}`}>
              <Button variant="ghost" size="sm">Patron record</Button>
            </Link>
            {s.outstanding > 0 && (
              <Link to={`/staff/patrons/${s.patron.id}?tab=fines`}>
                <Button variant="ghost" size="sm">Take payment</Button>
              </Link>
            )}
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-4 print:hidden">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <div className="mb-1 text-sm font-medium text-slate-700">Item barcode</div>
              <ScanInput ref={itemInput} onScan={checkoutItem} buttonLabel="Check out" />
            </div>
            <Field label="Due date (optional)" className="w-44" hint="Defaults to the loan rule">
              <Input type="date" value={dueAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
          </div>
          {session.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50">
              <div className="flex items-center justify-between px-3 py-2 text-sm font-medium text-emerald-800">
                <span>Checked out in this session ({session.length})</span>
                <Button size="sm" variant="secondary" onClick={() => window.print()}>
                  <Printer className="size-3.5" /> Print receipt
                </Button>
              </div>
              <ul className="divide-y divide-emerald-100 text-sm">
                {session.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="truncate">
                      <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-600" />
                      {l.title} <span className="font-mono text-xs text-slate-500">{l.barcode}</span>
                    </span>
                    <span className="shrink-0 text-slate-600">due {formatDate(l.dueAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="print:hidden">
          <CardHeader title={`Current loans (${s.loans.length})`} />
          {s.loans.length === 0 ? (
            <EmptyState title="No items on loan" />
          ) : (
            <Table>
              <THead>
                <Th>Title</Th>
                <Th>Barcode</Th>
                <Th>Due</Th>
                <Th className="text-right">Fine so far</Th>
                <Th />
              </THead>
              <TBody>
                {s.loans.map((l) => (
                  <tr key={l.id} className={l.overdue ? 'bg-red-50/40' : undefined}>
                    <Td>
                      <Link to={`/staff/catalog/${l.item.biblio.id}`} className="font-medium text-slate-900 hover:underline">
                        {l.item.biblio.title}
                      </Link>
                      {l.renewals > 0 && <div className="text-xs text-slate-500">Renewed {l.renewals}×</div>}
                    </Td>
                    <Td className="font-mono text-xs">{l.item.barcode}</Td>
                    <Td>
                      <div className={l.overdue ? 'font-medium text-red-600' : ''}>{formatDate(l.dueAt)}</div>
                      <div className="text-xs text-slate-500">{l.overdue ? <Badge tone="red">Overdue</Badge> : relativeDays(l.dueAt)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">{l.accruedFine ? formatMoney(l.accruedFine, currency) : '—'}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => renewLoan(l.id)}>
                        <RefreshCw className="size-3.5" /> Renew
                      </Button>
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Printed receipt (only visible when printing). */}
        <div className="hidden text-sm print:block">
          <h2 className="text-lg font-semibold">{settings.data?.libraryName}</h2>
          <p>Checkout receipt · {formatDate(new Date())}</p>
          <p className="mt-2">
            {fullName(s.patron)} · Card {s.patron.cardNumber}
          </p>
          <table className="mt-3 w-full">
            <tbody>
              {session.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 pr-4">{l.title}</td>
                  <td className="py-1 pr-4 font-mono">{l.barcode}</td>
                  <td className="py-1">Due {formatDate(l.dueAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4">Total items on loan: {s.loans.length}. Thank you!</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check in
// ---------------------------------------------------------------------------

interface CheckinResult {
  item: { id: string; barcode: string; callNumber: string | null; biblio: { id: string; title: string }; status: string };
  loan: { dueAt: string; wasOverdue: boolean } | null;
  patron: { id: string; firstName: string; lastName: string; cardNumber: string | null } | null;
  fine: { amount: string; description: string } | null;
  route: {
    action: 'RESHELVE' | 'HOLD_SHELF' | 'TRANSFER_FOR_HOLD' | 'TRANSFER_HOME' | 'KEEP_ASIDE';
    message: string;
    hold?: { patronName: string; cardNumber: string | null; pickupBranch: string; expiresAt?: string | null };
    toBranch?: { name: string };
  };
  messages: string[];
}

const ACTION_STYLE: Record<CheckinResult['route']['action'], { label: string; className: string; icon: typeof CheckCircle2 }> = {
  RESHELVE: { label: 'Reshelve', className: 'border-emerald-300 bg-emerald-50 text-emerald-900', icon: CheckCircle2 },
  HOLD_SHELF: { label: 'Hold shelf', className: 'border-violet-300 bg-violet-50 text-violet-900', icon: BookCheck },
  TRANSFER_FOR_HOLD: { label: 'Transfer for hold', className: 'border-amber-300 bg-amber-50 text-amber-900', icon: Truck },
  TRANSFER_HOME: { label: 'Send home', className: 'border-amber-300 bg-amber-50 text-amber-900', icon: ArrowRightLeft },
  KEEP_ASIDE: { label: 'Keep aside', className: 'border-slate-300 bg-slate-50 text-slate-900', icon: XCircle },
};

function Checkin() {
  const toast = useToast();
  const currency = useCurrency();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<CheckinResult[]>([]);

  async function checkin(barcode: string) {
    try {
      const result = await api<CheckinResult>('/circulation/checkin', { method: 'POST', body: { barcode } });
      setResults((r) => [result, ...r].slice(0, 50));
      queryClient.invalidateQueries({ queryKey: ['circ-patron'] });
    } catch (err) {
      toast.error(err);
      throw err;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="p-4">
        <div className="mb-1 text-sm font-medium text-slate-700">Item barcode</div>
        <ScanInput onScan={checkin} buttonLabel="Check in" />
        <p className="mt-2 text-xs text-slate-500">
          Returns are processed at your working branch. Holds are trapped automatically and copies from other branches are routed home.
        </p>
      </Card>
      {results.length === 0 ? (
        <Card>
          <EmptyState icon={<BookCheck className="size-10" />} title="Scan returned items" description="Each return shows what to do with the item next." />
        </Card>
      ) : (
        results.map((r, i) => {
          const style = ACTION_STYLE[r.route.action];
          const Icon = style.icon;
          return (
            <Card key={`${r.item.id}-${results.length - i}`} className={cn('overflow-hidden', i === 0 && 'ring-2 ring-brand-500/30')}>
              <div className={cn('flex items-start gap-3 border-b px-4 py-3', style.className)}>
                <Icon className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">{style.label}</div>
                  <div className="text-sm">{r.route.message}</div>
                  {r.route.hold && (
                    <div className="mt-1 text-sm">
                      Patron: <b>{r.route.hold.patronName}</b> {r.route.hold.cardNumber && <span className="font-mono">({r.route.hold.cardNumber})</span>} · Pickup:{' '}
                      {r.route.hold.pickupBranch}
                      {r.route.hold.expiresAt && <> · Hold until {formatDate(r.route.hold.expiresAt)}</>}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <Link to={`/staff/catalog/${r.item.biblio.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.item.biblio.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{r.item.barcode}</span>
                    {r.item.callNumber && <> · {r.item.callNumber}</>}
                  </div>
                  {r.patron && (
                    <div className="mt-1 text-xs text-slate-600">
                      Returned by{' '}
                      <Link to={`/staff/patrons/${r.patron.id}`} className="text-brand-600 hover:underline">
                        {fullName(r.patron)}
                      </Link>
                      {r.loan?.wasOverdue && <Badge tone="red" className="ml-2">Was overdue</Badge>}
                    </div>
                  )}
                  {r.messages.map((m) => (
                    <div key={m} className="mt-1 text-xs text-slate-600">
                      • {m}
                    </div>
                  ))}
                </div>
                {r.fine && (
                  <div className="self-start rounded-lg bg-red-50 px-3 py-2 text-right text-red-700">
                    <div className="text-xs">Fine charged</div>
                    <div className="font-semibold tabular-nums">{formatMoney(r.fine.amount, currency)}</div>
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

function Renew() {
  const toast = useToast();
  const { run, dialog } = useOverridable();
  const [results, setResults] = useState<{ id: string; title: string; barcode: string; dueAt: string; renewals: number }[]>([]);

  async function renew(barcode: string) {
    try {
      const loan = await run(
        (override) =>
          api<{ id: string; dueAt: string; renewals: number; item: { barcode: string; biblio: { title: string } } }>('/circulation/renew', {
            method: 'POST',
            body: { barcode, override },
          }),
        'Renew anyway?',
      );
      setResults((r) => [{ id: loan.id, title: loan.item.biblio.title, barcode: loan.item.barcode, dueAt: loan.dueAt, renewals: loan.renewals }, ...r]);
    } catch (err) {
      if (!(err instanceof OverrideCancelled)) toast.error(err instanceof ApiError ? err.message : err);
      throw err;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {dialog}
      <Card className="p-4">
        <div className="mb-1 text-sm font-medium text-slate-700">Item barcode</div>
        <ScanInput onScan={renew} buttonLabel="Renew" />
      </Card>
      {results.length > 0 && (
        <Card>
          <Table>
            <THead>
              <Th>Title</Th>
              <Th>Barcode</Th>
              <Th>New due date</Th>
              <Th>Renewals</Th>
            </THead>
            <TBody>
              {results.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <Td className="font-medium">{r.title}</Td>
                  <Td className="font-mono text-xs">{r.barcode}</Td>
                  <Td>{formatDate(r.dueAt)}</Td>
                  <Td>{r.renewals}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
