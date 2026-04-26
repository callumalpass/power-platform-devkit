import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { CopyButton } from './CopyButton.js';
import { readEnvironmentRecency } from './env-recency.js';

type EnvironmentEntry = {
  alias: string;
  url?: string;
  displayName?: string;
  account?: string;
  tenantId?: string;
  makerEnvironmentId?: string;
  access?: { mode?: string };
};

type AccountEntry = {
  name: string;
  kind?: string;
  tenantId?: string;
  accountUsername?: string;
  loginHint?: string;
};

type Props = {
  environments: EnvironmentEntry[];
  accounts: AccountEntry[];
  current: string;
  onSelect: (alias: string) => void;
  onClose: () => void;
  toast?: (message: string, isError?: boolean) => void;
};

function score(query: string, value: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const v = value.toLowerCase();
  if (v === q) return 1000;
  if (v.startsWith(q)) return 500;
  const idx = v.indexOf(q);
  if (idx >= 0) return 200 - idx;
  let qi = 0;
  let last = -1;
  let runs = 0;
  for (let i = 0; i < v.length && qi < q.length; i++) {
    if (v[i] === q[qi]) {
      if (last === i - 1) runs++;
      last = i;
      qi++;
    }
  }
  if (qi !== q.length) return -1;
  return 50 + runs;
}

function rankEnvironment(env: EnvironmentEntry, account: AccountEntry | undefined, query: string): number {
  if (!query.trim()) return 0;
  const candidates = [env.alias, env.displayName || '', env.url || '', env.account || '', account?.accountUsername || '', account?.loginHint || '', env.tenantId || ''];
  let best = -1;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const s = score(query, candidate);
    if (s > best) best = s;
  }
  return best;
}

function hostFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentPickerModal({ environments, accounts, current, onSelect, onClose, toast }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const accountsByName = useMemo(() => {
    const map = new Map<string, AccountEntry>();
    for (const acc of accounts || []) map.set(acc.name, acc);
    return map;
  }, [accounts]);

  const recency = useMemo(() => readEnvironmentRecency(), []);

  const ranked = useMemo(() => {
    const q = query.trim();
    const list = (environments || []).map((env) => ({
      env,
      account: accountsByName.get(env.account || ''),
      score: rankEnvironment(env, accountsByName.get(env.account || ''), q),
      lastUsed: recency[env.alias] || 0
    }));
    const filtered = q ? list.filter((entry) => entry.score >= 0) : list;
    filtered.sort((a, b) => {
      if (q) {
        if (b.score !== a.score) return b.score - a.score;
        return b.lastUsed - a.lastUsed;
      }
      if (a.env.alias === current) return -1;
      if (b.env.alias === current) return 1;
      if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
      return a.env.alias.localeCompare(b.env.alias);
    });
    return filtered;
  }, [environments, accountsByName, query, current, recency]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const node = listRef.current?.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | null;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function commit(index: number) {
    const target = ranked[index];
    if (!target) return;
    onSelect(target.env.alias);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(ranked.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(ranked.length - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(activeIndex);
    }
  }

  useEffect(() => {
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const modal = modalRef.current;
      if (!modal) return;
      const focusables = modal.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !modal.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', trap);
    return () => window.removeEventListener('keydown', trap);
  }, []);

  return (
    <div
      className="rt-modal-backdrop env-picker-backdrop"
      role="dialog"
      aria-modal="true"
      ref={backdropRef}
      onClick={(event) => {
        if (event.target === backdropRef.current) onClose();
      }}
    >
      <div className="rt-modal env-picker-modal" ref={modalRef}>
        <div className="env-picker-search">
          <span className="env-picker-search-icon" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input ref={inputRef} type="text" value={query} placeholder="Search environments, accounts, URLs…" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
          <span className="env-picker-count">
            {ranked.length}/{environments?.length || 0}
          </span>
        </div>
        <div className="env-picker-list" ref={listRef}>
          {ranked.length === 0 ? (
            <div className="env-picker-empty">No matching environments.</div>
          ) : (
            ranked.map((entry, index) => {
              const env = entry.env;
              const account = entry.account;
              const isActive = index === activeIndex;
              const isCurrent = env.alias === current;
              const accountLabel = account?.accountUsername || account?.loginHint || env.account || 'no account';
              const recentlyUsed = entry.lastUsed > 0 && !query.trim();
              return (
                <div key={env.alias} data-index={index} className={`env-picker-item ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`} onMouseEnter={() => setActiveIndex(index)}>
                  <button type="button" className="env-picker-item-select" aria-label={`Switch to ${env.alias}`} onClick={() => commit(index)}>
                    <div className="env-picker-item-main">
                      <span className="env-picker-alias">{env.alias}</span>
                      {env.displayName ? <span className="env-picker-display">{env.displayName}</span> : null}
                      {env.access?.mode === 'read-only' ? <span className="env-picker-badge readonly">read-only</span> : null}
                      {recentlyUsed && !isCurrent ? <span className="env-picker-badge recent">recent</span> : null}
                    </div>
                    <div className="env-picker-item-meta">
                      <span className="env-picker-host">{hostFromUrl(env.url)}</span>
                      <span className="env-picker-account">{accountLabel}</span>
                    </div>
                  </button>
                  {env.url ? <CopyButton value={env.url} label="" title="Copy environment URL" className="env-picker-item-copy" toast={toast} stopPropagation /> : null}
                </div>
              );
            })
          )}
        </div>
        <div className="env-picker-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
