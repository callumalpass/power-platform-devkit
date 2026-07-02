import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatBytes, formatDate } from './utils.js';
import { CopyButton } from './CopyButton.js';
import { EmptyState } from './EmptyState.js';
import { Icon } from './Icon.js';
import { JsonViewer } from './JsonViewer.js';
import type { ApiEnvelope, QueryLogEntry, QueryLogSettings, ToastFn } from './ui-types.js';

type QueryLogSettingsPayload = ApiEnvelope<{ path: string; settings: QueryLogSettings }>;
type QueryLogEntriesPayload = ApiEnvelope<QueryLogEntry[]>;
type ConsoleSeed = { api?: string; method?: string; path?: string; query?: Record<string, string> };

type QueryLogTabProps = {
  active: boolean;
  initialSettings?: { path: string; settings: QueryLogSettings };
  openConsole: (seed: ConsoleSeed) => void;
  toast: ToastFn;
};

export function QueryLogTab(props: QueryLogTabProps) {
  const { active, initialSettings, openConsole, toast } = props;
  const [entries, setEntries] = useState<QueryLogEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [settingsPath, setSettingsPath] = useState(initialSettings?.path || '');
  const [settings, setSettings] = useState<QueryLogSettings | null>(initialSettings?.settings || null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => entries.find((entry) => entry.id === selectedId) || entries[0], [entries, selectedId]);
  const filteredEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.api, entry.method, entry.path, entry.environmentAlias, entry.accountName, entry.source, entry.status].some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(needle)
      )
    );
  }, [entries, filter]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<QueryLogEntriesPayload>('/api/query-log?limit=300');
      const data = payload.data || [];
      setEntries(data);
      setSelectedId((current) => (current && data.some((entry) => entry.id === current) ? current : data[0]?.id || ''));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadSettings = useCallback(async () => {
    try {
      const payload = await api<QueryLogSettingsPayload>('/api/query-log/settings');
      setSettingsPath(payload.data.path);
      setSettings(payload.data.settings);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }, [toast]);

  useEffect(() => {
    if (!active) return;
    void loadEntries();
    void loadSettings();
  }, [active, loadEntries, loadSettings]);

  async function saveSettings(next: QueryLogSettings) {
    setSettings(next);
    setSaving(true);
    try {
      const payload = await api<ApiEnvelope<QueryLogSettings>>('/api/query-log/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: next })
      });
      setSettings(payload.data);
      toast('Query log settings saved');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      void loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function clearLog() {
    if (!window.confirm('Clear the query log?')) return;
    try {
      await api('/api/query-log', { method: 'DELETE' });
      setEntries([]);
      setSelectedId('');
      toast('Query log cleared');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function updateSetting<K extends keyof QueryLogSettings>(key: K, value: QueryLogSettings[K]) {
    if (!settings) return;
    void saveSettings({ ...settings, [key]: value });
  }

  return (
    <div className="query-log-layout">
      <section className="panel query-log-list-panel">
        <div className="query-log-toolbar">
          <div>
            <h2>Query Log</h2>
            {settingsPath ? <div className="query-log-path">{settingsPath}</div> : null}
          </div>
          <div className="query-log-actions">
            <input className="query-log-filter" type="text" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter log" aria-label="Filter query log" />
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => void loadEntries()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="btn btn-ghost btn-sm btn-danger-text" type="button" onClick={() => void clearLog()} disabled={!entries.length}>
              Clear
            </button>
          </div>
        </div>

        {settings ? (
          <div className="query-log-settings">
            <label className="query-log-setting">
              <input type="checkbox" checked={settings.enabled} onChange={(event) => updateSetting('enabled', event.target.checked)} disabled={saving} />
              <span>Log explicit requests</span>
            </label>
            <label className="query-log-setting">
              <input type="checkbox" checked={settings.captureResults} onChange={(event) => updateSetting('captureResults', event.target.checked)} disabled={saving || !settings.enabled} />
              <span>Capture results</span>
            </label>
            <label className="query-log-setting">
              <input type="checkbox" checked={settings.captureRequestBody} onChange={(event) => updateSetting('captureRequestBody', event.target.checked)} disabled={saving || !settings.enabled} />
              <span>Capture request bodies</span>
            </label>
            <label className="query-log-size-setting">
              <span>Result cap</span>
              <input
                type="number"
                min={1024}
                step={1024}
                value={settings.maxResultBytes}
                onChange={(event) => updateSetting('maxResultBytes', Math.max(1024, Number(event.target.value) || settings.maxResultBytes))}
                disabled={saving}
              />
            </label>
            <label className="query-log-size-setting">
              <span>File cap</span>
              <input
                type="number"
                min={1024 * 1024}
                step={1024 * 1024}
                value={settings.maxFileBytes}
                onChange={(event) => updateSetting('maxFileBytes', Math.max(1024 * 1024, Number(event.target.value) || settings.maxFileBytes))}
                disabled={saving}
              />
            </label>
          </div>
        ) : null}

        {filteredEntries.length ? (
          <div className="query-log-table-wrap">
            <table className="query-log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Elapsed</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className={selected?.id === entry.id ? 'selected' : ''} onClick={() => setSelectedId(entry.id)}>
                    <td>{formatDate(entry.timestamp)}</td>
                    <td>{entry.source}</td>
                    <td>
                      <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                      <span className="query-log-request-path">{entry.path}</span>
                    </td>
                    <td>
                      <span className={`console-status-badge small ${entry.success ? 'success' : 'error'}`}>{entry.status ?? 'ERR'}</span>
                    </td>
                    <td>{entry.elapsedMs}ms</td>
                    <td>{entry.resultCaptured ? 'captured' : 'metadata'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Icon name="reply" size={18} />}
            title="No logged requests"
            description={loading ? 'Loading query log.' : 'Send a Console request or run pp request from the CLI.'}
            compact
          />
        )}
      </section>

      <aside className="panel query-log-detail-panel">
        {selected ? (
          <QueryLogDetail entry={selected} openConsole={openConsole} toast={toast} />
        ) : (
          <EmptyState icon={<Icon name="search" size={18} />} title="No entry selected" description="Select a logged request to inspect it." compact />
        )}
      </aside>
    </div>
  );
}

function QueryLogDetail(props: { entry: QueryLogEntry; openConsole: (seed: ConsoleSeed) => void; toast: ToastFn }) {
  const { entry, openConsole, toast } = props;
  const requestLine = `${entry.method} ${entry.path}`;
  return (
    <div className="query-log-detail">
      <div className="query-log-detail-header">
        <div>
          <h2>{requestLine}</h2>
          <div className="query-log-detail-sub">
            {entry.api || 'auto'} · {entry.environmentAlias || entry.accountName || 'no scope'} · {entry.source}
          </div>
        </div>
        <div className="query-log-detail-actions">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => openConsole({ api: entry.api, method: entry.method, path: entry.path, query: entry.query })}>
            Open in Console
          </button>
          <CopyButton value={requestLine} label="Copy" title="Copy request line" toast={toast} />
        </div>
      </div>

      <dl className="query-log-fields">
        <div>
          <dt>Timestamp</dt>
          <dd>{formatDate(entry.timestamp)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{entry.status ?? 'ERR'}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{entry.elapsedMs}ms</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>{entry.resultCaptured ? previewSize(entry.responsePreview) : 'not captured'}</dd>
        </div>
      </dl>

      <Section title="Query" value={entry.query} />
      <Section title="Headers" value={entry.headers} />
      <Section title="Prepared Request" value={entry.preparedRequest} />
      <Section title="Diagnostics" value={entry.diagnostics} />
      {entry.requestBodyPreview ? <PreviewSection title="Request Body" preview={entry.requestBodyPreview} /> : null}
      {entry.responsePreview ? <PreviewSection title="Captured Result" preview={entry.responsePreview} /> : null}
      {entry.responseHeaders ? <Section title="Response Headers" value={entry.responseHeaders} /> : null}
    </div>
  );
}

function Section(props: { title: string; value: unknown }) {
  if (props.value === undefined || (Array.isArray(props.value) && props.value.length === 0)) return null;
  return (
    <section className="query-log-detail-section">
      <h3>{props.title}</h3>
      <div className="query-log-json">
        <JsonViewer value={JSON.stringify(props.value, null, 2)} />
      </div>
    </section>
  );
}

function PreviewSection(props: { title: string; preview: QueryLogEntry['responsePreview'] }) {
  if (!props.preview) return null;
  return (
    <section className="query-log-detail-section">
      <h3>
        {props.title} <span>{props.preview.truncated ? `${formatBytes(props.preview.shownBytes)} of ${formatBytes(props.preview.originalBytes)}` : formatBytes(props.preview.originalBytes)}</span>
      </h3>
      <pre className="viewer query-log-preview">{props.preview.text || '(empty)'}</pre>
    </section>
  );
}

function previewSize(preview: QueryLogEntry['responsePreview']): string {
  if (!preview) return 'captured';
  return preview.truncated ? `${formatBytes(preview.shownBytes)} of ${formatBytes(preview.originalBytes)}` : formatBytes(preview.originalBytes);
}
