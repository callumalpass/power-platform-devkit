import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  api,
  formatDate,
  getDefaultSelectedColumns,
  getSelectableAttributes,
  highlightJson,
  prop,
  renderResultTable,
} from './utils.js';

type ConditionRow = { id: number; attribute: string; operator: string; value: string };
type LinkRow = {
  id: number;
  name: string;
  from: string;
  to: string;
  linkType: 'inner' | 'outer';
  alias: string;
  attributes: string[];
  conditions: ConditionRow[];
};

type RelationshipsNode = {
  id: string;
  label: string;
  logicalName: string;
  isRoot: boolean;
  isCustom: boolean;
  attrCount: number;
  entitySetName?: string;
  x: number;
  y: number;
};

type RelationshipsEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

const OPERATORS = [
  'eq', 'ne', 'gt', 'ge', 'lt', 'le',
  'like', 'not-like', 'begins-with', 'not-begin-with', 'ends-with', 'not-end-with',
  'in', 'not-in', 'between', 'not-between',
  'null', 'not-null',
  'above', 'under', 'eq-or-above', 'eq-or-under',
  'contain-values', 'not-contain-values',
  'eq-userid', 'ne-userid', 'eq-businessid', 'ne-businessid',
  'yesterday', 'today', 'tomorrow',
  'last-x-hours', 'next-x-hours', 'last-x-days', 'next-x-days',
  'last-x-weeks', 'next-x-weeks', 'last-x-months', 'next-x-months',
  'last-x-years', 'next-x-years',
  'this-month', 'this-year', 'this-week', 'last-month', 'last-year', 'last-week',
  'next-month', 'next-year', 'next-week',
] as const;

const SYSTEM_ENTITIES = new Set([
  'systemuser', 'team', 'businessunit', 'organization', 'transactioncurrency',
  'calendar', 'activityparty', 'activitypointer', 'principalobjectaccess',
  'principalobjectattributeaccess', 'audit', 'asyncoperation', 'bulkdeletefailure',
  'importdata', 'importfile', 'importlog', 'duplicaterecord', 'duplicaterule',
  'plugintracelog', 'sdkmessageprocessingstep', 'workflow', 'sla', 'slaitem',
]);

function nextId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function addConditionRow(rows: ConditionRow[]) {
  return [...rows, { id: nextId(), attribute: '', operator: '', value: '' }];
}

function replaceConditionRow(rows: ConditionRow[], id: number, patch: Partial<ConditionRow>) {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

function removeConditionRow(rows: ConditionRow[], id: number) {
  return rows.filter((row) => row.id !== id);
}

function formatDiagnosticsCount(items: any[]) {
  const errors = items.filter((item) => item.level === 'error').length;
  const warnings = items.filter((item) => item.level === 'warning').length;
  if (errors) return `${errors} issue${errors === 1 ? '' : 's'}`;
  if (warnings) return `${warnings} advisory warning${warnings === 1 ? '' : 's'}`;
  return 'IntelliSense ready';
}

function orderByDefault(detail: any) {
  const cols = getDefaultSelectedColumns(detail, 0);
  const orderColumn = cols.find((name) => name !== detail?.primaryIdAttribute) || cols[0] || '';
  return orderColumn ? `${orderColumn} asc` : '';
}

export function FetchXmlTab(props: {
  dataverse: any;
  environment: string;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, environment, toast } = props;
  const [entityName, setEntityName] = useState('');
  const [entityDetail, setEntityDetail] = useState<any>(null);
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([]);
  const [conditions, setConditions] = useState<ConditionRow[]>([{ id: nextId(), attribute: '', operator: '', value: '' }]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [distinct, setDistinct] = useState(false);
  const [filterType, setFilterType] = useState<'and' | 'or'>('and');
  const [orderAttribute, setOrderAttribute] = useState('');
  const [orderDescending, setOrderDescending] = useState(false);
  const [rawXml, setRawXml] = useState('');
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [resultView, setResultView] = useState<'table' | 'json'>('table');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const selectableAttributes = useMemo(
    () => (entityDetail ? getSelectableAttributes(entityDetail) : []),
    [entityDetail],
  );

  useEffect(() => {
    if (!dataverse.currentEntityDetail) return;
    setEntityName(dataverse.currentEntityDetail.logicalName || '');
    setEntityDetail(dataverse.currentEntityDetail);
    const cols = dataverse.selectedColumns.length
      ? dataverse.selectedColumns
      : getDefaultSelectedColumns(dataverse.currentEntityDetail, 0);
    setSelectedAttrs(cols);
    setOrderAttribute(cols.find((name: string) => name !== dataverse.currentEntityDetail?.primaryIdAttribute) || '');
    setRawXml((current) => current || buildRawFetchXml(dataverse.currentEntityDetail.logicalName, cols));
  }, [dataverse.currentEntityDetail, dataverse.selectedColumns]);

  useEffect(() => {
    if (!environment || !entityName) return;
    if (entityDetail?.logicalName === entityName) return;
    let cancelled = false;
    void api<any>(`/api/dv/entities/${encodeURIComponent(entityName)}?environment=${encodeURIComponent(environment)}`)
      .then((payload) => {
        if (cancelled) return;
        setEntityDetail(payload.data);
        setSelectedAttrs((current) => current.length ? current : getDefaultSelectedColumns(payload.data, 0));
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
      });
    return () => {
      cancelled = true;
    };
  }, [entityDetail?.logicalName, entityName, environment, toast]);

  useEffect(() => {
    if (!rawXml.trim()) {
      setDiagnostics([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsAnalyzing(true);
      void api<any>('/api/dv/fetchxml/intellisense', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          source: rawXml,
          cursor: rawXml.length,
          rootEntityName: entityName || undefined,
        }),
      })
        .then((payload) => setDiagnostics(payload.data?.diagnostics || []))
        .catch(() => setDiagnostics([]))
        .finally(() => setIsAnalyzing(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [entityName, environment, rawXml]);

  function toggleAttribute(name: string) {
    setSelectedAttrs((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }

  function syncFromBuilder() {
    if (!entityDetail) return;
    setRawXml(buildRawFetchXml(entityDetail.logicalName, selectedAttrs));
  }

  function buildPreviewPayload() {
    return {
      environmentAlias: environment,
      entity: entityName,
      entitySetName: entityDetail?.entitySetName,
      attributes: selectedAttrs,
      distinct,
      top: 50,
      filterType,
      conditions: conditions
        .filter((row) => row.attribute && row.operator)
        .map((row) => ({ attribute: row.attribute, operator: row.operator, value: row.value || undefined })),
      orders: orderAttribute ? [{ attribute: orderAttribute, descending: orderDescending }] : [],
      linkEntities: links
        .filter((link) => link.name && link.from && link.to)
        .map((link) => ({
          name: link.name,
          from: link.from,
          to: link.to,
          alias: link.alias || undefined,
          linkType: link.linkType,
          attributes: link.attributes.length ? link.attributes : undefined,
          conditions: link.conditions
            .filter((row) => row.attribute && row.operator)
            .map((row) => ({ attribute: row.attribute, operator: row.operator, value: row.value || undefined })),
        })),
    };
  }

  async function preview() {
    try {
      const payload = await api<any>('/api/dv/fetchxml/preview', {
        method: 'POST',
        body: JSON.stringify(buildPreviewPayload()),
      });
      setRawXml(payload.data?.fetchXml || '');
      toast('XML generated');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function execute() {
    try {
      const payload = await api<any>('/api/dv/fetchxml/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entity: entityName || entityDetail?.logicalName || 'unknown',
          entitySetName: entityDetail?.entitySetName,
          rawXml: rawXml.trim() || undefined,
          ...(rawXml.trim() ? {} : buildPreviewPayload()),
        }),
      });
      setResult(payload.data);
      toast('FetchXML executed');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className="dv-subpanel active">
      <div className="panel">
        <h2>FetchXML</h2>
        <div className="entity-context">
          {entityDetail ? (
            <>
              <span className="entity-context-name">{entityDetail.displayName || entityDetail.logicalName}</span>
              <span className="entity-context-set">{entityDetail.entitySetName || entityDetail.logicalName}</span>
            </>
          ) : <span className="entity-context-empty">No entity selected. Pick one in Explorer or choose below.</span>}
        </div>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Entity</span>
            <select value={entityName} onChange={(event) => setEntityName(event.target.value)}>
              <option value="">select entity…</option>
              {dataverse.entities.map((item: any) => (
                <option key={item.logicalName} value={item.logicalName}>
                  {(item.displayName || item.logicalName)} ({item.logicalName})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Entity Set Name</span>
            <input value={entityDetail?.entitySetName || ''} readOnly tabIndex={-1} style={{ color: 'var(--muted)' }} />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Attributes</span>
          <div className="attr-picker">
            {selectableAttributes.length ? selectableAttributes.map((attribute: any) => (
              <span
                key={attribute.logicalName}
                className={`attr-chip ${selectedAttrs.includes(attribute.logicalName) ? 'selected' : ''}`}
                onClick={() => toggleAttribute(attribute.logicalName)}
                title={`${attribute.displayName || attribute.logicalName} (${attribute.attributeTypeName || attribute.attributeType || ''})`}
              >
                {attribute.logicalName}
              </span>
            )) : <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Select an entity to see attributes</span>}
          </div>
          <div className="btn-group" style={{ marginTop: 8 }}>
            <button className="btn btn-ghost" type="button" onClick={syncFromBuilder}>Seed XML from selection</button>
            <button className="btn btn-secondary" type="button" onClick={() => setSelectedAttrs(getDefaultSelectedColumns(entityDetail, 0))}>Default columns</button>
          </div>
        </div>
        <div className="form-row three">
          <div className="field">
            <span className="field-label">Top</span>
            <input value="50" readOnly tabIndex={-1} />
          </div>
          <div className="field">
            <span className="field-label">Distinct</span>
            <select value={String(distinct)} onChange={(event) => setDistinct(event.target.value === 'true')}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Filter Type</span>
            <select value={filterType} onChange={(event) => setFilterType(event.target.value as 'and' | 'or')}>
              <option value="and">and</option>
              <option value="or">or</option>
            </select>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Conditions</span>
          <div className="condition-list">
            {conditions.map((row) => (
              <div key={row.id} className="condition-row">
                <select value={row.attribute} onChange={(event) => setConditions((current) => replaceConditionRow(current, row.id, { attribute: event.target.value }))}>
                  <option value="">select…</option>
                  {selectableAttributes.map((attribute: any) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
                </select>
                <select value={row.operator} onChange={(event) => setConditions((current) => replaceConditionRow(current, row.id, { operator: event.target.value }))}>
                  <option value="">select…</option>
                  {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                </select>
                <input value={row.value} placeholder="value" onChange={(event) => setConditions((current) => replaceConditionRow(current, row.id, { value: event.target.value }))} />
                <button type="button" className="condition-remove" onClick={() => setConditions((current) => removeConditionRow(current, row.id))}>×</button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setConditions((current) => addConditionRow(current))}>+ Add condition</button>
        </div>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Order By</span>
            <select value={orderAttribute} onChange={(event) => setOrderAttribute(event.target.value)}>
              <option value="">none</option>
              {selectableAttributes.map((attribute: any) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Direction</span>
            <select value={String(orderDescending)} onChange={(event) => setOrderDescending(event.target.value === 'true')}>
              <option value="false">ascending</option>
              <option value="true">descending</option>
            </select>
          </div>
        </div>
        <FetchXmlLinksEditor
          dataverse={dataverse}
          environment={environment}
          links={links}
          setLinks={setLinks}
          toast={toast}
        />
        <div className="field">
          <span className="field-label">FetchXML</span>
          <div className="fetchxml-editor-shell">
            <div className="fetchxml-editor-toolbar">
              <div className="fetchxml-editor-toolbar-left">
                <span id="fetch-editor-status">
                  <span className={`fetchxml-status-dot ${diagnostics.some((item) => item.level === 'error') ? 'error' : diagnostics.some((item) => item.level === 'warning') ? 'warn' : ''}`}></span>
                  {isAnalyzing ? 'Analyzing…' : formatDiagnosticsCount(diagnostics)}
                </span>
              </div>
              <div className="fetchxml-editor-toolbar-right">
                <span>Native React port. IntelliSense diagnostics retained; editor shortcuts deferred.</span>
              </div>
            </div>
            <textarea
              className="xml-editor"
              style={{ display: 'block', minHeight: 320 }}
              value={rawXml}
              onChange={(event) => setRawXml(event.target.value)}
              placeholder={`<fetch top="50">\n  <entity name="account">\n    <attribute name="name" />\n  </entity>\n</fetch>`}
            />
          </div>
          <div className="fetchxml-diagnostics">
            {diagnostics.slice(0, 6).map((item, index) => (
              <div key={index} className={`fetchxml-diagnostic ${item.level || 'info'}`}>
                <div className="fetchxml-diagnostic-code">{item.code || 'INFO'} @ {item.from ?? 0}</div>
                <div className="fetchxml-diagnostic-message">{item.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="btn-group">
          <button className="btn btn-secondary" type="button" onClick={() => void preview()}>Build from fields</button>
          <button className="btn btn-primary" type="button" onClick={() => void execute()}>Run FetchXML</button>
        </div>
      </div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2>FetchXML Result</h2>
          <div className="result-toggle">
            <button className={`result-toggle-btn ${resultView === 'table' ? 'active' : ''}`} type="button" onClick={() => setResultView('table')}>Table</button>
            <button className={`result-toggle-btn ${resultView === 'json' ? 'active' : ''}`} type="button" onClick={() => setResultView('json')}>JSON</button>
          </div>
        </div>
        {result && resultView === 'table' && result.records?.length
          ? <div dangerouslySetInnerHTML={{ __html: renderResultTable(result.records, result.logicalName) }}></div>
          : <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(result || 'Run FetchXML to see the response.') }}></pre>}
      </div>
    </div>
  );
}

function FetchXmlLinksEditor(props: {
  dataverse: any;
  environment: string;
  links: LinkRow[];
  setLinks: Dispatch<SetStateAction<LinkRow[]>>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, environment, links, setLinks, toast } = props;
  const [details, setDetails] = useState<Record<number, any>>({});

  useEffect(() => {
    setDetails({});
  }, [environment]);

  async function loadLinkDetail(id: number, logicalName: string) {
    if (!logicalName) {
      setDetails((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const payload = await api<any>(`/api/dv/entities/${encodeURIComponent(logicalName)}?environment=${encodeURIComponent(environment)}`);
      setDetails((current) => ({ ...current, [id]: payload.data }));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function updateLink(id: number, patch: Partial<LinkRow>) {
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  }

  return (
    <div className="field">
      <span className="field-label">Link Entities (Joins)</span>
      <div className="link-list">
        {links.map((link) => {
          const detail = details[link.id];
          const linkAttributes = detail ? getSelectableAttributes(detail) : [];
          return (
            <div key={link.id} className="link-card">
              <div className="link-card-head">
                <span>Join #{link.id}</span>
                <button type="button" className="condition-remove" onClick={() => setLinks((current) => current.filter((item) => item.id !== link.id))}>×</button>
              </div>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <div className="field">
                  <span className="field-label">Linked Entity</span>
                  <select value={link.name} onChange={(event) => {
                    const value = event.target.value;
                    updateLink(link.id, { name: value, from: '', attributes: [], conditions: [{ id: nextId(), attribute: '', operator: '', value: '' }] });
                    void loadLinkDetail(link.id, value);
                  }}>
                    <option value="">select entity…</option>
                    {dataverse.entities.map((item: any) => <option key={item.logicalName} value={item.logicalName}>{(item.displayName || item.logicalName)} ({item.logicalName})</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Link Type</span>
                  <select value={link.linkType} onChange={(event) => updateLink(link.id, { linkType: event.target.value as 'inner' | 'outer' })}>
                    <option value="inner">inner</option>
                    <option value="outer">outer</option>
                  </select>
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <div className="field">
                  <span className="field-label">From (linked attr)</span>
                  <select value={link.from} onChange={(event) => updateLink(link.id, { from: event.target.value })}>
                    <option value="">select…</option>
                    {linkAttributes.map((attribute: any) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">To (parent attr)</span>
                  <select value={link.to} onChange={(event) => updateLink(link.id, { to: event.target.value })}>
                    <option value="">select…</option>
                    {dataverse.currentEntityDetail ? getSelectableAttributes(dataverse.currentEntityDetail).map((attribute: any) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>) : null}
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <span className="field-label">Alias</span>
                <input value={link.alias} placeholder="Optional, e.g. contact" onChange={(event) => updateLink(link.id, { alias: event.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <span className="field-label">Linked Attributes</span>
                <div className="attr-picker">
                  {linkAttributes.length ? linkAttributes.map((attribute: any) => (
                    <span
                      key={attribute.logicalName}
                      className={`attr-chip ${link.attributes.includes(attribute.logicalName) ? 'selected' : ''}`}
                      onClick={() => updateLink(link.id, {
                        attributes: link.attributes.includes(attribute.logicalName)
                          ? link.attributes.filter((item) => item !== attribute.logicalName)
                          : [...link.attributes, attribute.logicalName],
                      })}
                    >
                      {attribute.logicalName}
                    </span>
                  )) : <span style={{ color: 'var(--muted)', fontSize: '0.6875rem' }}>Select a linked entity first</span>}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Linked Conditions</span>
                <div className="condition-list">
                  {link.conditions.map((row) => (
                    <div key={row.id} className="condition-row">
                      <select value={row.attribute} onChange={(event) => updateLink(link.id, { conditions: replaceConditionRow(link.conditions, row.id, { attribute: event.target.value }) })}>
                        <option value="">select…</option>
                        {linkAttributes.map((attribute: any) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
                      </select>
                      <select value={row.operator} onChange={(event) => updateLink(link.id, { conditions: replaceConditionRow(link.conditions, row.id, { operator: event.target.value }) })}>
                        <option value="">select…</option>
                        {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                      </select>
                      <input value={row.value} placeholder="value" onChange={(event) => updateLink(link.id, { conditions: replaceConditionRow(link.conditions, row.id, { value: event.target.value }) })} />
                      <button type="button" className="condition-remove" onClick={() => updateLink(link.id, { conditions: removeConditionRow(link.conditions, row.id) })}>×</button>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost" type="button" style={{ marginTop: 4, padding: '3px 8px', fontSize: '0.6875rem' }} onClick={() => updateLink(link.id, { conditions: addConditionRow(link.conditions) })}>+ Condition</button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn btn-ghost" type="button" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setLinks((current) => [...current, {
        id: nextId(),
        name: '',
        from: '',
        to: '',
        linkType: 'inner',
        alias: '',
        attributes: [],
        conditions: [{ id: nextId(), attribute: '', operator: '', value: '' }],
      }])}>+ Add join</button>
    </div>
  );
}

function buildRawFetchXml(entityName: string, attributes: string[]) {
  const attrs = attributes.map((attribute) => `    <attribute name="${attribute}" />`).join('\n');
  return `<fetch top="50">\n  <entity name="${entityName}">\n${attrs || '    <all-attributes />'}\n  </entity>\n</fetch>`;
}

export function RelationshipsTab(props: {
  dataverse: any;
  environment: string;
  loadEntityDetail: (logicalName: string) => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, environment, loadEntityDetail, toast } = props;
  const [entityName, setEntityName] = useState('');
  const [depth, setDepth] = useState(2);
  const [hideSystem, setHideSystem] = useState(true);
  const [graph, setGraph] = useState<{ nodes: RelationshipsNode[]; edges: RelationshipsEdge[]; cache: Record<string, any> }>({ nodes: [], edges: [], cache: {} });
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dataverse.currentEntityDetail?.logicalName) setEntityName(dataverse.currentEntityDetail.logicalName);
  }, [dataverse.currentEntityDetail]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedDetail = selectedNode ? graph.cache[selectedNode.id] : null;

  async function loadGraph() {
    if (!entityName) {
      toast('Select an entity first', true);
      return;
    }
    if (!environment) {
      toast('Select an environment first', true);
      return;
    }
    setLoading(true);
    try {
      const cache: Record<string, any> = {};
      const nodes: RelationshipsNode[] = [];
      const edges: RelationshipsEdge[] = [];
      await loadRelationshipsRecursive(entityName, depth, environment, hideSystem, cache, nodes, edges);
      layoutNodes(nodes, edges);
      setGraph({ nodes: [...nodes], edges: [...edges], cache });
      setSelectedNodeId(nodes[0]?.id || '');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }

  const edgeGroups = useMemo(() => {
    const groups: Record<string, RelationshipsEdge[]> = {};
    for (const edge of graph.edges) {
      const key = [edge.source, edge.target].sort().join('|');
      groups[key] ||= [];
      groups[key].push(edge);
    }
    return groups;
  }, [graph.edges]);

  return (
    <div className="dv-subpanel active">
      <div className="panel" style={{ padding: 14 }}>
        <div className="rel-toolbar">
          <select value={entityName} onChange={(event) => setEntityName(event.target.value)} style={{ maxWidth: 240 }}>
            <option value="">select entity…</option>
            {dataverse.entities.map((item: any) => <option key={item.logicalName} value={item.logicalName}>{(item.displayName || item.logicalName)} ({item.logicalName})</option>)}
          </select>
          <div className="rel-toolbar-group">
            <label className="rel-toolbar-label">Depth</label>
            <select value={String(depth)} onChange={(event) => setDepth(Number(event.target.value))} style={{ width: 60 }}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
          <label className="rel-toolbar-check"><input type="checkbox" checked={hideSystem} onChange={(event) => setHideSystem(event.target.checked)} /> Hide system</label>
          <button className="btn btn-primary" type="button" style={{ padding: '5px 14px', fontSize: '0.75rem' }} onClick={() => void loadGraph()}>{loading ? 'Loading…' : 'Load Graph'}</button>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', marginLeft: 'auto' }}>{graph.nodes.length ? `${graph.nodes.length} entities, ${graph.edges.length} relationships` : ''}</span>
        </div>
        <div className="rel-canvas-container">
          <svg className="rel-svg" xmlns="http://www.w3.org/2000/svg" viewBox="-500 -380 1000 760">
            {graph.edges.map((edge) => {
              const source = graph.nodes.find((node) => node.id === edge.source);
              const target = graph.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              const key = [edge.source, edge.target].sort().join('|');
              const siblings = edgeGroups[key] || [];
              const index = siblings.findIndex((item) => item.id === edge.id);
              const offset = (index - (siblings.length - 1) / 2) * 14;
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const nx = -dy / dist;
              const ny = dx / dist;
              const sx = source.x + nx * offset;
              const sy = source.y + ny * offset;
              const tx = target.x + nx * offset;
              const ty = target.y + ny * offset;
              const mx = (sx + tx) / 2 + nx * 6;
              const my = (sy + ty) / 2 + ny * 6;
              return (
                <g key={edge.id} className="rel-edge">
                  <line x1={sx} y1={sy} x2={tx} y2={ty}></line>
                  <circle cx={tx} cy={ty} r={3} className="rel-arrowhead"></circle>
                  <text x={mx} y={my - 6} className="rel-edge-label">{edge.label}</text>
                </g>
              );
            })}
            {graph.nodes.map((node) => {
              const x = node.x - 80;
              const y = node.y - 22;
              return (
                <g
                  key={node.id}
                  className={`rel-node ${node.isRoot ? 'root' : ''} ${node.isCustom ? 'custom' : ''}`}
                  transform={`translate(${x},${y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <rect width="160" height="44" rx="10"></rect>
                  <text x="80" y="17" className="rel-node-label">{node.label}</text>
                  <text x="80" y="32" className="rel-node-sub">{node.logicalName}</text>
                </g>
              );
            })}
          </svg>
          <div className="rel-hint">Click a node to inspect it. Load again after changing depth or system filters.</div>
        </div>
      </div>
      <div className="panel">
        {!selectedNode ? (
          <>
            <h2>Relationship Detail</h2>
            <p className="desc">Load a graph and select a node to inspect its relationships.</p>
            <div className="empty">No node selected.</div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2>{selectedNode.label}</h2>
                <p className="desc" style={{ marginBottom: 0 }}>{selectedNode.logicalName}</p>
              </div>
              <div className="btn-group">
                <button className="btn btn-secondary" type="button" onClick={() => void loadEntityDetail(selectedNode.logicalName)}>Open in Explorer</button>
                <button className="btn btn-ghost" type="button" onClick={() => void expandRelationshipsNode(selectedNode.id, environment, hideSystem, graph, setGraph, toast)}>Expand 1 hop</button>
              </div>
            </div>
            <div className="metrics">
              <div className="metric"><div className="metric-label">Entity Set</div><div className="metric-value">{selectedNode.entitySetName || '-'}</div></div>
              <div className="metric"><div className="metric-label">Attributes</div><div className="metric-value">{String(selectedNode.attrCount)}</div></div>
              <div className="metric"><div className="metric-label">Custom</div><div className="metric-value">{selectedNode.isCustom ? 'Yes' : 'No'}</div></div>
              <div className="metric"><div className="metric-label">Outgoing</div><div className="metric-value">{String(graph.edges.filter((edge) => edge.source === selectedNode.id).length)}</div></div>
              <div className="metric"><div className="metric-label">Incoming</div><div className="metric-value">{String(graph.edges.filter((edge) => edge.target === selectedNode.id).length)}</div></div>
            </div>
            <div className="panel" style={{ padding: 0, marginTop: 12, border: 'none' }}>
              <h3 style={{ marginBottom: 8 }}>Lookups</h3>
              <div className="card-list">
                {graph.edges.filter((edge) => edge.source === selectedNode.id).map((edge) => (
                  <div key={edge.id} className="card-item" style={{ padding: '8px 10px' }}>
                    <div className="card-item-info">
                      <div className="card-item-title">{edge.target}</div>
                      <div className="card-item-sub">{edge.label}</div>
                    </div>
                  </div>
                ))}
                {!graph.edges.filter((edge) => edge.source === selectedNode.id).length ? <div className="empty">No lookup edges from this entity.</div> : null}
              </div>
            </div>
            {selectedDetail ? (
              <pre className="viewer" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: highlightJson({
                description: selectedDetail.description,
                primaryIdAttribute: selectedDetail.primaryIdAttribute,
                primaryNameAttribute: selectedDetail.primaryNameAttribute,
                ownershipType: selectedDetail.ownershipType,
              }) }}></pre>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

async function loadRelationshipsRecursive(
  entityName: string,
  remainingDepth: number,
  environment: string,
  hideSystem: boolean,
  cache: Record<string, any>,
  nodes: RelationshipsNode[],
  edges: RelationshipsEdge[],
) {
  if (cache[entityName]) return;
  let detail: any;
  try {
    const payload = await api<any>(`/api/dv/entities/${encodeURIComponent(entityName)}?environment=${encodeURIComponent(environment)}`);
    detail = payload.data;
    cache[entityName] = detail;
  } catch {
    cache[entityName] = { logicalName: entityName, attributes: [], error: true };
    return;
  }
  if (!nodes.find((node) => node.id === entityName)) {
    nodes.push({
      id: entityName,
      label: detail.displayName || entityName,
      logicalName: entityName,
      isRoot: nodes.length === 0,
      isCustom: Boolean(detail.isCustomEntity),
      attrCount: (detail.attributes || []).length,
      entitySetName: detail.entitySetName,
      x: 0,
      y: 0,
    });
  }
  if (remainingDepth <= 0) return;
  const lookups = (detail.attributes || []).filter((attribute: any) => {
    const typeName = String(attribute.attributeTypeName || attribute.attributeType || '').toLowerCase();
    return ['lookuptype', 'lookup', 'customer', 'owner'].includes(typeName) && attribute.targets?.length;
  });
  for (const attribute of lookups) {
    for (const target of attribute.targets || []) {
      if (hideSystem && SYSTEM_ENTITIES.has(target)) continue;
      if ((attribute.targets || []).length > 8) continue;
      const edgeId = `${entityName}.${attribute.logicalName}>${target}`;
      if (!edges.find((edge) => edge.id === edgeId)) {
        edges.push({ id: edgeId, source: entityName, target, label: attribute.logicalName });
      }
      await loadRelationshipsRecursive(target, remainingDepth - 1, environment, hideSystem, cache, nodes, edges);
    }
  }
}

function layoutNodes(nodes: RelationshipsNode[], edges: RelationshipsEdge[]) {
  if (!nodes.length) return;
  const root = nodes[0];
  root.x = 0;
  root.y = 0;
  const byDepth = new Map<number, string[]>();
  const visited = new Set<string>([root.id]);
  const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
  while (queue.length) {
    const item = queue.shift()!;
    byDepth.set(item.depth, [...(byDepth.get(item.depth) || []), item.id]);
    for (const edge of edges) {
      const neighbor = edge.source === item.id ? edge.target : edge.target === item.id ? edge.source : null;
      if (neighbor && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: item.depth + 1 });
      }
    }
  }
  for (const [level, ids] of byDepth.entries()) {
    if (level === 0) continue;
    const radius = level * 220;
    ids.forEach((id, index) => {
      const node = nodes.find((item) => item.id === id);
      if (!node) return;
      const angle = (2 * Math.PI * index) / ids.length - Math.PI / 2;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
    });
  }
}

async function expandRelationshipsNode(
  entityName: string,
  environment: string,
  hideSystem: boolean,
  graph: { nodes: RelationshipsNode[]; edges: RelationshipsEdge[]; cache: Record<string, any> },
  setGraph: Dispatch<SetStateAction<{ nodes: RelationshipsNode[]; edges: RelationshipsEdge[]; cache: Record<string, any> }>>,
  toast: (message: string, isError?: boolean) => void,
) {
  try {
    const cache = { ...graph.cache };
    const nodes = [...graph.nodes.map((node) => ({ ...node }))];
    const edges = [...graph.edges];
    await loadRelationshipsRecursive(entityName, 1, environment, hideSystem, cache, nodes, edges);
    layoutNodes(nodes, edges);
    setGraph({ nodes, edges, cache });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}
