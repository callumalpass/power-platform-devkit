import { useEffect, useState } from 'react';

type DataverseBridgeState = {
  environment: string;
  entities: any[];
  currentEntity: any;
  currentEntityDetail: any;
  selectedColumns: string[];
};

let legacyStatePromise: Promise<any> | null = null;
let legacyFetchXmlPromise: Promise<any> | null = null;
let legacyRelationshipsPromise: Promise<any> | null = null;
let legacyAutomatePromise: Promise<any> | null = null;
let fetchXmlInitialized = false;
let relationshipsInitialized = false;
let automateInitialized = false;

function loadLegacyState() {
  if (!legacyStatePromise) {
    const url = '/assets/ui/state.js';
    legacyStatePromise = import(url);
  }
  return legacyStatePromise;
}

function loadLegacyFetchXml() {
  if (!legacyFetchXmlPromise) {
    const url = '/assets/ui/fetchxml.js';
    legacyFetchXmlPromise = import(url);
  }
  return legacyFetchXmlPromise;
}

function loadLegacyRelationships() {
  if (!legacyRelationshipsPromise) {
    const url = '/assets/ui/relationships.js';
    legacyRelationshipsPromise = import(url);
  }
  return legacyRelationshipsPromise;
}

function loadLegacyAutomate() {
  if (!legacyAutomatePromise) {
    const url = '/assets/ui/automate.js';
    legacyAutomatePromise = import(url);
  }
  return legacyAutomatePromise;
}

export function useLegacyDataverseBridge(state: DataverseBridgeState) {
  useEffect(() => {
    let cancelled = false;
    loadLegacyState()
      .then((legacyState) => {
        if (cancelled) return;
        legacyState.setEntitiesForEnvironment(state.environment, state.entities);
        legacyState.setCurrentEntity(state.currentEntity || null);
        legacyState.setCurrentEntityDetail(state.currentEntityDetail || null);
        legacyState.setSelectedColumns(state.selectedColumns || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state.currentEntity, state.currentEntityDetail, state.entities, state.environment, state.selectedColumns]);
}

export function LegacyFetchXmlPanel(props: { dataverse: DataverseBridgeState; active: boolean; onError: (message: string) => void }) {
  const { dataverse, active, onError } = props;
  const [ready, setReady] = useState(false);

  useLegacyDataverseBridge(dataverse);

  useEffect(() => {
    let cancelled = false;
    loadLegacyFetchXml()
      .then((legacyFetchXml) => {
        if (cancelled) return;
        if (!fetchXmlInitialized) {
          legacyFetchXml.initFetchXml();
          fetchXmlInitialized = true;
        }
        legacyFetchXml.updateFetchContext();
        setReady(true);
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!ready || !active) return;
    loadLegacyFetchXml()
      .then((legacyFetchXml) => legacyFetchXml.updateFetchContext())
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [active, dataverse.currentEntityDetail, dataverse.entities, onError, ready]);

  return (
    <div className="dv-subpanel" id="dv-subpanel-dv-fetchxml">
      <div className="panel">
        <h2>FetchXML</h2>
        <div className="entity-context" id="fetch-entity-context">
          <span className="entity-context-empty">No entity selected — pick one in Explorer or fill in the fields below</span>
        </div>
        <form id="fetchxml-form">
          <div className="field">
            <span className="field-label">FetchXML</span>
            <div className="fetchxml-editor-shell">
              <div className="fetchxml-editor-toolbar">
                <div className="fetchxml-editor-toolbar-left">
                  <span id="fetch-editor-status"><span className="fetchxml-status-dot"></span>IntelliSense ready</span>
                  <span id="fetch-vim-mode" className="fetchxml-vim-mode normal">NORMAL</span>
                </div>
                <div className="fetchxml-editor-toolbar-right">
                  <span>Autocomplete for FetchXML structure, entities, attributes, operators, and join fields. Vim mode enabled.</span>
                </div>
              </div>
              <div id="fetch-editor" className="fetchxml-editor-mount"></div>
            </div>
            <textarea
              name="rawXml"
              id="fetch-raw"
              className="xml-editor"
              hidden
              placeholder={`<fetch top="50">\n  <entity name="account">\n    <attribute name="name" />\n  </entity>\n</fetch>`}
            />
            <div id="fetch-diagnostics" className="fetchxml-diagnostics"></div>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" id="fetch-run-btn" type="button">Run FetchXML</button>
            <button className="btn btn-secondary" id="fetch-preview-btn" type="button">Build from fields below</button>
          </div>
          <details style={{ marginTop: 4 }} id="fetch-builder">
            <summary style={{ cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--muted)' }}>Form builder</summary>
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Entity</span>
                  <select name="entity" id="fetch-entity"><option value="">select entity…</option></select>
                </div>
                <div className="field">
                  <span className="field-label">Entity Set Name</span>
                  <input name="entitySetName" id="fetch-entity-set" placeholder="accounts" readOnly tabIndex={-1} style={{ color: 'var(--muted)' }} />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Attributes</span>
                <div id="fetch-attr-picker" className="attr-picker"></div>
                <input name="attributesCsv" id="fetch-attrs" type="hidden" />
              </div>
              <div className="form-row three">
                <div className="field"><span className="field-label">Top</span><input name="top" type="number" min="1" step="1" defaultValue="50" /></div>
                <div className="field"><span className="field-label">Distinct</span><select name="distinct" id="fetch-distinct"><option value="false">false</option><option value="true">true</option></select></div>
                <div className="field"><span className="field-label">Filter Type</span><select id="fetch-filter-type"><option value="and">and</option><option value="or">or</option></select></div>
              </div>
              <div className="field">
                <span className="field-label">Conditions</span>
                <div id="fetch-conditions" className="condition-list"></div>
                <button type="button" className="btn btn-ghost" id="fetch-add-condition" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }}>+ Add condition</button>
              </div>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Order By</span>
                  <select id="order-attribute"><option value="">none</option></select>
                </div>
                <div className="field">
                  <span className="field-label">Direction</span>
                  <select id="order-desc"><option value="false">ascending</option><option value="true">descending</option></select>
                </div>
              </div>
              <div className="field">
                <span className="field-label">Link Entities (Joins)</span>
                <div id="fetch-links" className="link-list"></div>
                <button type="button" className="btn btn-ghost" id="fetch-add-link" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }}>+ Add join</button>
              </div>
            </div>
          </details>
        </form>
      </div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2>FetchXML Result</h2>
          <div className="result-toggle" id="fetch-result-toggle">
            <button className="result-toggle-btn active" data-view="table">Table</button>
            <button className="result-toggle-btn" data-view="json">JSON</button>
          </div>
        </div>
        <div id="fetch-result-table"></div>
        <pre className="viewer" id="fetch-result" style={{ display: 'none' }}>Run FetchXML to see the response.</pre>
      </div>
    </div>
  );
}

export function LegacyRelationshipsPanel(props: { dataverse: DataverseBridgeState; onError: (message: string) => void }) {
  const { dataverse, onError } = props;

  useLegacyDataverseBridge(dataverse);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadLegacyRelationships(), loadLegacyState()])
      .then(([legacyRelationships]) => {
        if (cancelled) return;
        if (!relationshipsInitialized) {
          legacyRelationships.initRelationships();
          relationshipsInitialized = true;
        }
        legacyRelationships.updateRelationshipsEntityList();
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    loadLegacyRelationships()
      .then((legacyRelationships) => legacyRelationships.updateRelationshipsEntityList())
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [dataverse.currentEntityDetail, dataverse.entities, onError]);

  return (
    <div className="dv-subpanel" id="dv-subpanel-dv-relationships">
      <div className="panel" style={{ padding: 14 }}>
        <div className="rel-toolbar">
          <select id="rel-entity" style={{ maxWidth: 240 }}></select>
          <div className="rel-toolbar-group">
            <label className="rel-toolbar-label">Depth</label>
            <select id="rel-depth" style={{ width: 60 }} defaultValue="2">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
          <label className="rel-toolbar-check"><input type="checkbox" id="rel-hide-system" defaultChecked /> Hide system</label>
          <button className="btn btn-primary" id="rel-load" style={{ padding: '5px 14px', fontSize: '0.75rem' }}>Load Graph</button>
          <span id="rel-status" style={{ fontSize: '0.6875rem', color: 'var(--muted)', marginLeft: 'auto' }}></span>
        </div>
        <div className="rel-canvas-container" id="rel-container">
          <svg id="rel-svg" className="rel-svg" xmlns="http://www.w3.org/2000/svg"></svg>
          <div id="rel-tooltip" className="rel-tooltip hidden"></div>
          <div className="rel-hint">Select an entity and click Load Graph. Click a node to expand or explore. Drag to rearrange. Scroll to zoom.</div>
        </div>
      </div>
    </div>
  );
}

export function LegacyAutomatePanel(props: { active: boolean; environment: string; onError: (message: string) => void }) {
  const { active, environment, onError } = props;

  useEffect(() => {
    let cancelled = false;
    loadLegacyAutomate()
      .then((legacyAutomate) => {
        if (cancelled) return;
        if (!automateInitialized) {
          legacyAutomate.initAutomate();
          automateInitialized = true;
        }
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!active) return;
    loadLegacyAutomate()
      .then((legacyAutomate) => {
        if (!environment) {
          legacyAutomate.resetFlows();
          return;
        }
        return legacyAutomate.loadFlows();
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [active, environment, onError]);

  return (
    <div className="tab-panel" id="panel-automate">
      <div className="inventory-sidebar">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2>Flows</h2>
            <button className="btn btn-ghost" id="flow-refresh" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>Refresh</button>
          </div>
          <input type="text" id="flow-filter" className="entity-filter" placeholder="Filter flows…" />
          <div id="flow-count" className="entity-count"></div>
          <div id="flow-list" className="entity-list">
            <div className="entity-loading">Select an environment to load flows.</div>
          </div>
        </div>
      </div>
      <div className="detail-area">
        <div className="panel">
          <div id="flow-detail-empty">
            <h2>Flow Detail</h2>
            <p className="desc">Select a flow from the list to inspect its properties and recent runs.</p>
            <div className="empty">No flow selected.</div>
          </div>
          <div id="flow-detail" className="hidden">
            <div className="flow-header">
              <div className="flow-header-info">
                <div className="flow-header-title" id="flow-title"></div>
                <div className="flow-header-sub" id="flow-subtitle"></div>
                <div id="flow-state-badge-container"></div>
              </div>
              <div className="flow-header-actions">
                <button className="btn btn-ghost" id="flow-open-console" type="button" style={{ fontSize: '0.75rem' }}>Open in Console</button>
              </div>
            </div>
            <div id="flow-metrics" className="metrics"></div>
          </div>
        </div>
        <div className="panel" id="flow-language-panel" style={{ display: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h2>Definition Lab</h2>
              <p className="desc" style={{ marginBottom: 0 }}>Inspect the selected flow definition with shared CLI/UI validation, graph diagnostics, and expression-aware completions.</p>
            </div>
            <div className="btn-group">
              <span id="flow-language-status" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}><span className="fetchxml-status-dot warn"></span>Definition not loaded</span>
              <button className="btn btn-secondary" id="flow-language-load" type="button">Load definition</button>
              <button className="btn btn-primary" id="flow-language-analyze" type="button">Analyze</button>
            </div>
          </div>
          <div className="fetchxml-editor-shell">
            <div className="fetchxml-editor-toolbar">
              <div className="fetchxml-editor-toolbar-left">
                <span>Workflow definition JSON</span>
              </div>
              <div className="fetchxml-editor-toolbar-right">
                <span id="flow-language-summary-text">No analysis yet</span>
              </div>
            </div>
            <div id="flow-language-editor" className="fetchxml-editor-mount"></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div id="flow-language-summary" className="flow-summary-grid" style={{ marginBottom: 12 }}></div>
            <div id="flow-language-diagnostics" className="fetchxml-diagnostics"></div>
          </div>
        </div>
        <div className="panel" id="flow-outline-panel" style={{ display: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2>Flow Outline</h2>
            <div className="btn-group">
              <button className="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-fit" type="button" style={{ fontSize: '0.6875rem', padding: '3px 8px' }}>Fit</button>
              <button className="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-in" type="button" style={{ fontSize: '0.6875rem', padding: '3px 8px' }}>+</button>
              <button className="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-out" type="button" style={{ fontSize: '0.6875rem', padding: '3px 8px' }}>−</button>
            </div>
          </div>
          <div className="flow-canvas-container" id="flow-canvas-container">
            <canvas id="flow-outline-canvas" className="flow-outline-canvas"></canvas>
            <div id="flow-language-outline" className="hidden"></div>
          </div>
        </div>
        <div className="panel" id="flow-runs-panel" style={{ display: 'none' }}>
          <h2 style={{ marginBottom: 12 }}>Runs</h2>
          <div className="run-toolbar">
            <input type="text" id="flow-run-filter" placeholder="Filter runs by status or trigger…" />
            <select id="flow-run-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div id="flow-runs" className="card-list">
            <div className="empty">Select a flow to see runs.</div>
          </div>
        </div>
        <div className="panel" id="flow-actions-panel" style={{ display: 'none' }}>
          <div id="flow-actions-breadcrumb" className="flow-breadcrumb"></div>
          <div id="flow-run-summary" style={{ marginBottom: 14 }}></div>
          <div className="action-toolbar">
            <input type="text" id="flow-action-filter" placeholder="Filter actions by name, type, or code…" />
            <select id="flow-action-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Skipped">Skipped</option>
            </select>
          </div>
          <div id="flow-actions" className="card-list"></div>
        </div>
        <div className="panel" id="flow-action-detail-panel" style={{ display: 'none' }}>
          <div id="flow-action-breadcrumb" className="flow-breadcrumb"></div>
          <h2 id="flow-action-title" style={{ marginBottom: 12 }}>Action Detail</h2>
          <div id="flow-action-metrics" className="metrics" style={{ marginBottom: 12 }}></div>
          <div id="flow-action-io"></div>
        </div>
      </div>
    </div>
  );
}
