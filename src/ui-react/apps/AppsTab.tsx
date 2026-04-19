import { Dispatch, SetStateAction } from 'react';
import { formatDate, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { InventorySidebar } from '../InventorySidebar.js';
import { RecordDetailModal, useRecordDetail } from '../RecordDetailModal.js';

export type AppsState = { loadedEnvironment: string; items: any[]; current: any; filter: string };

export function AppsTab(props: { state: any; setState: Dispatch<SetStateAction<AppsState>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, environment, reload, openConsole, toast } = props;
  const detail = useRecordDetail();

  return (
    <>
      <InventorySidebar
        title="Apps"
        countLabel="apps"
        filterPlaceholder="Filter apps…"
        items={state.items}
        filter={state.filter}
        onFilterChange={(next) => setState((current: any) => ({ ...current, filter: next }))}
        matchItem={(item: any, query) => {
          const name = String(prop(item, 'properties.displayName') || item.name || '').toLowerCase();
          return name.includes(query);
        }}
        isSelected={(item: any) => state.current?.name === item.name}
        itemKey={(item: any) => item.name}
        onSelect={(item: any) => setState((current: any) => ({ ...current, current: item }))}
        onRefresh={() => void reload().then(() => toast('Apps refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}
        emptyHint="Select an environment to load apps."
        renderItem={(item: any) => (
          <>
            <div className="entity-item-name">{prop(item, 'properties.displayName') || item.name || 'Unnamed'}</div>
            <div className="entity-item-logical">{item.name}</div>
            {prop(item, 'properties.appType') ? <div className="entity-item-badges"><span className="entity-item-flag">{String(prop(item, 'properties.appType')).replace(/([a-z])([A-Z])/g, '$1 $2')}</span></div> : null}
          </>
        )}
      />
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="app-detail-empty">
              <EmptyState icon={<Icon name="grid" size={18} />} title="App Detail" description="Select an app from the list to inspect its metadata and connections." />
            </div>
          ) : (
            <div id="app-detail">
              <div className="toolbar-row">
                <div>
                  <h2 id="app-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc no-mb" id="app-subtitle">{prop(state.current, 'properties.description') || state.current.name}</p>
                </div>
                <button className="btn btn-ghost" id="app-open-console" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(`/apps/${state.current.name}`)}>Open in Console</button>
              </div>
              <div id="app-metrics" className="metrics">
                {[
                  ['App Type', prop(state.current, 'properties.appType') || '-'],
                  ['Created', formatDate(prop(state.current, 'properties.createdTime'))],
                  ['Modified', formatDate(prop(state.current, 'properties.lastModifiedTime'))],
                  ['Published', formatDate(prop(state.current, 'properties.lastPublishTime'))],
                  ['App ID', state.current.name],
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
                {Object.entries(prop(state.current, 'properties.connectionReferences') || {}).map(([key, value]: [string, any]) => (
                  <div key={key} className="card-item" style={{ padding: '8px 10px' }}>
                    <div className="card-item-info">
                      <div className="card-item-title">{value.displayName || key}</div>
                      <div className="card-item-sub copy-inline">
                        <span className="copy-inline-value">{value.id || ''}</span>
                        {value.id ? <CopyButton value={value.id} label="copy" title="Copy connection ID" toast={toast} /> : null}
                      </div>
                    </div>
                  </div>
                ))}
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

