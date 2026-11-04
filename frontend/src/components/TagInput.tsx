import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn, fieldClass } from './ui';

/** Multi-value text input (authors, subjects): Enter or comma-free paste adds a value. */
export function TagInput({ value, onChange, placeholder, separator = '\n' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; separator?: string }) {
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    const parts = raw.split(separator).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={cn(fieldClass, 'flex min-h-10 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-sm text-slate-800">
          <span className="truncate">{v}</span>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${v}`}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        className="min-w-40 flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-slate-400 focus:ring-0"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
