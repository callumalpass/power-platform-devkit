import { useEffect, useRef } from 'react';
import { api } from './utils.js';
import { Icon } from './Icon.js';
import type { ConfirmRequest } from './setup/ConfirmDialog.js';

type ToastLogItem = { id: number; message: string; isError: boolean; timestamp: number };

type Props = {
  appName: string;
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
  const { appName, theme, onToggleTheme, toastLog, clearToastLog, toastTrayOpen, setToastTrayOpen, headerMenuOpen, setHeaderMenuOpen, openConfirm, openShortcutHelp } = props;
  const trayRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const errorCount = toastLog.filter((item) => item.isError).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (toastTrayOpen && trayRef.current && !trayRef.current.contains(target)) {
        setToastTrayOpen(false);
      }
      if (headerMenuOpen && menuRef.current && !menuRef.current.contains(target)) {
        setHeaderMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [headerMenuOpen, setHeaderMenuOpen, setToastTrayOpen, toastTrayOpen]);

  function requestShutdown() {
    openConfirm({
      title: `Quit ${appName}?`,
      body: `This closes ${appName}. Background CLI and MCP processes are not affected.`,
      destructive: true,
      confirmLabel: 'Quit',
      onConfirm: async () => {
        try {
          await api('/api/app/quit', { method: 'POST' });
        } catch {
          // The app may exit before the confirmation request returns.
        }
      }
    });
  }

  return (
    <div className="header-actions">
      <div className="header-action-group" ref={trayRef}>
        <button
          type="button"
          className={`header-icon-btn ${errorCount ? 'has-error' : ''}`}
          title={`Recent notifications${toastLog.length ? ` (${toastLog.length})` : ''}`}
          aria-label="Recent notifications"
          onClick={() => setToastTrayOpen(!toastTrayOpen)}
        >
          <Icon name="bell" size={15} />
          {toastLog.length ? <span className="header-icon-badge">{toastLog.length > 99 ? '99+' : toastLog.length}</span> : null}
        </button>
        {toastTrayOpen ? (
          <div className="header-popover toast-tray">
            <div className="header-popover-header">
              <span>Recent</span>
              {toastLog.length ? (
                <button
                  className="header-popover-action"
                  type="button"
                  onClick={() => {
                    clearToastLog();
                    setToastTrayOpen(false);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="toast-tray-list">
              {toastLog.length ? (
                toastLog.map((item) => (
                  <div key={item.id} className={`toast-tray-item ${item.isError ? 'error' : 'ok'}`}>
                    <span className="toast-tray-dot" aria-hidden="true" />
                    <span className="toast-tray-message">{item.message}</span>
                    <span className="toast-tray-time">{relativeTime(item.timestamp)}</span>
                  </div>
                ))
              ) : (
                <div className="toast-tray-empty">No notifications yet.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        id="theme-toggle"
        className="header-icon-btn"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={onToggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>

      <div className="header-action-group" ref={menuRef}>
        <button type="button" className="header-icon-btn" title="More actions" aria-label="More actions" onClick={() => setHeaderMenuOpen(!headerMenuOpen)}>
          <Icon name="more" size={15} />
        </button>
        {headerMenuOpen ? (
          <div className="header-popover header-menu">
            <button
              type="button"
              className="header-menu-item"
              onClick={() => {
                setHeaderMenuOpen(false);
                openShortcutHelp();
              }}
            >
              <span className="header-menu-item-icon" aria-hidden="true">
                <kbd>?</kbd>
              </span>
              <span>Keyboard shortcuts</span>
            </button>
            <button
              type="button"
              className="header-menu-item danger"
              onClick={() => {
                setHeaderMenuOpen(false);
                requestShutdown();
              }}
            >
              <Icon name="power" size={14} />
              <span>Quit {appName}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
