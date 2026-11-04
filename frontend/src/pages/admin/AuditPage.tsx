import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, fullName } from '@/lib/format';
import { useTitle } from '@/lib/hooks';
import type { Paged, Role } from '@/lib/types';
import { Badge, Card, Field, Input, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; role: Role } | null;
}

export function AuditPage() {
  useTitle('Audit log');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ['audit', entity, from, to, page],
    queryFn: () => api<Paged<AuditEntry> & { entities: string[] }>('/audit', { query: { entity, from, to, page, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Audit log" description="Who did what and when: every checkout, override, payment, edit and setting change is recorded." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <Field label="Record type">
            <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {log.data?.entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
        </div>
        <QueryState query={log} empty={{ when: !log.data?.data.length, icon: <ScrollText className="size-10" />, title: 'No entries' }}>
          <Table>
            <THead><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Details</Th></THead>
            <TBody>
              {log.data?.data.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                  <Td>{a.user ? <>{fullName(a.user)} <span className="text-xs text-slate-500">({a.user.role.toLowerCase()})</span></> : 'System'}</Td>
                  <Td><Badge tone={a.action === 'delete' ? 'red' : a.action === 'create' ? 'green' : 'gray'}>{a.action}</Badge></Td>
                  <Td>{a.entity}<div className="font-mono text-[11px] text-slate-400">{a.entityId}</div></Td>
                  <Td className="max-w-md"><code className="block truncate text-xs text-slate-600" title={JSON.stringify(a.details)}>{a.details ? JSON.stringify(a.details) : ''}</code></Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {log.data && <Pagination page={log.data.page} totalPages={log.data.totalPages} total={log.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
    </>
  );
}
