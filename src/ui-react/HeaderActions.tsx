import { useEffect, useRef } from 'react';
import { api } from './utils.js';
import { Icon } from './Icon.js';
import type { ConfirmRequest } from './setup/ConfirmDialog.js';

type ToastLogItem = { id: number; message: string; isError: boolean; timestamp: number };

type Props = {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  toastLog: ToastLogItem[];
  clearToastLog: () => void;
  toastTrayOpen: boolean;
  setToastTrayOpen: (next: boolean) => void;
  headerMenuOpen: boolean;
  setHeaderMenuOpen: (next: boolean) => void;
  openConfirm: (request: ConfirmRequest) => void;
  openShortcutHelp: () => void;
};

function relativeTime(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function HeaderActions(props: Props) {
  const trayRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const errorCount = props.toastLog.filter((item) => item.isError).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (props.toastTrayOpen && trayRef.current && !trayRef.current.contains(target)) {
        props.setToastTrayOpen(false);
      }
      if (props.headerMenuOpen && menuRef.current && !menuRef.current.contains(target)) {
        props.setHeaderMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [props.toastTrayOpen, props.headerMenuOpen, props.setToastTrayOpen, props.setHeaderMenuOpen]);

  function requestShutdown() {
    props.openConfirm({
      title: 'Quit PP Desktop?',
      body: 'This closes the desktop app. Background CLI and MCP processes are not affected.',
      destructive: true,
      confirmLabel: 'Quit',
      onConfirm: async () => {
        try {
          await api('/api/app/quit', { method: 'POST' });
        } catch {
          // The app may exit before the confirmation request returns.
        }
      },
    });
  }

  return (
    <div className="header-actions">
      <div className="header-action-group" ref={trayRef}>
        <button
          type="button"
          className={`header-icon-btn ${errorCount ? 'has-error' : ''}`}
          title={`Recent notifications${props.toastLog.length ? ` (${props.toastLog.length})` : ''}`}
          aria-label="Recent notifications"
          onClick={() => props.setToastTrayOpen(!props.toastTrayOpen)}
        >
          <Icon name="bell" size={15} />
          {props.toastLog.length ? <span className="header-icon-badge">{props.toastLog.length > 99 ? '99+' : props.toastLog.length}</span> : null}
        </button>
        {props.toastTrayOpen ? (
          <div className="header-popover toast-tray">
            <div className="header-popover-header">
              <span>Recent</span>
              {props.toastLog.length ? (
                <button className="header-popover-action" type="button" onClick={() => { props.clearToastLog(); props.setToastTrayOpen(false); }}>Clear</button>
              ) : null}
            </div>
            <div className="toast-tray-list">
              {props.toastLog.length ? props.toastLog.map((item) => (
                <div key={item.id} className={`toast-tray-item ${item.isError ? 'error' : 'ok'}`}>
                  <span className="toast-tray-dot" aria-hidden="true" />
                  <span className="toast-tray-message">{item.message}</span>
                  <span className="toast-tray-time">{relativeTime(item.timestamp)}</span>
                </div>
              )) : <div className="toast-tray-empty">No notifications yet.</div>}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        id="theme-toggle"
        className="header-icon-btn"
        title={props.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={props.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={props.onToggleTheme}
      >
        <Icon name={props.theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>

      <div className="header-action-group" ref={menuRef}>
        <button
          type="button"
          className="header-icon-btn"
          title="More actions"
          aria-label="More actions"
          onClick={() => props.setHeaderMenuOpen(!props.headerMenuOpen)}
        >
          <Icon name="more" size={15} />
        </button>
        {props.headerMenuOpen ? (
          <div className="header-popover header-menu">
            <button
              type="button"
              className="header-menu-item"
              onClick={() => { props.setHeaderMenuOpen(false); props.openShortcutHelp(); }}
            >
              <span className="header-menu-item-icon" aria-hidden="true"><kbd>?</kbd></span>
              <span>Keyboard shortcuts</span>
            </button>
            <button
              type="button"
              className="header-menu-item danger"
              onClick={() => { props.setHeaderMenuOpen(false); requestShutdown(); }}
            >
              <Icon name="power" size={14} />
              <span>Quit PP Desktop</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
