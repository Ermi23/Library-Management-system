import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api, fieldError, workingBranch } from '@/lib/api';
import { ITEM_STATUS, toDateInput } from '@/lib/format';
import { useBranches, useItemTypes } from '@/lib/hooks';
import type { Item, ItemStatus } from '@/lib/types';
import { useToast } from '@/components/toast';
import { Alert, Button, ErrorMessage, Field, Input, Modal, ModalFooter, Select, Textarea } from '@/components/ui';

export function AddItemsModal({ biblioId, suggestedCallNumber, onClose }: { biblioId: string; suggestedCallNumber: string | null; onClose: () => void }) {
  const itemTypes = useItemTypes();
  const branches = useBranches();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    count: '1',
    itemTypeId: '',
    homeBranchId: workingBranch() ?? '',
    callNumber: suggestedCallNumber ?? '',
    shelfLocation: '',
    enumeration: '',
    price: '',
    status: 'AVAILABLE',
    barcodes: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const itemTypeId = f.itemTypeId || itemTypes.data?.find((t) => t.code === 'BOOK')?.id || itemTypes.data?.[0]?.id || '';
  const homeBranchId = f.homeBranchId || branches.data?.[0]?.id || '';
  const barcodes = f.barcodes.split(/\s+/).map((b) => b.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      api<Item[]>(`/catalog/biblios/${biblioId}/items`, {
        method: 'POST',
        body: { ...f, itemTypeId, homeBranchId, count: Number(f.count), barcodes: barcodes.length ? barcodes : undefined },
      }),
    onSuccess: (items) => {
      toast.success(`Added ${items.length} cop${items.length === 1 ? 'y' : 'ies'}: ${items.map((i) => i.barcode).join(', ')}`);
      queryClient.invalidateQueries({ queryKey: ['biblio', biblioId] });
      onClose();
    },
  });

  return (
    <Modal open title="Add copies" onClose={onClose} size="lg">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Number of copies" hint={barcodes.length ? `Using ${barcodes.length} entered barcode(s)` : 'Barcodes generated automatically'}>
            <Input type="number" min={1} max={200} value={f.count} disabled={barcodes.length > 0} onChange={(e) => set('count', e.target.value)} />
          </Field>
          <Field label="Item type" required>
            <Select value={itemTypeId} onChange={(e) => set('itemTypeId', e.target.value)}>
              {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Home branch" required>
            <Select value={homeBranchId} onChange={(e) => set('homeBranchId', e.target.value)}>
              {branches.data?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Call number">
            <Input className="font-mono" value={f.callNumber} onChange={(e) => set('callNumber', e.target.value)} />
          </Field>
          <Field label="Shelf location">
            <Input value={f.shelfLocation} onChange={(e) => set('shelfLocation', e.target.value)} placeholder="e.g. Fiction" />
          </Field>
          <Field label="Volume / part">
            <Input value={f.enumeration} onChange={(e) => set('enumeration', e.target.value)} placeholder="e.g. v.2" />
          </Field>
          <Field label="Price" error={fieldError(save.error, 'price')}>
            <Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="Initial status">
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="AVAILABLE">Available</option>
              <option value="IN_PROCESSING">In processing</option>
            </Select>
          </Field>
        </div>
        <Field label="Pre-printed barcodes (optional)" hint="Scan or type one barcode per line to use existing labels instead of generating new ones.">
          <Textarea rows={3} className="font-mono" value={f.barcodes} onChange={(e) => set('barcodes', e.target.value)} />
        </Field>
        <ErrorMessage error={save.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Add copies</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function EditItemModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved?: () => void }) {
  const itemTypes = useItemTypes();
  const branches = useBranches();
  const toast = useToast();
  const [f, setF] = useState({
    barcode: item.barcode,
    itemTypeId: item.itemType.id,
    homeBranchId: item.homeBranch.id,
    callNumber: item.callNumber ?? '',
    shelfLocation: item.shelfLocation ?? '',
    enumeration: item.enumeration ?? '',
    price: item.price ?? '',
    acquiredAt: toDateInput(item.acquiredAt),
    notes: item.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => api(`/catalog/items/${item.id}`, { method: 'PATCH', body: f }),
    onSuccess: () => {
      toast.success('Copy updated.');
      onSaved?.();
      onClose();
    },
  });
  return (
    <Modal open title={`Edit copy ${item.barcode}`} onClose={onClose} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Barcode" required error={fieldError(save.error, 'barcode')}>
            <Input className="font-mono" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} required />
          </Field>
          <Field label="Item type">
            <Select value={f.itemTypeId} onChange={(e) => set('itemTypeId', e.target.value)}>
              {itemTypes.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Home branch">
            <Select value={f.homeBranchId} onChange={(e) => set('homeBranchId', e.target.value)}>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Call number">
            <Input className="font-mono" value={f.callNumber} onChange={(e) => set('callNumber', e.target.value)} />
          </Field>
          <Field label="Shelf location">
            <Input value={f.shelfLocation} onChange={(e) => set('shelfLocation', e.target.value)} />
          </Field>
          <Field label="Volume / part">
            <Input value={f.enumeration} onChange={(e) => set('enumeration', e.target.value)} />
          </Field>
          <Field label="Price">
            <Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="Acquired on">
            <Input type="date" value={f.acquiredAt} onChange={(e) => set('acquiredAt', e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <ErrorMessage error={save.error} />
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

const SETTABLE: ItemStatus[] = ['AVAILABLE', 'IN_PROCESSING', 'DAMAGED', 'LOST', 'MISSING', 'WITHDRAWN'];

export function ItemStatusModal({ item, onLoan, onClose, onSaved }: { item: Item; onLoan: boolean; onClose: () => void; onSaved?: () => void }) {
  const [status, setStatus] = useState<ItemStatus>(item.status === 'AVAILABLE' ? 'DAMAGED' : 'AVAILABLE');
  const [note, setNote] = useState('');
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api<{ charged: { amount: string } | null }>(`/catalog/items/${item.id}/status`, { method: 'POST', body: { status, note } }),
    onSuccess: (r) => {
      toast.success(`Status changed to ${ITEM_STATUS[status].label.toLowerCase()}.${r.charged ? ` Patron charged ${r.charged.amount} for replacement.` : ''}`);
      onSaved?.();
      onClose();
    },
  });
  return (
    <Modal open title={`Change status of ${item.barcode}`} onClose={onClose} size="sm">
      <div className="space-y-4">
        <Field label="New status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {SETTABLE.map((s) => <option key={s} value={s}>{ITEM_STATUS[s].label}</option>)}
          </Select>
        </Field>
        {status === 'LOST' && onLoan && (
          <Alert tone="amber" icon={<AlertTriangle className="size-4" />}>
            This copy is on loan. Marking it lost closes the loan and charges the patron the replacement cost plus the processing fee. The charge is waived automatically if the copy is returned.
          </Alert>
        )}
        {status !== 'LOST' && onLoan && <Alert tone="amber">This copy is on loan. Check it in before changing its status.</Alert>}
        {status === 'WITHDRAWN' && <Alert tone="blue">Withdrawn copies are hidden from the public catalog but keep their history.</Alert>}
        <Field label="Note" hint="Recorded on the copy with today's date">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage error={save.error} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={status === 'LOST' || status === 'WITHDRAWN' ? 'danger' : 'primary'} loading={save.isPending} onClick={() => save.mutate()}>
          Change status
        </Button>
      </ModalFooter>
    </Modal>
  );
}
