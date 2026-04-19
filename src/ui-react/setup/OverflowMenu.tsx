import { useEffect, useRef, useState } from 'react';

export type OverflowItem = {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type Props = {
  items: OverflowItem[];
  label?: string;
};

export function OverflowMenu({ items, label = 'More actions' }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="setup-overflow" ref={rootRef}>
      <button
        type="button"
        className="setup-overflow-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open ? (
        <div className="setup-overflow-menu" role="menu">
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              className={`setup-overflow-item ${item.destructive ? 'destructive' : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={(event) => { event.stopPropagation(); setOpen(false); item.onClick(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
