import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useDebounced, useTitle } from '@/lib/hooks';
import type { Paged, Role, User } from '@/lib/types';
import { UserModal } from '@/components/UserModal';
import { Badge, Button, Card, Input, PageHeader, Pagination, QueryState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrator', LIBRARIAN: 'Librarian', PATRON: 'Patron' };
const ROLE_TONE = { ADMIN: 'purple', LIBRARIAN: 'blue', PATRON: 'gray' } as const;
const STATUS_TONE = { ACTIVE: 'green', SUSPENDED: 'red', EXPIRED: 'amber' } as const;

export function UsersPage() {
  useTitle('Staff & users');
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'staff' | Role | ''>('staff');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const debounced = useDebounced(q);

  const users = useQuery({
    queryKey: ['users', { q: debounced, scope, page }],
    queryFn: () => api<Paged<User>>('/users', { query: { q: debounced, page, pageSize: 25, ...(scope === 'staff' ? { staff: 'true' } : { role: scope }) } }),
    placeholderData: keepPreviousData,
  });

  const canEdit = (u: User) => me?.role === 'ADMIN' || u.role === 'PATRON';

  return (
    <>
      <PageHeader
        title="Staff & users"
        description="Staff accounts and their roles. Administrators manage staff; librarians manage patrons."
        actions={me?.role === 'ADMIN' && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add staff account</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search by name, email, card number or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-44" value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setPage(1); }} aria-label="Show">
            <option value="staff">Staff only</option>
            <option value="ADMIN">Administrators</option>
            <option value="LIBRARIAN">Librarians</option>
            <option value="PATRON">Patrons</option>
            <option value="">Everyone</option>
          </Select>
        </div>
        <QueryState query={users} empty={{ when: !users.data?.data.length, title: 'No users found' }}>
          <Table>
            <THead><Th>Name</Th><Th>Role</Th><Th>Home branch</Th><Th>Last sign-in</Th><Th>Status</Th><Th /></THead>
            <TBody>
              {users.data?.data.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <Td>
                    {u.role === 'PATRON' ? <Link to={`/staff/patrons/${u.id}`} className="font-medium hover:underline">{u.lastName}, {u.firstName}</Link> : <span className="font-medium">{u.lastName}, {u.firstName}</span>}
                    <div className="text-xs text-slate-500">{u.email ?? u.cardNumber ?? '—'}</div>
                  </Td>
                  <Td><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge></Td>
                  <Td className="text-slate-600">{u.homeBranch?.name ?? '—'}</Td>
                  <Td className="text-slate-600">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</Td>
                  <Td><Badge tone={STATUS_TONE[u.status]}>{u.status.toLowerCase()}</Badge></Td>
                  <Td className="text-right">
                    {canEdit(u) && <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.firstName} ${u.lastName}`}><Pencil className="size-4" /></Button>}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {users.data && <Pagination page={users.data.page} totalPages={users.data.totalPages} total={users.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
      {editing && <UserModal user={editing === 'new' ? null : editing} defaultRole="LIBRARIAN" onClose={() => setEditing(null)} />}
    </>
  );
}
