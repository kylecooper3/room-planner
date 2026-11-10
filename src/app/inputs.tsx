import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatLength, parseLength } from '../core/units';
import type { Cm, UnitSystem } from '../types';

/** commit() returns null when accepted, or an error message to show inline (the typed text is kept for fixing). */
type Commit = (text: string) => string | null;

/** Text field that commits on Enter/blur; invalid text shows an inline error; Esc reverts. */
function useCommitField(shown: string, commit: Commit) {
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(shown); setError(null); }, [shown]);
  const done = () => {
    if (text === shown) { setError(null); return; }
    const err = commit(text);
    setError(err);
    if (!err) setText(shown); // the store may have clamped the value: show what was applied
  };
  const input = {
    value: text,
    'aria-invalid': !!error,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: done,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { setText(shown); setError(null); e.stopPropagation(); }
    },
  };
  return { input, error };
}

function Field({ label, field, testId, decimal }: { label: string; field: ReturnType<typeof useCommitField>; testId?: string; decimal?: boolean }) {
  return (
    <label className="field">{label}
      <input {...field.input} inputMode={decimal ? 'decimal' : undefined} data-testid={testId} />
      {field.error && <span className="app-field-error" role="alert" data-testid={testId && `${testId}-error`}>{field.error}</span>}
    </label>
  );
}

/** Unit-aware length input. `allowZero`/`allowNegative` for offsets and positions (parseLength rejects both); `maxAbs` rejects absurd values; `range` rejects values outside [min, max]. */
export function LengthInput(props: {
  label: string; value: Cm; units: UnitSystem; onCommit: (cm: Cm) => void;
  allowZero?: boolean; allowNegative?: boolean; maxAbs?: Cm; range?: [Cm, Cm]; testId?: string;
}) {
  const { label, value, units, onCommit, allowZero, allowNegative, maxAbs, range, testId } = props;
  const field = useCommitField(formatLength(value, units), (text) => {
    const t = text.trim();
    const negative = !!allowNegative && t.startsWith('-');
    const body = negative ? t.slice(1) : t;
    let cm = parseLength(body, units);
    if (cm === null && allowZero && parseFloat(body) === 0 && !/[1-9]/.test(body)) cm = 0;
    if (cm === null) return units === 'imperial' ? 'Not a valid length (e.g. 3\' 4" or 40)' : 'Not a valid length (e.g. 1.2m or 120)';
    if (maxAbs !== undefined && cm > maxAbs) return `Too far: at most ${formatLength(maxAbs, units)}`;
    if (range && (cm < range[0] || cm > range[1])) return `Must be ${formatLength(range[0], units)} – ${formatLength(range[1], units)}`;
    onCommit(negative ? -cm : cm);
    return null;
  });
  return <Field label={label} field={field} testId={testId} />;
}

export function NumberInput(props: { label: string; value: number; onCommit: (n: number) => void; testId?: string }) {
  const field = useCommitField(String(Math.round(props.value * 10) / 10), (text) => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) return 'Enter a number';
    props.onCommit(n);
    return null;
  });
  return <Field label={props.label} field={field} testId={props.testId} decimal />;
}

export function TextInput(props: { label: string; value: string; onCommit: (s: string) => void; testId?: string }) {
  const field = useCommitField(props.value, (text) => {
    if (!text.trim()) return 'Cannot be empty';
    props.onCommit(text.trim());
    return null;
  });
  return <Field label={props.label} field={field} testId={props.testId} />;
}

/** Inline rename box: autofocused, Enter/blur commits, Esc cancels. */
export function RenameInput(props: { value: string; onDone: (name: string | null) => void; label: string }) {
  const [text, setText] = useState(props.value);
  const done = useRef(false); // Enter unmounts the input, which may also fire blur
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    props.onDone(ok && text.trim() && text.trim() !== props.value ? text.trim() : null);
  };
  return (
    <input
      className="app-rename" aria-label={props.label} autoFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      }}
    />
  );
}
