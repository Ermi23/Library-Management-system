import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { api, fieldError, workingBranch } from '@/lib/api';
import { toDateInput } from '@/lib/format';
import { useBranches, usePatronCategories } from '@/lib/hooks';
import type { Role, User, UserStatus } from '@/lib/types';
import { useToast } from './toast';
import { Button, ErrorMessage, Field, Input, Modal, ModalFooter, Select, Textarea } from './ui';

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  role: Role;
  status: UserStatus;
  cardNumber: string;
  homeBranchId: string;
  patronCategoryId: string;
  dateOfBirth: string;
  expiresAt: string;
  notes: string;
  password: string;
}

function toForm(user: User | null, defaults: { role: Role; branchId: string }): UserForm {
  return {
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    address: user?.address ?? '',
    role: user?.role ?? defaults.role,
    status: user?.status ?? 'ACTIVE',
    cardNumber: user?.cardNumber ?? '',
    homeBranchId: user?.homeBranch?.id ?? defaults.branchId,
    patronCategoryId: user?.patronCategory?.id ?? '',
    dateOfBirth: toDateInput(user?.dateOfBirth),
    expiresAt: toDateInput(user?.expiresAt),
    notes: user?.notes ?? '',
    password: '',
  };
}

/** Create or edit a patron or staff account. Librarians can only manage patrons. */
export function UserModal({ user, defaultRole = 'PATRON', onClose, onSaved }: { user: User | null; defaultRole?: Role; onClose: () => void; onSaved?: (u: User) => void }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const categories = usePatronCategories();
  const [form, setForm] = useState<UserForm>(() => toForm(user, { role: defaultRole, branchId: me?.homeBranch?.id ?? workingBranch() ?? '' }));

  const save = useMutation({
    mutationFn: (f: UserForm) => {
      const body = {
        ...f,
        homeBranchId: f.homeBranchId || null,
        patronCategoryId: f.role === 'PATRON' && f.patronCategoryId ? f.patronCategoryId : null,
        password: f.password || undefined,
      };
      return user ? api<User>(`/users/${user.id}`, { method: 'PATCH', body }) : api<User>('/users', { method: 'POST', body });
    },
    onSuccess: (saved) => {
      toast.success(user ? 'Saved.' : `${saved.firstName} ${saved.lastName} registered${saved.cardNumber ? ` with card ${saved.cardNumber}` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['patron'] });
      onSaved?.(saved);
      onClose();
    },
  });

  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const err = (field: string) => fieldError(save.error, field);
  const isPatron = form.role === 'PATRON';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  return (
    <Modal open title={user ? `Edit ${user.firstName} ${user.lastName}` : isPatron ? 'Register a patron' : 'Add a staff account'} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required error={err('firstName')}>
            <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus />
          </Field>
          <Field label="Last name" required error={err('lastName')}>
            <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
          </Field>
          <Field label="Role" error={err('role')}>
            <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)} disabled={me?.role !== 'ADMIN'}>
              <option value="PATRON">Patron</option>
              <option value="LIBRARIAN">Librarian</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value as UserStatus)}>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="EXPIRED">Expired</option>
            </Select>
          </Field>
          <Field label="Email" required={!isPatron} error={err('email')}>
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required={!isPatron} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Home branch">
            <Select value={form.homeBranchId} onChange={(e) => set('homeBranchId', e.target.value)}>
              <option value="">—</option>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          {isPatron && (
            <>
              <Field label="Patron category" hint="Sets loan rules and membership length">
                <Select value={form.patronCategoryId} onChange={(e) => set('patronCategoryId', e.target.value)}>
                  <option value="">—</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Library card number" error={err('cardNumber')} hint={user ? undefined : 'Leave blank to generate one'}>
                <Input className="font-mono" value={form.cardNumber} onChange={(e) => set('cardNumber', e.target.value)} />
              </Field>
              <Field label="Membership expires" hint={user ? undefined : 'Blank = category period from today'}>
                <Input type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              </Field>
            </>
          )}
          <Field
            label={user ? 'New password' : 'Password'}
            error={err('password')}
            hint={user ? 'Leave blank to keep the current password' : isPatron ? 'Optional: lets the patron sign in to the online catalog' : 'At least 8 characters'}
            className={isPatron ? '' : 'sm:col-span-2'}
          >
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!user && !isPatron} />
          </Field>
        </div>
        <Field label="Staff note" hint="Shown to staff at the circulation desk">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <ErrorMessage error={save.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{user ? 'Save' : isPatron ? 'Register patron' : 'Create account'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
