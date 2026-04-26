import { ReactNode, useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function DetailPanel({ open, title, subtitle, onClose, children, footer }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (editable) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <section ref={rootRef} className="setup-detail-panel" aria-label={title}>
      <header className="setup-detail-panel-header">
        <div className="setup-detail-panel-titles">
          <h2>{title}</h2>
          {subtitle ? <div className="setup-detail-panel-subtitle">{subtitle}</div> : null}
        </div>
        <button type="button" className="setup-detail-panel-close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="setup-detail-panel-body">{children}</div>
      {footer ? <div className="setup-detail-panel-footer">{footer}</div> : null}
    </section>
  );
}
