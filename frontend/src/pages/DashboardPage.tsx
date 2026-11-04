import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookCopy,
  BookOpen,
  BookPlus,
  Bookmark,
  CheckCircle2,
  Inbox,
  Receipt,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney, fullName } from '@/lib/format';
import { useCurrency, useTitle } from '@/lib/hooks';
import { GroupedBarChart } from '@/components/charts';
import { Card, CardHeader, cn, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '@/components/ui';

interface Stats {
  titles: number;
  items: number;
  availableItems: number;
  patrons: number;
  activeLoans: number;
  overdueLoans: number;
  pendingHolds: number;
  branches: number;
  checkoutsToday: number;
  returnsToday: number;
  holdsReady: number;
  incomingTransfers: number;
  holdsToPull: number;
  outstandingFines: number;
}

interface Activity {
  trend: { day: string; checkouts: number; returns: number }[];
  recent: { id: string; action: string; entity: string; createdAt: string; details: Record<string, unknown> | null; user: { firstName: string; lastName: string } | null }[];
}

const ACTION_LABEL: Record<string, string> = {
  checkout: 'checked out',
  checkin: 'checked in',
  renew: 'renewed',
  place: 'placed a hold',
  payment: 'took a payment',
  create: 'created',
};

export function DashboardPage() {
  useTitle('Dashboard');
  const { user } = useAuth();
  const currency = useCurrency();
  const stats = useQuery({ queryKey: ['dashboard', 'stats'], queryFn: () => api<Stats>('/dashboard/stats'), refetchInterval: 60_000 });
  const activity = useQuery({ queryKey: ['dashboard', 'activity'], queryFn: () => api<Activity>('/dashboard/activity'), refetchInterval: 60_000 });
  const s = stats.data;

  const tasks: { to: string; label: string; value: number | undefined; icon: LucideIcon; tone: string }[] = [
    { to: '/staff/circulation/loans', label: 'Overdue loans', value: s?.overdueLoans, icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
    { to: '/staff/holds', label: 'Holds to pull', value: s?.holdsToPull, icon: Bookmark, tone: 'text-violet-600 bg-violet-50' },
    { to: '/staff/holds', label: 'On hold shelf here', value: s?.holdsReady, icon: Inbox, tone: 'text-violet-600 bg-violet-50' },
    { to: '/staff/transfers', label: 'Transfers arriving', value: s?.incomingTransfers, icon: Truck, tone: 'text-amber-600 bg-amber-50' },
  ];

  const metrics: { label: string; value: string | number | undefined; icon: LucideIcon }[] = [
    { label: 'Titles', value: s?.titles, icon: BookOpen },
    { label: 'Copies', value: s?.items, icon: BookCopy },
    { label: 'On the shelf', value: s?.availableItems, icon: CheckCircle2 },
    { label: 'On loan', value: s?.activeLoans, icon: ArrowLeftRight },
    { label: 'Active patrons', value: s?.patrons, icon: Users },
    { label: 'Fines owed', value: s ? formatMoney(s.outstandingFines, currency) : undefined, icon: Receipt },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.firstName}`}
        description={s ? `${s.checkoutsToday} checkouts and ${s.returnsToday} returns so far today.` : 'Here is what is happening across the library today.'}
      />
      <ErrorMessage error={stats.error} className="mb-4" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { to: '/staff/circulation?mode=checkout', label: 'Check out', icon: ArrowLeftRight },
          { to: '/staff/circulation?mode=checkin', label: 'Check in', icon: Inbox },
          { to: '/staff/catalog/new', label: 'Add a book', icon: BookPlus },
          { to: '/staff/patrons', label: 'Register a patron', icon: UserPlus },
        ].map((a) => (
          <Link key={a.label} to={a.to} className="flex items-center gap-3 rounded-xl bg-brand-600 px-4 py-3 font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
            <a.icon className="size-5" />
            {a.label}
          </Link>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Needs attention</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tasks.map((t) => (
          <Link key={t.label} to={t.to}>
            <Card className="flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
              <div className={cn('flex size-10 items-center justify-center rounded-lg', t.tone)}>
                <t.icon className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{t.value ?? <Spinner className="size-4" />}</div>
                <div className="text-xs text-slate-500">{t.label}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Circulation, last 14 days" />
          <div className="p-4">
            {activity.data ? (
              <GroupedBarChart
                series={['Checkouts', 'Returns']}
                data={activity.data.trend.map((d) => ({ label: new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), values: [d.checkouts, d.returns] }))}
              />
            ) : (
              <LoadingBlock />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Collection & members" />
          <div className="grid grid-cols-2 gap-px bg-slate-100">
            {metrics.map((m) => (
              <div key={m.label} className="bg-white px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <m.icon className="size-3.5" />
                  {m.label}
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{m.value ?? '—'}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent activity" />
        {activity.data?.recent.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {activity.data.recent.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 px-4 py-2">
                <span>
                  <b className="font-medium">{a.user ? fullName(a.user) : 'System'}</b> {ACTION_LABEL[a.action] ?? a.action}{' '}
                  {a.action === 'create' ? a.entity.toLowerCase() : ''}
                  {typeof a.details?.barcode === 'string' && <span className="font-mono text-xs text-slate-500"> {a.details.barcode}</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-slate-500">No activity yet.</p>
        )}
      </Card>
    </>
  );
}
