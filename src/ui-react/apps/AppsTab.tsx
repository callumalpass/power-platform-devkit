import { Dispatch, SetStateAction } from 'react';
import { formatDate, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { InventorySidebar } from '../InventorySidebar.js';
import { RecordDetailModal, useRecordDetail } from '../RecordDetailModal.js';
import type { PowerPlatformInventoryItem } from '../ui-types.js';

export type AppsState = { loadedEnvironment: string; items: PowerPlatformInventoryItem[]; current: PowerPlatformInventoryItem | null; filter: string };

export function AppsTab(props: { state: AppsState; setState: Dispatch<SetStateAction<AppsState>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, environment, reload, openConsole, toast } = props;
  const detail = useRecordDetail();
  const current = state.current;

  return (
    <>
      <InventorySidebar
        title="Apps"
        countLabel="apps"
        filterPlaceholder="Filter apps…"
        items={state.items}
        filter={state.filter}
        onFilterChange={(next) => setState((current) => ({ ...current, filter: next }))}
        matchItem={(item: PowerPlatformInventoryItem, query) => {
          const name = String(prop(item, 'properties.displayName') || item.name || '').toLowerCase();
          return name.includes(query);
        }}
        isSelected={(item: PowerPlatformInventoryItem) => state.current?.name === item.name}
        itemKey={(item: PowerPlatformInventoryItem) => item.name}
        onSelect={(item: PowerPlatformInventoryItem) => setState((current) => ({ ...current, current: item }))}
        onRefresh={() => void reload().then(() => toast('Apps refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}
        emptyHint="Select an environment to load apps."
        renderItem={(item: PowerPlatformInventoryItem) => (
          <>
            <div className="entity-item-name">{prop(item, 'properties.displayName') || item.name || 'Unnamed'}</div>
            <div className="entity-item-logical">{item.name}</div>
            {prop(item, 'properties.appType') ? <div className="entity-item-badges"><span className="entity-item-flag">{String(prop(item, 'properties.appType')).replace(/([a-z])([A-Z])/g, '$1 $2')}</span></div> : null}
          </>
        )}
      />
      <div className="detail-area">
        <div className="panel">
          {!current ? (
            <div id="app-detail-empty">
              <EmptyState icon={<Icon name="grid" size={18} />} title="App Detail" description="Select an app from the list to inspect its metadata and connections." />
            </div>
          ) : (
            <div id="app-detail">
              <div className="toolbar-row">
                <div>
                  <h2 id="app-title">{prop(current, 'properties.displayName') || current.name}</h2>
                  <p className="desc no-mb" id="app-subtitle">{prop(current, 'properties.description') || current.name}</p>
                </div>
                <button className="btn btn-ghost" id="app-open-console" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(`/apps/${current.name}`)}>Open in Console</button>
              </div>
              <div id="app-metrics" className="metrics">
                {[
                  ['App Type', prop(current, 'properties.appType') || '-'],
                  ['Created', formatDate(prop(current, 'properties.createdTime'))],
                  ['Modified', formatDate(prop(current, 'properties.lastModifiedTime'))],
                  ['Published', formatDate(prop(current, 'properties.lastPublishTime'))],
                  ['App ID', current.name],
                ].map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value copy-inline">
                      {label === 'App ID' ? (
                        <span className="record-link" onClick={() => detail.open('canvasapp', 'canvasapps', String(value))}>{String(value).slice(0, 8)}...</span>
                      ) : (
                        <span className="copy-inline-value">{String(value)}</span>
                      )}
                      <CopyButton value={value} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                    </div>
                  </div>
                ))}
              </div>
              <div id="app-connections">
                {Object.entries(prop(current, 'properties.connectionReferences') || {}).map(([key, value]) => {
                  const connection = value && typeof value === 'object' ? value as Record<string, unknown> : {};
                  return (
                    <div key={key} className="card-item" style={{ padding: '8px 10px' }}>
                      <div className="card-item-info">
                        <div className="card-item-title">{String(connection.displayName || key)}</div>
                        <div className="card-item-sub copy-inline">
                          <span className="copy-inline-value">{String(connection.id || '')}</span>
                          {connection.id ? <CopyButton value={connection.id} label="copy" title="Copy connection ID" toast={toast} /> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {detail.target && environment && (
        <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />
      )}
    </>
  );
}
