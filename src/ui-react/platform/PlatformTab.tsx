import { Dispatch, SetStateAction } from 'react';
import { formatDate, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { InventorySidebar } from '../InventorySidebar.js';

export type PlatformState = { loadedEnvironment: string; items: any[]; current: any; filter: string };

export function PlatformTab(props: { state: any; setState: Dispatch<SetStateAction<PlatformState>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, reload, openConsole, toast } = props;

  return (
    <>
      <InventorySidebar
        title="Environments"
        countLabel="environments"
        filterPlaceholder="Filter environments…"
        items={state.items}
        filter={state.filter}
        onFilterChange={(next) => setState((current: any) => ({ ...current, filter: next }))}
        matchItem={(item: any, query) => {
          const name = String(prop(item, 'properties.displayName') || item.name || '').toLowerCase();
          const id = String(item.name || '').toLowerCase();
          return name.includes(query) || id.includes(query);
        }}
        isSelected={(item: any) => state.current?.name === item.name}
        itemKey={(item: any) => item.name}
        onSelect={(item: any) => setState((current: any) => ({ ...current, current: item }))}
        onRefresh={() => void reload().then(() => toast('Environments refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}
        emptyHint="Select an environment to discover platform environments."
        renderItem={(item: any) => (
          <>
            <div className="entity-item-name">
              <span className={`health-dot ${prop(item, 'properties.states.management.id') === 'Ready' ? 'ok' : 'pending'}`} style={{ marginRight: 6 }}></span>
              {prop(item, 'properties.displayName') || item.name || 'Unnamed'}
            </div>
            <div className="entity-item-logical">{item.name}</div>
          </>
        )}
      />
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="plat-env-detail-empty">
              <EmptyState icon={<Icon name="circle" size={18} />} title="Environment Detail" description="Select an environment from the list to inspect its platform metadata." />
            </div>
          ) : (
            <div id="plat-env-detail">
              <div className="toolbar-row">
                <div>
                  <h2 id="plat-env-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc no-mb" id="plat-env-subtitle">{state.current.name}</p>
                </div>
                <button className="btn btn-ghost" id="plat-env-open-console" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(`/environments/${state.current.name}`)}>Open in Console</button>
              </div>
              <div id="plat-env-metrics" className="metrics">
                {[
                  ['SKU', prop(state.current, 'properties.environmentSku') || '-'],
                  ['Location', state.current.location || '-'],
                  ['State', prop(state.current, 'properties.states.management.id') || '-'],
                  ['Default', prop(state.current, 'properties.isDefault') ? 'Yes' : 'No'],
                  ['Created', formatDate(prop(state.current, 'properties.createdTime'))],
                  ['Type', prop(state.current, 'properties.environmentType') || state.current.type || '-'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value copy-inline">
                      <span className="copy-inline-value">{String(value)}</span>
                      <CopyButton value={value} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                    </div>
                  </div>
                ))}
              </div>
              <div id="plat-env-linked">
                {prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl') ? (
                  <div className="metrics">
                    <div className="metric">
                      <div className="metric-label">Instance URL</div>
                      <div className="metric-value copy-inline">
                        <span className="copy-inline-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl')}</span>
                        <CopyButton value={prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl')} label="copy" title="Copy instance URL" toast={toast} />
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Domain</div>
                      <div className="metric-value copy-inline">
                        <span className="copy-inline-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.domainName') || '-'}</span>
                        <CopyButton value={prop(state.current, 'properties.linkedEnvironmentMetadata.domainName') || ''} label="copy" title="Copy domain" toast={toast} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
