import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, fieldError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useBranches, useCurrency, useItemTypes, usePatronCategories, useTitle } from '@/lib/hooks';
import type { ItemType, PatronCategory } from '@/lib/types';
import { useConfirm } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorMessage, Field, Input, LoadingBlock, Modal, ModalFooter, PageHeader, Select, Table, TBody, Td, Textarea, Th, THead, Tabs } from '@/components/ui';

type Tab = 'library' | 'rules' | 'itemTypes' | 'categories';

export function SettingsPage() {
  useTitle('Settings');
  const [tab, setTab] = useState<Tab>('library');
  return (
    <>
      <PageHeader title="Settings" description="Library policies and the reference data that drives circulation." />
      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'library', label: 'Library & policies' },
          { value: 'rules', label: 'Circulation rules' },
          { value: 'itemTypes', label: 'Item types' },
          { value: 'categories', label: 'Patron categories' },
        ]}
      />
      {tab === 'library' && <LibrarySettings />}
      {tab === 'rules' && <RulesSettings />}
      {tab === 'itemTypes' && <ItemTypeSettings />}
      {tab === 'categories' && <CategorySettings />}
    </>
  );
}

interface Library {
  libraryName: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  itemBarcodePrefix: string;
  fineGraceDays: number;
  maxOutstandingFines: number;
  blockOnOverdue: boolean;
  returnPolicy: 'home' | 'float';
  allowPatronRenewal: boolean;
  allowOpacHolds: boolean;
  defaultReplacementCost: number;
  lostProcessingFee: number;
  dueSoonNoticeDays: number;
  overdueNoticeDays: number[];
  membershipReminderDays: number;
  emailEnabled?: boolean;
}

function LibrarySettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'library'], queryFn: () => api<Library>('/settings/library') });
  const [f, setF] = useState<Library | null>(null);
  const [overdueDays, setOverdueDays] = useState('');
  useEffect(() => {
    if (settings.data) {
      setF(settings.data);
      setOverdueDays(settings.data.overdueNoticeDays.join(', '));
    }
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const { emailEnabled: _e, ...rest } = f!;
      return api('/settings/library', {
        method: 'PUT',
        body: { ...rest, overdueNoticeDays: overdueDays.split(/[,\s]+/).map(Number).filter((n) => n > 0) },
      });
    },
    onSuccess: () => {
      toast.success('Settings saved.');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  if (!f) return <LoadingBlock />;
  const set = <K extends keyof Library>(k: K, v: Library[K]) => setF({ ...f, [k]: v });
  const num = (k: keyof Library, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-6">
      <Card>
        <CardHeader title="Library details" description="Shown on the public catalog, receipts, cards and labels" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Library name"><Input value={f.libraryName} onChange={(e) => set('libraryName', e.target.value)} /></Field>
          <Field label="Currency code" hint="ISO 4217, e.g. USD, EUR, ETB, KES"><Input value={f.currency} maxLength={5} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><Input value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Item barcode prefix" hint="Generated barcodes look like B0000123"><Input value={f.itemBarcodePrefix} maxLength={5} onChange={(e) => set('itemBarcodePrefix', e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Circulation policies" />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          {num('fineGraceDays', 'Fine grace period (days)', 'Days late before fines apply')}
          {num('maxOutstandingFines', 'Block borrowing above (fines owed)')}
          {num('defaultReplacementCost', 'Default replacement cost', 'Used when a lost copy has no price')}
          {num('lostProcessingFee', 'Lost item processing fee')}
          <Field label="Returned copies">
            <Select value={f.returnPolicy} onChange={(e) => set('returnPolicy', e.target.value as Library['returnPolicy'])}>
              <option value="home">Go back to their home branch</option>
              <option value="float">Stay where they were returned (floating)</option>
            </Select>
          </Field>
          <div className="space-y-2 pt-6">
            <Checkbox label="Block patrons with overdue items" checked={f.blockOnOverdue} onChange={(v) => set('blockOnOverdue', v)} />
            <Checkbox label="Patrons can renew online" checked={f.allowPatronRenewal} onChange={(v) => set('allowPatronRenewal', v)} />
            <Checkbox label="Patrons can place holds online" checked={f.allowOpacHolds} onChange={(v) => set('allowOpacHolds', v)} />
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Notices" description={f.emailEnabled ? 'Email delivery is configured.' : 'Email is not configured: notices are shown in patron accounts only.'} />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          {num('dueSoonNoticeDays', 'Due-soon reminder (days before)', '0 turns reminders off')}
          <Field label="Overdue notices (days late)" hint="Comma separated, e.g. 1, 7, 14">
            <Input value={overdueDays} onChange={(e) => setOverdueDays(e.target.value)} />
          </Field>
          {num('membershipReminderDays', 'Membership reminder (days before expiry)')}
        </div>
      </Card>
      <ErrorMessage error={save.error} />
      <Button type="submit" loading={save.isPending}>Save settings</Button>
    </form>
  );
}

interface Rule {
  id: string;
  branchId: string | null;
  patronCategoryId: string | null;
  itemTypeId: string | null;
  loanPeriodDays: number;
  maxLoans: number;
  maxRenewals: number;
  maxHolds: number;
  holdPickupDays: number;
  finePerDay: string;
  maxFine: string | null;
  branch: { name: string } | null;
  patronCategory: { name: string } | null;
  itemType: { name: string } | null;
}

function RulesSettings() {
  const currency = useCurrency();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/settings/rules') });

  async function remove(r: Rule) {
    if (!(await confirm({ title: 'Delete this rule?', body: 'Loans will fall back to the next most general rule.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/settings/rules/${r.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card>
      {dialog}
      <CardHeader
        title="Circulation rules"
        description="Loan period, limits and fines. Blank means “any”; the most specific matching rule wins (branch, then patron category, then item type)."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add rule</Button>}
      />
      {rules.isLoading ? (
        <LoadingBlock />
      ) : (
        <Table>
          <THead><Th>Branch</Th><Th>Patron category</Th><Th>Item type</Th><Th>Loan</Th><Th>Max loans</Th><Th>Renewals</Th><Th>Holds</Th><Th>Fine / day</Th><Th>Max fine</Th><Th /></THead>
          <TBody>
            {rules.data?.map((r) => (
              <tr key={r.id}>
                <Td>{r.branch?.name ?? <span className="text-slate-400">Any</span>}</Td>
                <Td>{r.patronCategory?.name ?? <span className="text-slate-400">Any</span>}</Td>
                <Td>{r.itemType?.name ?? <span className="text-slate-400">Any</span>}</Td>
                <Td>{r.loanPeriodDays} days</Td>
                <Td>{r.maxLoans}</Td>
                <Td>{r.maxRenewals}</Td>
                <Td>{r.maxHolds} <span className="text-xs text-slate-500">({r.holdPickupDays}d pickup)</span></Td>
                <Td className="tabular-nums">{formatMoney(r.finePerDay, currency)}</Td>
                <Td className="tabular-nums">{r.maxFine ? formatMoney(r.maxFine, currency) : '—'}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label="Delete rule"><Trash2 className="size-3.5" /></Button>
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RuleModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const branches = useBranches();
  const itemTypes = useItemTypes();
  const categories = usePatronCategories();
  const [f, setF] = useState({
    branchId: rule?.branchId ?? '',
    patronCategoryId: rule?.patronCategoryId ?? '',
    itemTypeId: rule?.itemTypeId ?? '',
    loanPeriodDays: String(rule?.loanPeriodDays ?? 14),
    maxLoans: String(rule?.maxLoans ?? 5),
    maxRenewals: String(rule?.maxRenewals ?? 2),
    maxHolds: String(rule?.maxHolds ?? 5),
    holdPickupDays: String(rule?.holdPickupDays ?? 7),
    finePerDay: rule?.finePerDay ?? '0.50',
    maxFine: rule?.maxFine ?? '',
  });
  const save = useMutation({
    mutationFn: () => (rule ? api(`/settings/rules/${rule.id}`, { method: 'PUT', body: f }) : api('/settings/rules', { method: 'POST', body: f })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onClose();
    },
  });
  const input = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={fieldError(save.error, k)}>
      <Input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Modal open title={rule ? 'Edit circulation rule' : 'Add circulation rule'} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Branch">
            <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">Any branch</option>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Patron category">
            <Select value={f.patronCategoryId} onChange={(e) => setF({ ...f, patronCategoryId: e.target.value })}>
              <option value="">Any category</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Item type">
            <Select value={f.itemTypeId} onChange={(e) => setF({ ...f, itemTypeId: e.target.value })}>
              <option value="">Any item type</option>
              {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          {input('loanPeriodDays', 'Loan period (days)')}
          {input('maxLoans', 'Max items on loan')}
          {input('maxRenewals', 'Max renewals')}
          {input('maxHolds', 'Max active holds')}
          {input('holdPickupDays', 'Days to collect a hold')}
          {input('finePerDay', 'Fine per day')}
          {input('maxFine', 'Maximum fine per loan', 'Blank = no cap')}
        </div>
        <ErrorMessage error={save.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save rule</Button>
      </ModalFooter>
    </Modal>
  );
}

function ItemTypeSettings() {
  const types = useItemTypes();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<ItemType | 'new' | null>(null);
  async function remove(t: ItemType) {
    if (!(await confirm({ title: `Delete ${t.name}?`, body: 'Rules for this item type are deleted too.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/settings/item-types/${t.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['lookups'] });
    } catch (err) {
      toast.error(err);
    }
  }
  return (
    <Card>
      {dialog}
      <CardHeader title="Item types" description="Kinds of material. Reference types cannot be borrowed." actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add item type</Button>} />
      <Table>
        <THead><Th>Code</Th><Th>Name</Th><Th>Loans</Th><Th>Copies</Th><Th /></THead>
        <TBody>
          {types.data?.map((t) => (
            <tr key={t.id}>
              <Td className="font-mono text-xs font-semibold">{t.code}</Td>
              <Td>{t.name}</Td>
              <Td>{t.notForLoan ? <Badge tone="amber">Library use only</Badge> : <Badge tone="green">Can be borrowed</Badge>}</Td>
              <Td className="tabular-nums">{t._count?.items ?? 0}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}><Trash2 className="size-3.5" /></Button>
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {editing && <ItemTypeModal type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ItemTypeModal({ type, onClose }: { type: ItemType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({ code: type?.code ?? '', name: type?.name ?? '', notForLoan: type?.notForLoan ?? false });
  const save = useMutation({
    mutationFn: () => (type ? api(`/settings/item-types/${type.id}`, { method: 'PUT', body: f }) : api('/settings/item-types', { method: 'POST', body: f })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
  });
  return (
    <Modal open title={type ? `Edit ${type.name}` : 'Add item type'} onClose={onClose} size="sm">
      <div className="space-y-4">
        <Field label="Code" required error={fieldError(save.error, 'code')}><Input className="font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Checkbox label="Library use only (cannot be borrowed)" checked={f.notForLoan} onChange={(v) => setF({ ...f, notForLoan: v })} />
        <ErrorMessage error={save.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}

function CategorySettings() {
  const categories = usePatronCategories();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<PatronCategory | 'new' | null>(null);
  async function remove(c: PatronCategory) {
    if (!(await confirm({ title: `Delete ${c.name}?`, body: 'Rules for this category are deleted too.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/settings/patron-categories/${c.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['lookups'] });
    } catch (err) {
      toast.error(err);
    }
  }
  return (
    <Card>
      {dialog}
      <CardHeader title="Patron categories" description="Groups of members with their own membership period and loan rules" actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add category</Button>} />
      <Table>
        <THead><Th>Code</Th><Th>Name</Th><Th>Membership</Th><Th>Patrons</Th><Th /></THead>
        <TBody>
          {categories.data?.map((c) => (
            <tr key={c.id}>
              <Td className="font-mono text-xs font-semibold">{c.code}</Td>
              <Td>{c.name}{c.description && <div className="text-xs text-slate-500">{c.description}</div>}</Td>
              <Td>{c.enrolmentPeriodMonths} months</Td>
              <Td className="tabular-nums">{c._count?.users ?? 0}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><Trash2 className="size-3.5" /></Button>
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {editing && <CategoryModal category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CategoryModal({ category, onClose }: { category: PatronCategory | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({ code: category?.code ?? '', name: category?.name ?? '', description: category?.description ?? '', enrolmentPeriodMonths: String(category?.enrolmentPeriodMonths ?? 12) });
  const save = useMutation({
    mutationFn: () => (category ? api(`/settings/patron-categories/${category.id}`, { method: 'PUT', body: f }) : api('/settings/patron-categories', { method: 'POST', body: f })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
  });
  return (
    <Modal open title={category ? `Edit ${category.name}` : 'Add patron category'} onClose={onClose} size="sm">
      <div className="space-y-4">
        <Field label="Code" required error={fieldError(save.error, 'code')}><Input className="font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Membership period (months)"><Input inputMode="numeric" value={f.enrolmentPeriodMonths} onChange={(e) => setF({ ...f, enrolmentPeriodMonths: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Alert tone="blue">Add a circulation rule for this category to give it its own loan limits.</Alert>
        <ErrorMessage error={save.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}
