import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, formatBytes } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { Select } from '../Select.js';

const APIS = [
  {
    key: 'dv',
    label: 'Dataverse',
    scope: 'environment',
    defaultPath: '/WhoAmI',
    presets: [
      { label: 'WhoAmI', method: 'GET', path: '/WhoAmI', description: 'Current user identity' },
      { label: 'List Accounts', method: 'GET', path: '/accounts?$top=10&$select=name,accountid', description: 'Account records' },
      { label: 'Entity Metadata', method: 'GET', path: '/EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName&LabelLanguages=1033', description: 'Entity definitions' },
      { label: 'Global Option Sets', method: 'GET', path: '/GlobalOptionSetDefinitions?$top=10', description: 'Global option set metadata' }
    ]
  },
  {
    key: 'flow',
    label: 'Power Automate',
    scope: 'environment',
    defaultPath: '/flows',
    presets: [
      { label: 'List Flows', method: 'GET', path: '/flows', description: 'All flows in environment' },
      { label: 'List Flow Runs', method: 'GET', path: '/flows/{flowId}/runs', description: 'Runs for a specific flow' }
    ]
  },
  {
    key: 'powerapps',
    label: 'Power Apps',
    scope: 'environment',
    defaultPath: '/apps',
    presets: [{ label: 'List Apps', method: 'GET', path: '/apps', description: 'All apps in environment' }]
  },
  {
    key: 'bap',
    label: 'Platform (BAP)',
    scope: 'environment',
    defaultPath: '/environments',
    presets: [
      { label: 'List Environments', method: 'GET', path: '/environments', description: 'All accessible environments' },
      { label: 'Connectors', method: 'GET', path: '/connectors', description: 'Available connectors' }
    ]
  },
  {
    key: 'graph',
    label: 'Microsoft Graph',
    scope: 'account',
    defaultPath: '/me',
    presets: [
      { label: 'My Profile', method: 'GET', path: '/me', description: 'Current user profile' },
      { label: 'Organization', method: 'GET', path: '/organization', description: 'Tenant info' },
      { label: 'Users (top 10)', method: 'GET', path: '/users?$top=10', description: 'Directory users' },
      { label: 'Groups (top 10)', method: 'GET', path: '/groups?$top=10', description: 'Directory groups' }
    ]
  },
  {
    key: 'sharepoint',
    label: 'SharePoint REST',
    scope: 'account',
    defaultPath: 'https://contoso.sharepoint.com/sites/site/_api/web',
    presets: [
      { label: 'Web', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web', description: 'Current site web' },
      { label: 'Current User', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web/currentuser', description: 'Current SharePoint user' },
      { label: 'Lists', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web/lists', description: 'Site lists' }
    ]
  }
] as const;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--ok)',
  POST: 'var(--accent)',
  PUT: '#d97706',
  PATCH: '#d97706',
  DELETE: 'var(--danger)'
};

type ConsoleRequestTab = 'query' | 'headers' | 'body';
type ConsoleRailTab = 'history' | 'saved';
type ConsoleHistoryEntry = { api: string; method: string; path: string; status: number; elapsed: number };
type ConsoleSavedEntry = { api: string; method: string; path: string; name?: string };
type ConsoleResponsePreview = {
  text: string;
  truncated: boolean;
  originalBytes: number;
  shownBytes: number;
  omittedBytes: number;
};
type ConsoleResponseState = {
  status: number | 'ERR' | '';
  elapsed: string;
  body: string;
  headers: string;
  size: string;
  ok: boolean;
  truncated?: boolean;
  originalSize?: string;
};

const CONSOLE_RESPONSE_PREVIEW_BYTES = 512 * 1024;

function readConsoleHistory(): ConsoleHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('pp-console-history') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeHistoryEntry)
      .filter((entry): entry is ConsoleHistoryEntry => Boolean(entry))
      .slice(0, 50);
  } catch {
    return [];
  }
}

function readLegacyConsoleSaved(): ConsoleSavedEntry[] {
  try {
    const raw = localStorage.getItem('pp-console-saved');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSavedEntry).filter((entry): entry is ConsoleSavedEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function clearLegacyConsoleSaved() {
  try {
    localStorage.removeItem('pp-console-saved');
  } catch {
    /* ignore */
  }
}

function persistConsoleItems(key: string, items: Array<ConsoleHistoryEntry | ConsoleSavedEntry>, limit: number) {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)));
  } catch {
    // Large legacy history entries can exceed the browser quota. Dropping persistence
    // is better than letting a storage exception blank the app.
  }
}

function sanitizeHistoryEntry(value: any): ConsoleHistoryEntry | undefined {
  const saved = sanitizeSavedEntry(value);
  if (!saved) return undefined;
  return {
    ...saved,
    status: Number.isFinite(Number(value.status)) ? Number(value.status) : 0,
    elapsed: Number.isFinite(Number(value.elapsed)) ? Number(value.elapsed) : 0
  };
}

function sanitizeSavedEntry(value: any): ConsoleSavedEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const api = typeof value.api === 'string' ? value.api : '';
  const method = typeof value.method === 'string' ? value.method : '';
  const path = typeof value.path === 'string' ? value.path : '';
  if (!api || !method || !path) return undefined;
  const entry: ConsoleSavedEntry = { api, method, path };
  if (typeof value.name === 'string' && value.name.trim()) entry.name = value.name.trim().slice(0, 120);
  return entry;
}

function consoleResponseText(value: unknown, preview?: ConsoleResponsePreview): { body: string; bytes: number; truncated: boolean; originalBytes: number } {
  if (preview && typeof preview.text === 'string') {
    const notice = preview.truncated
      ? `\n\n/* pp preview: response truncated to ${formatBytes(preview.shownBytes)} of ${formatBytes(preview.originalBytes)}. Use “Load full response” to fetch everything, or narrow with $top/$select. */`
      : '';
    return {
      body: `${preview.text}${notice}`,
      bytes: preview.shownBytes,
      truncated: preview.truncated,
      originalBytes: preview.originalBytes
    };
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return truncateConsoleText(text || '');
}

function truncateConsoleText(text: string): { body: string; bytes: number; truncated: boolean; originalBytes: number } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= CONSOLE_RESPONSE_PREVIEW_BYTES) {
    return { body: text, bytes: bytes.byteLength, truncated: false, originalBytes: bytes.byteLength };
  }
  const shownBytes = bytes.slice(0, CONSOLE_RESPONSE_PREVIEW_BYTES);
  const preview = new TextDecoder().decode(shownBytes);
  const notice = `\n\n/* pp preview: response truncated to ${formatBytes(shownBytes.byteLength)} of ${formatBytes(bytes.byteLength)}. Use “Load full response” to fetch everything, or narrow with $top/$select. */`;
  return { body: `${preview}${notice}`, bytes: shownBytes.byteLength, truncated: true, originalBytes: bytes.byteLength };
}

function filterResponseBody(body: string, query: string): { text: string; matches: number } {
  if (!query) return { text: body, matches: 0 };
  const lines = body.split('\n');
  const needle = query.toLowerCase();
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) matches.push(i);
  }
  if (!matches.length) return { text: '', matches: 0 };
  const contextRange = 2;
  const keep = new Set<number>();
  for (const idx of matches) {
    for (let offset = -contextRange; offset <= contextRange; offset++) {
      const target = idx + offset;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  }
  const sorted = Array.from(keep).sort((a, b) => a - b);
  const output: string[] = [];
  let prev = -1;
  for (const idx of sorted) {
    if (prev >= 0 && idx !== prev + 1) output.push('…');
    output.push(lines[idx]);
    prev = idx;
  }
  return { text: output.join('\n'), matches: matches.length };
}

type ConsoleTabProps = {
  active: boolean;
  environment: string;
  seed: any;
  clearSeed: () => void;
  toast: (message: string, isError?: boolean) => void;
  renderResponseBody?: (value: string) => ReactNode;
};

export function ConsoleTab(props: ConsoleTabProps) {
  const { active, environment, seed, clearSeed, toast } = props;
  const [apiKey, setApiKey] = useState('dv');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/WhoAmI');
  const [queryRows, setQueryRows] = useState([{ key: '', value: '' }]);
  const [headerRows, setHeaderRows] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [requestTab, setRequestTab] = useState<ConsoleRequestTab>('query');
  const [railTab, setRailTab] = useState<ConsoleRailTab>('history');
  const [responseHeadersOpen, setResponseHeadersOpen] = useState(false);
  const [history, setHistory] = useState<ConsoleHistoryEntry[]>(readConsoleHistory);
  const [saved, setSaved] = useState<ConsoleSavedEntry[]>([]);
  const savedHydratedRef = useRef(false);
  const savedPersistSeqRef = useRef(0);
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [responseFilter, setResponseFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [response, setResponse] = useState<ConsoleResponseState>({
    status: '',
    elapsed: '',
    body: 'Send a request to see the response.',
    headers: '',
    size: '',
    ok: false
  });

  const currentApi = APIS.find((item) => item.key === apiKey) || APIS[0];
  const supportsBody = method !== 'GET' && method !== 'DELETE';

  const bodyParseError = useMemo(() => {
    if (!body.trim() || !supportsBody) return null;
    try {
      JSON.parse(body);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [body, supportsBody]);

  function findDuplicateKeys(rows: Array<{ key: string; value: string }>): string[] {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      if (count === 2) dupes.push(key);
    }
    return dupes;
  }

  const queryDupes = useMemo(() => findDuplicateKeys(queryRows), [queryRows]);
  const headerDupes = useMemo(() => findDuplicateKeys(headerRows), [headerRows]);

  useEffect(() => {
    persistConsoleItems('pp-console-history', history, 50);
  }, [history]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await api<any>('/api/ui/saved-requests');
        const serverEntries = Array.isArray(payload.data) ? (payload.data.map(sanitizeSavedEntry).filter(Boolean) as ConsoleSavedEntry[]) : [];
        const legacy = readLegacyConsoleSaved();
        if (serverEntries.length === 0 && legacy.length) {
          try {
            await api<any>('/api/ui/saved-requests', {
              method: 'PUT',
              body: JSON.stringify({ entries: legacy })
            });
            if (!cancelled) setSaved(legacy);
          } catch {
            if (!cancelled) setSaved(legacy);
          }
          clearLegacyConsoleSaved();
        } else {
          if (legacy.length) clearLegacyConsoleSaved();
          if (!cancelled) setSaved(serverEntries);
        }
      } catch {
        // Fall back to legacy localStorage so pins don't appear lost if the server is briefly unreachable.
        if (!cancelled) setSaved(readLegacyConsoleSaved());
      } finally {
        if (!cancelled) savedHydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!savedHydratedRef.current) return;
    const seq = ++savedPersistSeqRef.current;
    const entries = saved;
    const handle = window.setTimeout(() => {
      if (seq !== savedPersistSeqRef.current) return;
      void api<any>('/api/ui/saved-requests', {
        method: 'PUT',
        body: JSON.stringify({ entries })
      }).catch((error) => {
        toast(error instanceof Error ? `Failed to save pinned requests: ${error.message}` : 'Failed to save pinned requests.', true);
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [saved, toast]);

  useEffect(() => {
    if (!seed || !active) return;
    if (seed.api) setApiKey(seed.api);
    if (seed.method) setMethod(seed.method);
    if (seed.path) setPath(seed.path);
    clearSeed();
  }, [active, clearSeed, seed]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function cancelInFlight() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  async function sendRequest(options?: { fullResponse?: boolean }) {
    if (sending) {
      cancelInFlight();
      return;
    }
    if (!environment) {
      toast('Select an environment first.', true);
      return;
    }
    if (!path.trim()) {
      toast('Enter a request path.', true);
      return;
    }
    if (bodyParseError) {
      toast(`Request body is not valid JSON: ${bodyParseError}`, true);
      return;
    }
    const query = Object.fromEntries(queryRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    const headers = Object.fromEntries(headerRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    const parsedBody = body.trim() && supportsBody ? JSON.parse(body) : undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    const fullResponse = !!options?.fullResponse;
    setSending(true);
    if (fullResponse) setLoadingFull(true);
    const started = performance.now();
    try {
      const payload = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({
          environment,
          api: apiKey,
          method,
          path: path.trim(),
          query: Object.keys(query).length ? query : undefined,
          headers: Object.keys(headers).length ? headers : undefined,
          body: parsedBody,
          maxResponseBytes: fullResponse ? 0 : CONSOLE_RESPONSE_PREVIEW_BYTES
        }),
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      const elapsed = Math.round(performance.now() - started);
      const bodyValue = payload.data?.response;
      const preview = payload.data?.responsePreview as ConsoleResponsePreview | undefined;
      const bodyResult = consoleResponseText(bodyValue, preview);
      setResponse({
        status: payload.data?.status || 200,
        elapsed: `${elapsed}ms`,
        body: bodyResult.body,
        headers: payload.data?.headers
          ? Object.entries(payload.data.headers)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : '',
        size: bodyResult.truncated ? `${formatBytes(bodyResult.bytes)} shown` : formatBytes(bodyResult.bytes),
        ok: (payload.data?.status || 200) >= 200 && (payload.data?.status || 200) < 300,
        truncated: bodyResult.truncated,
        originalSize: bodyResult.truncated ? formatBytes(bodyResult.originalBytes) : undefined
      });
      setHistory((current) => [{ api: apiKey, method, path, status: payload.data?.status || 200, elapsed }, ...current].slice(0, 50));
      if (bodyResult.truncated) toast(`Large response previewed: ${formatBytes(bodyResult.bytes)} shown of ${formatBytes(bodyResult.originalBytes)}.`, false);
      else if (fullResponse) toast(`Loaded full response (${formatBytes(bodyResult.bytes)}).`, false);
    } catch (error) {
      if (controller.signal.aborted) {
        toast('Request cancelled.', false);
        return;
      }
      const elapsed = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      setResponse({
        status: 'ERR',
        elapsed: `${elapsed}ms`,
        body: JSON.stringify({ error: message }, null, 2),
        headers: '',
        size: formatBytes(new Blob([message]).size),
        ok: false
      });
      setHistory((current) => [{ api: apiKey, method, path, status: 0, elapsed }, ...current].slice(0, 50));
      toast(message, true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setLoadingFull(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && sending) {
        event.preventDefault();
        cancelInFlight();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        const panel = target?.closest?.('.console-main');
        if (panel) {
          event.preventDefault();
          void sendRequest();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, sending, environment, apiKey, method, path, body, queryRows, headerRows, bodyParseError]);

  function togglePinHistory(entry: ConsoleHistoryEntry) {
    setSaved((current) => {
      const existingIndex = current.findIndex((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
      if (existingIndex >= 0) return current.filter((_, itemIndex) => itemIndex !== existingIndex);
      return [{ api: entry.api, method: entry.method, path: entry.path }, ...current];
    });
  }

  function commitRename(index: number) {
    const trimmed = renameDraft.trim();
    setSaved((current) => current.map((item, i) => (i === index ? { ...item, name: trimmed || undefined } : item)));
    setRenameIndex(null);
    setRenameDraft('');
  }

  const filteredResponseBody = useMemo(() => {
    if (!responseFilter.trim()) return { text: response.body, matches: 0 };
    return filterResponseBody(response.body, responseFilter.trim());
  }, [response.body, responseFilter]);

  const effectiveRequestTab: ConsoleRequestTab = !supportsBody && requestTab === 'body' ? 'query' : requestTab;

  return (
    <div className="console-layout">
      <div className="console-main">
        <div className="panel">
          <div className="console-toolbar-row">
            <h2>API Console</h2>
            <Select
              className="console-preset-select"
              aria-label="Load preset"
              value=""
              placeholder="Presets..."
              onChange={(label) => {
                const preset = currentApi.presets.find((item) => item.label === label);
                if (!preset) return;
                setMethod(preset.method);
                setPath(preset.path);
                setBody('body' in preset ? String((preset as any).body || '') : '');
              }}
              options={currentApi.presets.map((preset) => ({
                value: preset.label,
                label: preset.label,
                description: preset.description
              }))}
            />
          </div>
          <div className={`console-scope-banner ${currentApi.scope}`}>
            {currentApi.scope === 'account' ? (
              <>
                <span className="console-scope-badge account">account-scoped</span>
                <span className="console-scope-description">
                  Uses the environment’s account for auth; requests go directly to {currentApi.label}. The environment selector isn’t used as a routing prefix.
                </span>
              </>
            ) : (
              <>
                <span className="console-scope-badge env">environment-scoped</span>
                <span className="console-scope-description">
                  Requests go through <strong>{environment || 'the selected environment'}</strong>.
                </span>
              </>
            )}
          </div>
          <div className="console-bar">
            <label htmlFor="console-api" className="sr-only">
              API
            </label>
            <Select
              id="console-api"
              aria-label="API"
              value={apiKey}
              onChange={(next) => {
                const nextApi = APIS.find((item) => item.key === next) || APIS[0];
                setApiKey(nextApi.key);
                setPath(nextApi.defaultPath);
              }}
              options={APIS.map((item) => ({ value: item.key, label: item.label }))}
            />
            <label htmlFor="console-method" className="sr-only">
              HTTP method
            </label>
            <Select
              id="console-method"
              aria-label="HTTP method"
              value={method}
              onChange={setMethod}
              triggerStyle={{ color: METHOD_COLORS[method] || 'var(--ink)' }}
              options={METHODS.map((item) => ({ value: item, label: item }))}
            />
            <label htmlFor="console-path" className="sr-only">
              Request path
            </label>
            <input
              type="text"
              id="console-path"
              aria-label="Request path"
              placeholder="/WhoAmI"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void sendRequest();
                }
              }}
            />
            <CopyButton value={`${method} ${path}`} label="Copy" title="Copy request line" toast={toast} />
            {sending ? (
              <button className="btn btn-danger" id="console-send" type="button" onClick={cancelInFlight}>
                Cancel
              </button>
            ) : (
              <button className="btn btn-primary" id="console-send" type="button" onClick={() => void sendRequest()}>
                Send
              </button>
            )}
          </div>
          <div className="console-bar-hint">
            <kbd>⏎</kbd> send · <kbd>Ctrl</kbd>+<kbd>⏎</kbd> send from any field · <kbd>Esc</kbd> cancel while sending · <kbd>?</kbd> all shortcuts
          </div>
          <div className="console-request-tabs">
            <button type="button" className={`console-request-tab ${effectiveRequestTab === 'query' ? 'active' : ''} ${queryDupes.length ? 'has-warning' : ''}`} onClick={() => setRequestTab('query')}>
              Query{queryRows.filter((row) => row.key.trim()).length ? <span className="console-request-tab-count">{queryRows.filter((row) => row.key.trim()).length}</span> : null}
              {queryDupes.length ? (
                <span className="console-request-tab-warn" aria-label="Duplicate keys">
                  !
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`console-request-tab ${effectiveRequestTab === 'headers' ? 'active' : ''} ${headerDupes.length ? 'has-warning' : ''}`}
              onClick={() => setRequestTab('headers')}
            >
              Headers{headerRows.filter((row) => row.key.trim()).length ? <span className="console-request-tab-count">{headerRows.filter((row) => row.key.trim()).length}</span> : null}
              {headerDupes.length ? (
                <span className="console-request-tab-warn" aria-label="Duplicate keys">
                  !
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`console-request-tab ${effectiveRequestTab === 'body' ? 'active' : ''} ${bodyParseError ? 'has-warning' : ''}`}
              disabled={!supportsBody}
              onClick={() => supportsBody && setRequestTab('body')}
              title={supportsBody ? '' : `${method} requests do not include a body.`}
            >
              Body{body.trim() && supportsBody ? <span className="console-request-tab-dot" aria-hidden="true" /> : null}
              {bodyParseError ? (
                <span className="console-request-tab-warn" aria-label="Invalid JSON">
                  !
                </span>
              ) : null}
            </button>
          </div>
          <div className="console-request-panel">
            {effectiveRequestTab === 'query' ? (
              <div className="kv-list">
                {queryDupes.length ? (
                  <div className="console-field-warning">
                    Duplicate parameter {queryDupes.length === 1 ? 'key' : 'keys'}: <code>{queryDupes.join(', ')}</code>. Only the last value per key is sent.
                  </div>
                ) : null}
                {queryRows.map((row, index) => {
                  const trimmed = row.key.trim();
                  const isDupe = trimmed && queryDupes.includes(trimmed);
                  return (
                    <div key={index} className={`kv-row ${isDupe ? 'kv-row-dupe' : ''}`}>
                      <input
                        aria-label={`Query key ${index + 1}`}
                        placeholder="key"
                        value={row.key}
                        onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item)))}
                      />
                      <input
                        aria-label={`Query value ${index + 1}`}
                        placeholder="value"
                        value={row.value}
                        onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))}
                      />
                      <button type="button" aria-label="Remove row" className="condition-remove" onClick={() => setQueryRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setQueryRows((current) => [...current, { key: '', value: '' }])}>
                  + Add parameter
                </button>
              </div>
            ) : effectiveRequestTab === 'headers' ? (
              <div className="kv-list">
                {headerDupes.length ? (
                  <div className="console-field-warning">
                    Duplicate header {headerDupes.length === 1 ? 'name' : 'names'}: <code>{headerDupes.join(', ')}</code>. Only the last value per name is sent.
                  </div>
                ) : null}
                {headerRows.map((row, index) => {
                  const trimmed = row.key.trim();
                  const isDupe = trimmed && headerDupes.includes(trimmed);
                  return (
                    <div key={index} className={`kv-row ${isDupe ? 'kv-row-dupe' : ''}`}>
                      <input
                        aria-label={`Header name ${index + 1}`}
                        placeholder="key"
                        value={row.key}
                        onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item)))}
                      />
                      <input
                        aria-label={`Header value ${index + 1}`}
                        placeholder="value"
                        value={row.value}
                        onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))}
                      />
                      <button type="button" aria-label="Remove row" className="condition-remove" onClick={() => setHeaderRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setHeaderRows((current) => [...current, { key: '', value: '' }])}>
                  + Add header
                </button>
              </div>
            ) : (
              <div className="console-body-editor">
                <textarea aria-label="Request body (JSON)" rows={8} placeholder='{ "key": "value" }' value={body} onChange={(event) => setBody(event.target.value)} />
                {bodyParseError ? <div className="console-field-error">Invalid JSON: {bodyParseError}</div> : null}
              </div>
            )}
          </div>
        </div>

        <div className="panel console-response-panel">
          <div className="console-response-header">
            <h2>
              Response <span className={`console-status-badge ${response.ok ? 'success' : response.status === 'ERR' ? 'error' : ''}`}>{response.status || '—'}</span>
            </h2>
            <div className="console-response-meta">
              {response.elapsed ? <span className="response-size">{response.elapsed}</span> : null}
              {response.size ? <span className="response-size">{response.size}</span> : null}
              {response.body ? <CopyButton value={response.body} label="Copy" title="Copy response body" toast={toast} /> : null}
            </div>
          </div>
          {response.headers ? (
            <div className="console-response-headers">
              <button type="button" className="console-response-headers-toggle" onClick={() => setResponseHeadersOpen((current) => !current)}>
                <span aria-hidden="true">{responseHeadersOpen ? '▾' : '▸'}</span> Response headers
              </button>
              {responseHeadersOpen ? (
                <div className="console-response-headers-body">
                  <div className="console-response-headers-toolbar">
                    <CopyButton value={response.headers} label="Copy headers" title="Copy response headers" toast={toast} />
                  </div>
                  <pre className="viewer">{response.headers}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
          {response.truncated ? (
            <div className="console-response-warning">
              <span className="console-response-warning-text">
                Response preview truncated. Showing {response.size}
                {response.originalSize ? ` of ${response.originalSize}` : ''}.
              </span>
              <button type="button" className="btn btn-sm btn-secondary" disabled={loadingFull || sending} onClick={() => void sendRequest({ fullResponse: true })}>
                {loadingFull ? 'Loading…' : 'Load full response'}
              </button>
            </div>
          ) : null}
          {response.body && response.body !== 'Send a request to see the response.' ? (
            <div className="console-response-filter">
              <input
                type="text"
                aria-label="Filter response body"
                placeholder="Filter response (substring across lines, shows context)…"
                value={responseFilter}
                onChange={(event) => setResponseFilter(event.target.value)}
              />
              {responseFilter ? (
                <>
                  <span className="console-response-filter-count">
                    {filteredResponseBody.matches} match{filteredResponseBody.matches === 1 ? '' : 'es'}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResponseFilter('')}>
                    Clear
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="console-response-viewer">
            {response.body && response.body !== 'Send a request to see the response.' ? (
              renderResponseBody(props.renderResponseBody, filteredResponseBody.text || (responseFilter ? `/* No matches for "${responseFilter}". */` : response.body))
            ) : (
              <EmptyState icon={<Icon name="refresh" size={18} />} title="No response yet" description="Pick an API, method and path above, then Send." compact />
            )}
          </div>
        </div>
      </div>

      <aside className="console-rail">
        <div className="panel console-rail-panel">
          <div className="console-rail-tabs">
            <button type="button" className={`console-rail-tab ${railTab === 'history' ? 'active' : ''}`} onClick={() => setRailTab('history')}>
              History{history.length ? <span className="console-rail-tab-count">{Math.min(history.length, 50)}</span> : null}
            </button>
            <button type="button" className={`console-rail-tab ${railTab === 'saved' ? 'active' : ''}`} onClick={() => setRailTab('saved')}>
              Saved{saved.length ? <span className="console-rail-tab-count">{saved.length}</span> : null}
            </button>
          </div>
          <div className="console-rail-list">
            {railTab === 'history' ? (
              history.length ? (
                history.slice(0, 20).map((entry, index) => {
                  const pinned = saved.some((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
                  return (
                    <div key={index} className="history-item">
                      <button
                        type="button"
                        className="history-item-trigger"
                        onClick={() => {
                          setApiKey(entry.api);
                          setMethod(entry.method);
                          setPath(entry.path);
                        }}
                        title={`Load ${entry.method} ${entry.path}`}
                      >
                        <div className="history-item-main">
                          <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                          <span className="history-path">{entry.path}</span>
                        </div>
                        <div className="history-item-meta">
                          <span className={`console-status-badge small ${entry.status >= 200 && entry.status < 300 ? 'success' : entry.status >= 400 ? 'error' : ''}`}>{entry.status || 'ERR'}</span>
                          <span className="history-time">{entry.elapsed}ms</span>
                        </div>
                      </button>
                      <div className="history-item-actions">
                        <button
                          type="button"
                          className={`pin-btn ${pinned ? 'pinned' : ''}`}
                          title={pinned ? 'Unpin' : 'Pin to saved'}
                          aria-label={pinned ? 'Unpin request' : 'Pin request'}
                          onClick={() => togglePinHistory(entry)}
                        >
                          <Icon name={pinned ? 'star-filled' : 'star'} size={14} />
                        </button>
                        <button
                          type="button"
                          className="pin-btn"
                          title="Remove from history"
                          aria-label="Remove from history"
                          onClick={() => setHistory((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState icon={<Icon name="reply" size={18} />} title="No requests yet" description="Send a request to see history." compact />
              )
            ) : saved.length ? (
              saved.map((entry, index) => {
                const isRenaming = renameIndex === index;
                return (
                  <div key={index} className="saved-item">
                    {isRenaming ? (
                      <div className="saved-item-main saved-item-rename">
                        <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <input
                          autoFocus
                          className="saved-item-rename-input"
                          aria-label="Rename saved request"
                          value={renameDraft}
                          placeholder={entry.path}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitRename(index);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              setRenameIndex(null);
                              setRenameDraft('');
                            }
                          }}
                          onBlur={() => commitRename(index)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="history-item-trigger saved-item-main"
                        onClick={() => {
                          setApiKey(entry.api);
                          setMethod(entry.method);
                          setPath(entry.path);
                        }}
                        title={`Load ${entry.method} ${entry.path}`}
                      >
                        <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <span className="saved-item-name">{entry.name || entry.path}</span>
                        {entry.name ? <span className="saved-item-path-hint">{entry.path}</span> : null}
                      </button>
                    )}
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="pin-btn"
                        title={entry.name ? 'Rename' : 'Name this request'}
                        aria-label="Rename saved request"
                        onClick={() => {
                          setRenameIndex(index);
                          setRenameDraft(entry.name || '');
                        }}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="pin-btn pinned"
                        title="Unpin"
                        aria-label="Unpin saved request"
                        onClick={() => setSaved((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        ✖
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState icon={<Icon name="star" size={18} />} title="No saved requests" description="Pin requests from history to keep them here." compact />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderResponseBody(render: ConsoleTabProps['renderResponseBody'], value: string): ReactNode {
  if (render) return render(value);
  return <pre className="viewer">{value}</pre>;
}
