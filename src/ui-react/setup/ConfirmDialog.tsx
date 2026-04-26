import { useEffect, useRef, useState } from 'react';

export type ConfirmRequest = {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** If set, the user must type this string before confirm is enabled. */
  typedConfirmation?: string;
  onConfirm: () => void | Promise<void>;
};

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    request,
    open: (next: ConfirmRequest) => setRequest(next),
    close: () => setRequest(null)
  };
}

export function ConfirmDialog(props: { request: ConfirmRequest | null; onClose: () => void }) {
  const { request, onClose } = props;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) {
      setTyped('');
      setBusy(false);
      return;
    }
    const focusTarget = request.typedConfirmation ? inputRef.current : confirmRef.current;
    focusTarget?.focus();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, busy, onClose]);

  if (!request) return null;

  const typedOk = !request.typedConfirmation || typed === request.typedConfirmation;

  async function handleConfirm() {
    if (!request || !typedOk || busy) return;
    setBusy(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const confirmClass = request.destructive ? 'btn btn-destructive btn-sm' : 'btn btn-primary btn-sm';

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-title" id="confirm-title">
          {request.title}
        </div>
        <div className="confirm-body">{request.body}</div>
        {request.typedConfirmation ? (
          <>
            <div className="confirm-typed-prompt">
              Type <code>{request.typedConfirmation}</code> to confirm.
            </div>
            <input
              ref={inputRef}
              className="confirm-typed-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && typedOk) void handleConfirm();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </>
        ) : null}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {request.cancelLabel || 'Cancel'}
          </button>
          <button ref={confirmRef} type="button" className={confirmClass} onClick={() => void handleConfirm()} disabled={!typedOk || busy}>
            {busy ? 'Working…' : request.confirmLabel || (request.destructive ? 'Remove' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
