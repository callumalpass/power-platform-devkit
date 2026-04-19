import { useEffect, useRef } from 'react';

type Shortcut = { keys: string[]; description: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Alt', '1–7'], description: 'Jump to tab (setup, console, dataverse, automate, apps, canvas, platform)' },
      { keys: ['Ctrl/⌘', 'K'], description: 'Open environment picker' },
      { keys: ['?'], description: 'Show this help' },
      { keys: ['Esc'], description: 'Close modal or dismiss active overlay' },
    ],
  },
  {
    title: 'Console',
    items: [
      { keys: ['Enter'], description: 'Send request (from the path input)' },
      { keys: ['Ctrl/⌘', 'Enter'], description: 'Send request from any console input' },
      { keys: ['Esc'], description: 'Cancel in-flight request' },
    ],
  },
  {
    title: 'Environment picker',
    items: [
      { keys: ['↑', '↓'], description: 'Move between results' },
      { keys: ['Enter'], description: 'Switch to selected environment' },
      { keys: ['Tab'], description: 'Focus stays inside the picker' },
    ],
  },
];

type Props = { onClose: () => void };

export function ShortcutHelpModal({ onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="rt-modal-backdrop shortcut-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      ref={backdropRef}
      onClick={(event) => { if (event.target === backdropRef.current) onClose(); }}
    >
      <div className="rt-modal shortcut-help-modal">
        <div className="shortcut-help-header">
          <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="shortcut-help-body">
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcut-help-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.description} className="shortcut-help-row">
                    <dt>
                      {item.keys.map((key, index) => (
                        <span key={index}>
                          <kbd>{key}</kbd>
                          {index < item.keys.length - 1 ? <span className="shortcut-help-sep">+</span> : null}
                        </span>
                      ))}
                    </dt>
                    <dd>{item.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
