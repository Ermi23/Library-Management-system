import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useDebounced, usePatronCategories, useTitle } from '@/lib/hooks';
import type { Paged, User } from '@/lib/types';
import { UserModal } from '@/components/UserModal';
import { Badge, Button, Card, Input, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

const STATUS_TONE = { ACTIVE: 'green', SUSPENDED: 'red', EXPIRED: 'amber' } as const;

export function PatronsPage() {
  useTitle('Patrons');
  const navigate = useNavigate();
  const categories = usePatronCategories();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const debounced = useDebounced(q);

  const patrons = useQuery({
    queryKey: ['users', 'patrons', debounced, status, category, page],
    queryFn: () => api<Paged<User>>('/users', { query: { role: 'PATRON', q: debounced, status, patronCategoryId: category, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Patrons"
        description="Library members. Open a patron to see loans, holds, fines and history."
        actions={<Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> Register patron</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input autoFocus className="pl-9" placeholder="Name, card number, email or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-44" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
        <QueryState query={patrons} empty={{ when: !patrons.data?.data.length, icon: <Users className="size-10" />, title: q ? 'No patrons match' : 'No patrons yet', action: <Button onClick={() => setAdding(true)}>Register patron</Button> }}>
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Card number</Th>
              <Th>Category</Th>
              <Th>Home branch</Th>
              <Th>On loan</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
            </THead>
            <TBody>
              {patrons.data?.data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/staff/patrons/${p.id}`)}>
                  <Td>
                    <Link to={`/staff/patrons/${p.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>{p.lastName}, {p.firstName}</Link>
                    <div className="text-xs text-slate-500">{p.email ?? p.phone ?? ''}</div>
                  </Td>
                  <Td className="font-mono text-xs">{p.cardNumber ?? '—'}</Td>
                  <Td>{p.patronCategory?.name ?? '—'}</Td>
                  <Td className="text-slate-600">{p.homeBranch?.name ?? '—'}</Td>
                  <Td className="tabular-nums">{p._count?.loans ?? 0}</Td>
                  <Td className={p.expiresAt && new Date(p.expiresAt) < new Date() ? 'text-red-600' : ''}>{formatDate(p.expiresAt)}</Td>
                  <Td><Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge></Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {patrons.data && <Pagination page={patrons.data.page} totalPages={patrons.data.totalPages} total={patrons.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
      {adding && <UserModal user={null} onClose={() => setAdding(false)} onSaved={(u) => navigate(`/staff/patrons/${u.id}`)} />}
    </>
  );
}
