import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? 180;
    const menuHeight = menuRef.current?.offsetHeight ?? 120;
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.right - menuWidth), window.innerWidth - menuWidth - margin);
    const belowTop = rect.bottom + 4;
    const aboveTop = rect.top - menuHeight - 4;
    const top = belowTop + menuHeight + margin <= window.innerHeight ? belowTop : Math.max(margin, aboveTop);
    setMenuPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [open, items.length, updateMenuPosition]);

  const menu = open ? (
    <div
      className="setup-overflow-menu"
      role="menu"
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        right: 'auto',
        width: 'max-content',
        visibility: menuPosition ? 'visible' : 'hidden'
      }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          className={`setup-overflow-item ${item.destructive ? 'destructive' : ''}`}
          role="menuitem"
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="setup-overflow" ref={rootRef}>
      <button
        type="button"
        className="setup-overflow-trigger"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
