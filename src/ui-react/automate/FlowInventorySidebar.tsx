import { flowIdentifier } from '../automate-data.js';
import { formatDateShort, prop } from '../utils.js';
import type { FlowItem } from '../ui-types.js';

export function FlowInventorySidebar(props: {
  flows: FlowItem[];
  filteredFlows: FlowItem[];
  flowSource: 'flow' | 'dv';
  filter: string;
  loading: boolean;
  currentFlow: FlowItem | null;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onSelect: (flow: FlowItem) => void;
}) {
  const { flows, filteredFlows, flowSource, filter, loading, currentFlow, onFilterChange, onRefresh, onSelect } = props;

  return (
    <div className="inventory-sidebar">
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>Flows</h2>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onRefresh}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <input type="text" className="entity-filter" placeholder="Filter flows…" value={filter} onChange={(event) => onFilterChange(event.target.value)} />
        <div className="entity-count">{flows.length ? `${flows.length} flows${flowSource === 'dv' ? ' via Dataverse fallback' : ''}` : ''}</div>
        <div className="entity-list">
          {filteredFlows.length ? (
            filteredFlows.map((flow) => {
              const state = String(prop(flow, 'properties.state') || '');
              const cls = state === 'Started' ? 'ok' : state === 'Stopped' ? 'error' : 'pending';
              return (
                <div
                  key={flowIdentifier(flow)}
                  className={`entity-item ${flowIdentifier(currentFlow) === flowIdentifier(flow) ? 'active' : ''}`}
                  data-flow={flowIdentifier(flow)}
                  onClick={() => onSelect(flow)}
                >
                  <div className="entity-item-name">
                    <span className={`health-dot ${cls}`} style={{ marginRight: 6 }}></span>
                    {prop(flow, 'properties.displayName') || flow.name || 'Unnamed'}
                  </div>
                  <div className="entity-item-logical">
                    {prop(flow, 'properties.definitionSummary.triggers.0.type') || '-'} · {formatDateShort(prop(flow, 'properties.lastModifiedTime'))}
                  </div>
                  {state ? (
                    <div className="entity-item-badges">
                      <span className="entity-item-flag">{state.toLowerCase()}</span>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="entity-loading">{loading ? 'Loading flows…' : 'Select an environment to load flows.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
