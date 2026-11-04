import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, fieldError } from '@/lib/api';
import type { Branch } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorMessage, Field, Input, Modal, PageHeader, Spinner } from '@/components/ui';

type BranchForm = { code: string; name: string; address: string; phone: string; email: string; isActive: boolean };

const EMPTY_FORM: BranchForm = { code: '', name: '', address: '', phone: '', email: '', isActive: true };

export function BranchesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });

  return (
    <>
      <PageHeader
        title="Branches"
        description="Library locations. Each copy belongs to a home branch and can move between branches."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add branch
            </Button>
          )
        }
      />

      <Card>
        {branches.isLoading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : branches.error ? (
          <div className="p-4">
            <ErrorMessage error={branches.error} />
          </div>
        ) : !branches.data?.length ? (
          <EmptyState title="No branches yet" description="Add your first library location." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium text-right">Copies</th>
                  <th className="px-4 py-3 font-medium text-right">Patrons</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {isAdmin && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.data.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{b.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{b.name}</div>
                      {b.address && <div className="text-xs text-slate-500">{b.address}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {b.phone && <div>{b.phone}</div>}
                      {b.email && <div className="text-xs">{b.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b._count?.homeItems ?? 0}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{b._count?.users ?? 0}</td>
                    <td className="px-4 py-3">{b.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}>
                          <Pencil className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <BranchModal branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BranchModal({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BranchForm>(
    branch
      ? {
          code: branch.code,
          name: branch.name,
          address: branch.address ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          isActive: branch.isActive,
        }
      : EMPTY_FORM,
  );

  const save = useMutation({
    mutationFn: (data: BranchForm) =>
      branch ? api<Branch>(`/branches/${branch.id}`, { method: 'PATCH', body: data }) : api<Branch>('/branches', { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      onClose();
    },
  });

  const set = <K extends keyof BranchForm>(key: K, value: BranchForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  return (
    <Modal open title={branch ? `Edit ${branch.name}` : 'Add branch'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code" error={fieldError(save.error, 'code')}>
            <Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="MAIN" required />
          </Field>
          <div className="col-span-2">
            <Field label="Name" error={fieldError(save.error, 'name')}>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Main Library" required />
            </Field>
          </div>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" error={fieldError(save.error, 'email')}>
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 rounded border-slate-300" />
          Active (shown to patrons as a pickup location)
        </label>
        <ErrorMessage error={save.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
