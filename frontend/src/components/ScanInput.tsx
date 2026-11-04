import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ScanBarcode } from 'lucide-react';
import { Button, cn, fieldClass } from './ui';

export interface ScanInputHandle {
  focus: () => void;
}

/**
 * Barcode entry for USB/Bluetooth scanners (which type the code and press Enter) or manual typing.
 * Clears and keeps focus after each submit so the next item can be scanned straight away.
 */
export const ScanInput = forwardRef<
  ScanInputHandle,
  { onScan: (value: string) => Promise<unknown> | void; placeholder?: string; buttonLabel?: ReactNode; autoFocus?: boolean; disabled?: boolean; className?: string }
>(function ScanInput({ onScan, placeholder = 'Scan or type a barcode', buttonLabel = 'Submit', autoFocus = true, disabled, className }, ref) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      await onScan(code);
      setValue('');
    } catch {
      // The caller reports errors; keep the value so it can be corrected.
      inputRef.current?.select();
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <form onSubmit={submit} className={cn('flex gap-2', className)}>
      <div className="relative flex-1">
        <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          className={cn(fieldClass, 'h-11 pl-10 font-mono text-base')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      <Button type="submit" className="h-11" loading={busy} disabled={disabled || !value.trim()}>
        {buttonLabel}
      </Button>
    </form>
  );
});
