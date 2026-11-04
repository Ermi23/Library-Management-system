import { Link } from 'react-router';
import { AlertTriangle, CreditCard, Mail, Phone } from 'lucide-react';
import { formatDate, formatMoney, fullName } from '@/lib/format';
import type { PatronSummary } from '@/lib/types';
import { Alert, Badge } from './ui';

const STATUS_TONE = { ACTIVE: 'green', SUSPENDED: 'red', EXPIRED: 'amber' } as const;

/** Patron identity, status and blocks, shown at the circulation desk and on the patron page. */
export function PatronPanel({ summary, compact }: { summary: PatronSummary; compact?: boolean }) {
  const { patron, outstanding, blocks, currency } = summary;
  const expired = patron.expiresAt && new Date(patron.expiresAt) < new Date();
  const readyHolds = summary.holds.filter((h) => h.status === 'READY');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/staff/patrons/${patron.id}`} className="text-lg font-semibold text-slate-900 hover:text-brand-700 hover:underline">
            {fullName(patron)}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            {patron.cardNumber && (
              <span className="inline-flex items-center gap-1 font-mono">
                <CreditCard className="size-3.5 text-slate-400" />
                {patron.cardNumber}
              </span>
            )}
            {!compact && patron.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5 text-slate-400" />
                {patron.email}
              </span>
            )}
            {!compact && patron.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5 text-slate-400" />
                {patron.phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONE[patron.status]}>{patron.status.toLowerCase()}</Badge>
          {patron.patronCategory && <Badge>{patron.patronCategory.name}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 px-2 py-2">
          <div className="text-lg font-semibold tabular-nums text-slate-900">{summary.loans.length}</div>
          <div className="text-xs text-slate-500">On loan</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-2">
          <div className={`text-lg font-semibold tabular-nums ${outstanding > 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatMoney(outstanding, currency)}</div>
          <div className="text-xs text-slate-500">Owes</div>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-2">
          <div className={`text-sm font-semibold ${expired ? 'text-red-600' : 'text-slate-900'}`}>{patron.expiresAt ? formatDate(patron.expiresAt) : 'No expiry'}</div>
          <div className="text-xs text-slate-500">Membership</div>
        </div>
      </div>

      {blocks.length > 0 && (
        <Alert tone="amber" icon={<AlertTriangle className="size-4" />} title="Borrowing restrictions">
          <ul className="list-inside list-disc">
            {blocks.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {readyHolds.length > 0 && (
        <Alert tone="blue" title={`${readyHolds.length} hold${readyHolds.length === 1 ? ' is' : 's are'} waiting for pickup`}>
          {readyHolds.map((h) => (
            <div key={h.id}>
              {h.biblio.title} {h.item && <span className="font-mono text-xs">({h.item.barcode})</span>} at {h.pickupBranch.name}
            </div>
          ))}
        </Alert>
      )}
      {patron.notes && !compact && <Alert tone="amber" title="Note">{patron.notes}</Alert>}
    </div>
  );
}
