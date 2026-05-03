import { flowIdentifier, type FlowListMode, type FlowListSource } from '../automate-data.js';
import { formatDateShort, prop } from '../utils.js';
import type { FlowItem } from '../ui-types.js';

export function FlowInventorySidebar(props: {
  flows: FlowItem[];
  filteredFlows: FlowItem[];
  flowListMode: FlowListMode;
  flowSource: FlowListSource;
  filter: string;
  loading: boolean;
  currentFlow: FlowItem | null;
  onFilterChange: (value: string) => void;
  onFlowListModeChange: (value: FlowListMode) => void;
  onRefresh: () => void;
  onSelect: (flow: FlowItem) => void;
}) {
  const { flows, filteredFlows, flowListMode, flowSource, filter, loading, currentFlow, onFilterChange, onFlowListModeChange, onRefresh, onSelect } = props;

  return (
    <div className="inventory-sidebar">
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>Flows</h2>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onRefresh}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flow-list-mode" role="group" aria-label="Flow list source">
          {FLOW_LIST_MODES.map((mode) => (
            <button
              key={mode.value}
              className={`flow-list-mode-button ${flowListMode === mode.value ? 'active' : ''}`}
              type="button"
              disabled={loading}
              onClick={() => onFlowListModeChange(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <input type="text" className="entity-filter" placeholder="Filter flows…" value={filter} onChange={(event) => onFilterChange(event.target.value)} />
        <div className="entity-count">{flows.length ? `${flows.length} ${flowSourceLabel(flowSource, flowListMode)}` : ''}</div>
        <div className="entity-list">
          {filteredFlows.length ? (
            filteredFlows.map((flow) => {
              const state = String(prop(flow, 'properties.state') || '');
              const cls = state === 'Started' ? 'ok' : state === 'Stopped' ? 'error' : 'pending';
              const isManaged = prop(flow, 'properties.isManaged') === true;
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
                      {isManaged ? <span className="entity-item-flag">managed</span> : null}
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

const FLOW_LIST_MODES: Array<{ value: FlowListMode; label: string }> = [
  { value: 'mine', label: 'My' },
  { value: 'admin', label: 'Admin' },
  { value: 'dataverse', label: 'Dataverse' }
];

function flowSourceLabel(source: FlowListSource, mode: FlowListMode) {
  if (source === 'flow-admin') return 'admin flows';
  if (source === 'dv') return mode === 'dataverse' ? 'Dataverse rows' : 'flows via Dataverse';
  return 'my flows';
}
