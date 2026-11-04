import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ApiError, type Reason } from '@/lib/api';
import { Button, Modal, ModalFooter } from './ui';

export class OverrideCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/**
 * Runs an action that the server may refuse with overridable warnings (CONFIRMATION_REQUIRED).
 * The librarian sees the reasons and can choose to override; the action is then repeated with override=true.
 */
export function useOverridable() {
  const [pending, setPending] = useState<{ reasons: Reason[]; title: string } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const run = useCallback(async <T,>(action: (override: boolean) => Promise<T>, title = 'Please confirm'): Promise<T> => {
    try {
      return await action(false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'CONFIRMATION_REQUIRED') throw err;
      const ok = await new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPending({ reasons: err.reasons, title });
      });
      setPending(null);
      if (!ok) throw new OverrideCancelled();
      return action(true);
    }
  }, []);

  const close = (ok: boolean) => resolver.current?.(ok);

  const dialog = (
    <Modal open={!!pending} title={pending?.title ?? ''} onClose={() => close(false)} size="md">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm text-slate-700">The system found the following issues:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-800">
            {pending?.reasons.map((r) => <li key={r.code}>{r.message}</li>)}
          </ul>
          <p className="mt-3 text-sm text-slate-500">You can override these and continue. The override is recorded in the audit log.</p>
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={() => close(false)} autoFocus>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => close(true)}>
          Override and continue
        </Button>
      </ModalFooter>
    </Modal>
  );

  return { run, dialog };
}

/** Promise-based confirmation dialog: `if (await confirm({...})) ...` */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirmLabel: string; danger: boolean } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ title: opts.title, body: opts.body, confirmLabel: opts.confirmLabel ?? 'Confirm', danger: opts.danger ?? false });
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    setState(null);
  };

  const dialog = (
    <Modal open={!!state} title={state?.title ?? ''} onClose={() => close(false)} size="sm">
      <div className="text-sm text-slate-700">{state?.body}</div>
      <ModalFooter>
        <Button variant="secondary" onClick={() => close(false)}>
          Cancel
        </Button>
        <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
          {state?.confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );

  return { confirm, dialog };
}
