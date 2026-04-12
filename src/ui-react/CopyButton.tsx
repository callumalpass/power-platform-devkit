import type { MouseEvent } from 'react';
import type { ToastFn } from './ui-types.js';

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back for browsers/contexts where navigator.clipboard is unavailable or denied.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Copy command was not accepted by the browser.');
  } finally {
    document.body.removeChild(textarea);
  }
}

export function CopyButton(props: {
  value: unknown;
  label?: string;
  title?: string;
  className?: string;
  toast?: ToastFn;
  stopPropagation?: boolean;
}) {
  const { value, label = 'Copy', title = 'Copy to clipboard', className = 'copy-mini', toast, stopPropagation } = props;
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <button
      className={className}
      type="button"
      title={title}
      disabled={!text}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        if (!text) return;
        void copyTextToClipboard(text)
          .then(() => toast?.('Copied to clipboard'))
          .catch((error) => toast?.(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true));
      }}
    >
      {label}
    </button>
  );
}
