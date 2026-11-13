import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

const ITEMS = '[role=menuitem]:not(:disabled),[role=menuitemcheckbox]:not(:disabled)';

/**
 * Button + popup menu. Closes on outside click, Esc (focus returns to the button) and after an item is chosen
 * (items with data-keep-open stay open, e.g. checkboxes). Arrow keys / Home / End move between items.
 */
export function Menu(props: {
  label: ReactNode; title: string; children: ReactNode; testId?: string; className?: string;
  /** Where the list opens relative to the button. */
  place?: 'down' | 'right' | 'up' | 'side'; ariaLabel?: string;
}) {
  const { label, title, children, testId, className = 'btn', place = 'down', ariaLabel } = props;
  const [open, setOpen] = useState(false);
  // 'side' menus open beside a scrolling rail, so they are fixed-positioned from the button (not clipped by the rail).
  const [fixed, setFixed] = useState<CSSProperties | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const r = open && place === 'side' ? button.current?.getBoundingClientRect() : undefined;
    setFixed(r && { position: 'fixed', left: r.right + 8, bottom: Math.max(8, innerHeight - r.bottom), top: 'auto' });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation(); // don't also deselect / leave the tool
      setOpen(false);
      button.current?.focus();
      return;
    }
    const items = [...(root.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to === null || !items.length) return;
    e.preventDefault();
    items[to].focus();
  };

  return (
    <div className="app-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button} type="button" className={`${className}${open ? ' active' : ''}`} title={title} aria-label={ariaLabel}
        aria-haspopup="menu" aria-expanded={open} data-testid={testId}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || open) return;
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(ITEMS)?.focus());
        }}
      >{label}</button>
      {open && (
        <div
          className={`app-menu-list${place === 'down' ? '' : ` ${place}`}`} role="menu" style={fixed}
          onClick={(e) => {
            const item = (e.target as HTMLElement).closest<HTMLElement>('[role^=menuitem]');
            if (item && !item.hasAttribute('data-keep-open')) setOpen(false);
          }}
        >{children}</div>
      )}
    </div>
  );
}

/** One menu row: icon, label (+ optional hint line), optional shortcut. */
export function MenuItem(props: {
  icon?: ReactNode; label: string; hint?: string; kbd?: string; onClick: () => void; testId?: string;
  danger?: boolean; disabled?: boolean; checked?: boolean;
}) {
  const { icon, label, hint, kbd, onClick, testId, danger, disabled, checked } = props;
  const isCheck = checked !== undefined;
  return (
    <button
      type="button" className={`app-menu-item${danger ? ' danger' : ''}`} role={isCheck ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isCheck ? checked : undefined} data-keep-open={isCheck ? '' : undefined} data-testid={testId}
      disabled={disabled} onClick={onClick}
    >
      {icon}
      <span>{label}{hint && <small>{hint}</small>}</span>
      {kbd && <kbd>{kbd}</kbd>}
      {isCheck && <span className="app-menu-check" aria-hidden>{checked && <Check size={16} />}</span>}
    </button>
  );
}
