import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Play } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { formatDateTime, fullName } from '@/lib/format';
import { useTitle } from '@/lib/hooks';
import type { Paged, PatronRef } from '@/lib/types';
import { useToast } from '@/components/toast';
import { Alert, Badge, Button, Card, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

interface Notice {
  id: string;
  type: string;
  channel: 'EMAIL' | 'IN_APP';
  status: 'PENDING' | 'SENT' | 'FAILED';
  subject: string;
  body: string;
  error: string | null;
  createdAt: string;
  patron: PatronRef & { email: string | null };
}

const TYPES = ['DUE_SOON', 'OVERDUE', 'HOLD_READY', 'HOLD_CANCELLED', 'MEMBERSHIP_EXPIRY', 'FINE', 'GENERAL'];

export function NoticesPage() {
  useTitle('Notices');
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const notices = useQuery({
    queryKey: ['notices', type, channel, page],
    queryFn: () => api<Paged<Notice> & { emailEnabled: boolean; lastRun: Record<string, number | string> | null }>('/notices', { query: { type, channel, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const run = useMutation({
    mutationFn: () => api<Record<string, number>>('/notices/run-jobs', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`Done: ${r.dueSoon ?? 0} due-soon, ${r.overdue ?? 0} overdue notices, ${r.holdsExpired ?? 0} holds expired, ${r.membershipReminders ?? 0} membership reminders.`);
      queryClient.invalidateQueries({ queryKey: ['notices'] });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <>
      <PageHeader
        title="Notices"
        description="Messages sent to patrons: due-date reminders, overdue notices, hold pickups, fines and membership renewals. They are sent automatically every hour."
        actions={user?.role === 'ADMIN' && <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}><Play className="size-4" /> Run notice jobs now</Button>}
      />
      {notices.data && !notices.data.emailEnabled && (
        <div className="mb-4">
          <Alert tone="blue" title="Email is not configured">
            Notices appear in each patron&apos;s online account. To also send them by email, set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM for the backend.
          </Alert>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Select className="w-52" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}
          </Select>
          <Select className="w-40" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Channel">
            <option value="">All channels</option>
            <option value="IN_APP">In-app</option>
            <option value="EMAIL">Email</option>
          </Select>
        </div>
        <QueryState query={notices} empty={{ when: !notices.data?.data.length, icon: <Bell className="size-10" />, title: 'No notices yet' }}>
          <Table>
            <THead><Th>Sent</Th><Th>Patron</Th><Th>Type</Th><Th>Message</Th><Th>Channel</Th></THead>
            <TBody>
              {notices.data?.data.map((n) => (
                <tr key={n.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(n.createdAt)}</Td>
                  <Td><Link to={`/staff/patrons/${n.patron.id}?tab=notices`} className="text-brand-700 hover:underline">{fullName(n.patron)}</Link></Td>
                  <Td><Badge>{n.type.replace(/_/g, ' ').toLowerCase()}</Badge></Td>
                  <Td className="max-w-md"><div className="font-medium">{n.subject}</div><div className="truncate text-xs text-slate-500">{n.body}</div>{n.error && <div className="text-xs text-red-600">{n.error}</div>}</Td>
                  <Td>
                    <Badge tone={n.channel === 'EMAIL' ? 'blue' : 'gray'}>{n.channel === 'EMAIL' ? 'email' : 'in-app'}</Badge>
                    {n.status !== 'SENT' && <Badge tone={n.status === 'FAILED' ? 'red' : 'amber'} className="ml-1">{n.status.toLowerCase()}</Badge>}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {notices.data && <Pagination page={notices.data.page} totalPages={notices.data.totalPages} total={notices.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
    </>
  );
}
