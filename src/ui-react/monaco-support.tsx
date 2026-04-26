import { useEffect, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { initVimMode, type VimAdapterInstance } from 'monaco-vim';

const MONACO_VIM_STORAGE_KEY = 'pp-monaco-vim-enabled';

type MonacoVimListener = (enabled: boolean) => void;
type MonacoVimModeChange = (mode: string) => void;
type MonacoVimAdapter = VimAdapterInstance & {
  on?: (event: string, handler: (event: unknown) => void) => void;
  off?: (event: string, handler: (event: unknown) => void) => void;
  leaveVimMode?: () => void;
};

const vimPreferenceListeners = new Set<MonacoVimListener>();
let loadedVimPreference = false;
let currentVimPreference = false;

export type MonacoVimAttachment = {
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
};

export function applyMonacoAppTheme() {
  const computed = window.getComputedStyle(document.documentElement);
  const bg = cssColor(computed, '--bg', '#f9fafb');
  const surface = cssColor(computed, '--surface', '#ffffff');
  const ink = cssColor(computed, '--ink', '#111111');
  const muted = cssColor(computed, '--muted', '#6b7280');
  const border = cssColor(computed, '--border', '#e5e7eb');
  const accent = cssColor(computed, '--accent', '#2563eb');
  const highlight = cssColor(computed, '--highlight', accent);
  const danger = cssColor(computed, '--danger', '#dc2626');
  const isDark = document.documentElement.classList.contains('dark');

  monaco.editor.defineTheme('pp-app', {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: stripHash(isDark ? '#93c5fd' : '#1d4ed8'), fontStyle: 'bold' },
      { token: 'string.value.json', foreground: stripHash(isDark ? '#86efac' : '#047857') },
      { token: 'number.json', foreground: stripHash(isDark ? '#fbbf24' : '#b45309') },
      { token: 'keyword.json', foreground: stripHash(isDark ? '#c4b5fd' : '#7c3aed'), fontStyle: 'bold' },
      { token: 'delimiter.bracket.json', foreground: stripHash(isDark ? '#cbd5e1' : '#475569') },
      { token: 'delimiter.array.json', foreground: stripHash(isDark ? '#f9a8d4' : '#be185d') },
      { token: 'delimiter.colon.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b') },
      { token: 'delimiter.comma.json', foreground: stripHash(isDark ? '#64748b' : '#94a3b8') },
      { token: 'comment.line.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b'), fontStyle: 'italic' },
      { token: 'comment.block.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b'), fontStyle: 'italic' }
    ],
    colors: {
      'editor.background': surface,
      'editor.foreground': ink,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': ink,
      'editorCursor.foreground': ink,
      'editor.selectionBackground': rgbaHex(highlight, isDark ? 0.32 : 0.22),
      'editor.inactiveSelectionBackground': rgbaHex(highlight, isDark ? 0.18 : 0.12),
      'editor.lineHighlightBackground': isDark ? '#1f1a15' : '#f0e9dc',
      'editorLineNumber.dimmedForeground': muted,
      'editorGutter.background': bg,
      'editorWidget.background': surface,
      'editorWidget.foreground': ink,
      'editorWidget.border': border,
      'input.background': bg,
      'input.foreground': ink,
      'input.border': border,
      'list.hoverBackground': rgbaHex(highlight, isDark ? 0.1 : 0.08),
      'list.hoverForeground': ink,
      'list.activeSelectionBackground': rgbaHex(highlight, isDark ? 0.22 : 0.18),
      'list.activeSelectionForeground': ink,
      'list.activeSelectionIconForeground': ink,
      'list.focusBackground': rgbaHex(highlight, isDark ? 0.22 : 0.18),
      'list.focusForeground': ink,
      'list.focusOutline': 'transparent',
      'list.inactiveSelectionBackground': rgbaHex(highlight, isDark ? 0.14 : 0.1),
      'list.inactiveSelectionForeground': ink,
      'list.highlightForeground': highlight,
      'list.focusHighlightForeground': highlight,
      'quickInputList.focusBackground': rgbaHex(highlight, isDark ? 0.22 : 0.18),
      'quickInputList.focusForeground': ink,
      'editorSuggestWidget.background': surface,
      'editorSuggestWidget.foreground': ink,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': rgbaHex(highlight, isDark ? 0.22 : 0.18),
      'editorSuggestWidget.selectedForeground': ink,
      'editorSuggestWidget.selectedIconForeground': ink,
      'editorSuggestWidget.focusHighlightForeground': highlight,
      'editorSuggestWidget.highlightForeground': highlight,
      'editorHoverWidget.background': surface,
      'editorHoverWidget.foreground': ink,
      'editorHoverWidget.border': border,
      'menu.background': surface,
      'menu.foreground': ink,
      'menu.selectionBackground': rgbaHex(highlight, isDark ? 0.22 : 0.18),
      'menu.selectionForeground': ink,
      'menu.separatorBackground': border,
      'scrollbarSlider.background': rgbaHex(muted, isDark ? 0.3 : 0.2),
      'scrollbarSlider.hoverBackground': rgbaHex(muted, isDark ? 0.42 : 0.32),
      'scrollbarSlider.activeBackground': rgbaHex(muted, isDark ? 0.52 : 0.42),
      'editorError.foreground': danger,
      'editorWarning.foreground': isDark ? '#fbbf24' : '#d97706',
      'editorInfo.foreground': highlight
    }
  });
  monaco.editor.setTheme('pp-app');
}

export function useMonacoVimPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => readMonacoVimPreference());

  useEffect(() => {
    const listener = (next: boolean) => setEnabledState(next);
    vimPreferenceListeners.add(listener);
    return () => {
      vimPreferenceListeners.delete(listener);
    };
  }, []);

  return [enabled, setMonacoVimPreference];
}

export function MonacoVimToggle(props: { enabled: boolean; mode: string; onToggle: (enabled: boolean) => void; disabled?: boolean }) {
  const { enabled, mode, onToggle, disabled } = props;
  const normalizedMode = normalizeVimMode(mode);
  const label = enabled ? `Vim ${normalizedMode.toUpperCase()}` : 'Vim Off';
  return (
    <button
      className={`monaco-vim-toggle ${enabled ? 'active' : ''} ${normalizedMode}`}
      type="button"
      aria-pressed={enabled}
      disabled={disabled}
      title={enabled ? 'Disable Vim keybindings for Monaco editors' : 'Enable Vim keybindings for Monaco editors'}
      onClick={() => onToggle(!enabled)}
    >
      {label}
    </button>
  );
}

export function attachMonacoVim(editor: monaco.editor.IStandaloneCodeEditor, statusNode: HTMLElement | null, options: { enabled: boolean; onModeChange?: MonacoVimModeChange }): MonacoVimAttachment {
  let vim: MonacoVimAdapter | null = null;
  let disposed = false;

  const onModeChange = (event: unknown) => {
    options.onModeChange?.(readModeChange(event));
  };

  const setEnabled = (enabled: boolean) => {
    if (disposed) return;
    if (enabled) {
      if (vim) return;
      statusNode?.replaceChildren();
      vim = initVimMode(editor, statusNode) as MonacoVimAdapter;
      vim.on?.('vim-mode-change', onModeChange);
      options.onModeChange?.('normal');
      return;
    }
    if (!vim) {
      options.onModeChange?.('off');
      return;
    }
    vim.off?.('vim-mode-change', onModeChange);
    vim.leaveVimMode?.();
    vim.dispose();
    vim = null;
    statusNode?.replaceChildren();
    options.onModeChange?.('off');
  };

  setEnabled(options.enabled);

  return {
    setEnabled,
    dispose: () => {
      disposed = true;
      if (vim) {
        vim.off?.('vim-mode-change', onModeChange);
        vim.leaveVimMode?.();
        vim.dispose();
        vim = null;
      }
      statusNode?.replaceChildren();
      options.onModeChange?.('off');
    }
  };
}

export function normalizeVimMode(mode: string | undefined) {
  const normalized = String(mode || 'off').toLowerCase();
  if (normalized.includes('insert')) return 'insert';
  if (normalized.includes('visual')) return 'visual';
  if (normalized.includes('replace')) return 'replace';
  if (normalized.includes('normal')) return 'normal';
  return normalized === 'off' ? 'off' : normalized;
}

export function isMonacoKeyboardEvent(event: KeyboardEvent): boolean {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.closest('.monaco-editor, .monaco-diff-editor')) {
    return true;
  }
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const item of path) {
    if (item instanceof HTMLElement && item.closest('.monaco-editor, .monaco-diff-editor')) return true;
  }
  const target = event.target;
  return target instanceof HTMLElement && Boolean(target.closest('.monaco-editor, .monaco-diff-editor'));
}

function readMonacoVimPreference() {
  if (loadedVimPreference) return currentVimPreference;
  loadedVimPreference = true;
  if (typeof window === 'undefined') return currentVimPreference;
  try {
    currentVimPreference = window.localStorage.getItem(MONACO_VIM_STORAGE_KEY) === 'true';
  } catch {
    currentVimPreference = false;
  }
  return currentVimPreference;
}

function setMonacoVimPreference(enabled: boolean) {
  loadedVimPreference = true;
  currentVimPreference = enabled;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MONACO_VIM_STORAGE_KEY, String(enabled));
    } catch {
      // Preference persistence is best effort; the in-memory toggle still works.
    }
  }
  for (const listener of vimPreferenceListeners) listener(enabled);
}

function readModeChange(event: unknown) {
  if (typeof event === 'string') return event;
  if (event && typeof event === 'object' && 'mode' in event) {
    return String((event as { mode?: unknown }).mode || 'normal');
  }
  return 'normal';
}

function cssColor(computed: CSSStyleDeclaration, name: string, fallback: string) {
  return computed.getPropertyValue(name).trim() || fallback;
}

function stripHash(color: string) {
  return color.startsWith('#') ? color.slice(1) : color;
}

function rgbaHex(color: string, alpha: number) {
  if (!color.startsWith('#')) return color;
  const hex =
    color.length === 4
      ? color
          .slice(1)
          .split('')
          .map((value) => value + value)
          .join('')
      : color.slice(1);
  if (hex.length !== 6) return color;
  const value = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${hex}${value}`;
}
