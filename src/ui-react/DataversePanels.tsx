import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { xml } from '@codemirror/lang-xml';
import { bracketMatching } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { getCM, vim } from '@replit/codemirror-vim';
import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction, type WheelEvent as ReactWheelEvent } from 'react';
import {
  formatDate,
  getDefaultSelectedColumns,
  getSelectableAttributes,
  highlightJson,
  prop,
} from './utils.js';
import { ResultView } from './ResultView.js';
import { CopyButton } from './CopyButton.js';
import {
  analyzeFetchXml,
  executeFetchXml,
  getEntityDetail,
  previewFetchXml,
  type FetchXmlAnalysis,
  type FetchXmlCompletionItem,
  type FetchXmlPayload,
} from './dataverse-data.js';
import type {
  DataverseAttribute,
  DataverseEntityDetail,
  DataverseRecordPage,
  DataverseState,
  DiagnosticItem,
  ToastFn,
} from './ui-types.js';

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

type RelationshipsGraph = {
  nodes: RelationshipsNode[];
  edges: RelationshipsEdge[];
  cache: Record<string, DataverseEntityDetail>;
};

type RelationshipsViewBox = { x: number; y: number; width: number; height: number };
type RelationshipsTooltip = { x: number; y: number; title: string; detail: string; nodeId?: string };
type RelationshipsDrag =
  | { kind: 'node'; pointerId: number; nodeId: string; offsetX: number; offsetY: number }
  | { kind: 'pan'; pointerId: number; startClientX: number; startClientY: number; startViewBox: RelationshipsViewBox };

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

const codeMirrorTheme = EditorView.theme({
  '&': { fontSize: '13px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(37,99,235,0.18)' },
  '.cm-activeLine': { backgroundColor: 'rgba(37,99,235,0.06)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
});

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

function formatDiagnosticsCount(items: DiagnosticItem[]) {
  const errors = items.filter((item) => item.level === 'error').length;
  const warnings = items.filter((item) => item.level === 'warning').length;
  if (errors) return `${errors} issue${errors === 1 ? '' : 's'}`;
  if (warnings) return `${warnings} advisory warning${warnings === 1 ? '' : 's'}`;
  return 'IntelliSense ready';
}

function orderByDefault(detail: DataverseEntityDetail | null) {
  const cols = getDefaultSelectedColumns(detail, 0);
  const orderColumn = cols.find((name) => name !== detail?.primaryIdAttribute) || cols[0] || '';
  return orderColumn ? `${orderColumn} asc` : '';
}

export function FetchXmlTab(props: {
  dataverse: DataverseState;
  environment: string;
  toast: ToastFn;
}) {
  const { dataverse, environment, toast } = props;
  const entityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of dataverse.entities) {
      if (entity.logicalName && entity.entitySetName) map.set(entity.logicalName, entity.entitySetName);
    }
    return map;
  }, [dataverse.entities]);
  const [entityName, setEntityName] = useState('');
  const [entityDetail, setEntityDetail] = useState<DataverseEntityDetail | null>(null);
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([]);
  const [conditions, setConditions] = useState<ConditionRow[]>([{ id: nextId(), attribute: '', operator: '', value: '' }]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [distinct, setDistinct] = useState(false);
  const [filterType, setFilterType] = useState<'and' | 'or'>('and');
  const [orderAttribute, setOrderAttribute] = useState('');
  const [orderDescending, setOrderDescending] = useState(false);
  const [rawXml, setRawXml] = useState('');
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [result, setResult] = useState<DataverseRecordPage | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [vimMode, setVimMode] = useState('normal');

  const selectableAttributes = useMemo(
    (): DataverseAttribute[] => (entityDetail ? getSelectableAttributes(entityDetail) : []),
    [entityDetail],
  );

  useEffect(() => {
    const detail = dataverse.currentEntityDetail;
    if (!detail) return;
    setEntityName(detail.logicalName || '');
    setEntityDetail(detail);
    const cols = dataverse.selectedColumns.length
      ? dataverse.selectedColumns
      : getDefaultSelectedColumns(detail, 0);
    setSelectedAttrs(cols);
    setOrderAttribute(cols.find((name: string) => name !== detail.primaryIdAttribute) || '');
    setRawXml((current) => current || buildRawFetchXml(detail.logicalName, cols));
  }, [dataverse.currentEntityDetail, dataverse.selectedColumns]);

  useEffect(() => {
    if (!environment || !entityName) return;
    if (entityDetail?.logicalName === entityName) return;
    let cancelled = false;
    void getEntityDetail(environment, entityName)
      .then((detail) => {
        if (cancelled) return;
        setEntityDetail(detail);
        setSelectedAttrs((current) => current.length ? current : getDefaultSelectedColumns(detail, 0));
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
      void analyzeFetchXml({
        environmentAlias: environment,
        source: rawXml,
        rootEntityName: entityName || undefined,
      })
        .then((analysis) => setDiagnostics(analysis.diagnostics))
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

  function buildPreviewPayload(): FetchXmlPayload {
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
      setRawXml(await previewFetchXml(buildPreviewPayload()));
      toast('XML generated');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function execute() {
    try {
      const payload = await executeFetchXml({
          environmentAlias: environment,
          entity: entityName || entityDetail?.logicalName || 'unknown',
          entitySetName: entityDetail?.entitySetName,
          rawXml: rawXml.trim() || undefined,
          ...(rawXml.trim() ? {} : buildPreviewPayload()),
      });
      setResult(payload);
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
              {dataverse.entities.map((item) => (
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
            {selectableAttributes.length ? selectableAttributes.map((attribute) => (
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
                  {selectableAttributes.map((attribute) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
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
              {selectableAttributes.map((attribute) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
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
                <span className={`fetchxml-vim-mode ${vimMode}`}>{vimMode.toUpperCase()}</span>
                <span>Tab/Enter accept completions. Ctrl-Space opens suggestions.</span>
              </div>
            </div>
            <FetchXmlCodeEditor
              value={rawXml}
              environment={environment}
              rootEntityName={entityName || dataverse.currentEntityDetail?.logicalName}
              onChange={setRawXml}
              onAnalysis={(analysis) => {
                setDiagnostics(analysis.diagnostics);
                setIsAnalyzing(false);
              }}
              onAnalyzeStart={() => setIsAnalyzing(true)}
              onVimMode={setVimMode}
              toast={toast}
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
        <h2>FetchXML Result</h2>
        <ResultView result={result} entityLogicalName={result?.logicalName} entitySetName={result?.entitySetName} primaryIdAttribute={entityDetail?.primaryIdAttribute} environment={environment} entityMap={entityMap} placeholder="Run FetchXML to see the response." toast={toast} />
      </div>
    </div>
  );
}

function FetchXmlCodeEditor(props: {
  value: string;
  environment: string;
  rootEntityName?: string;
  onChange: (value: string) => void;
  onAnalysis: (analysis: FetchXmlAnalysis) => void;
  onAnalyzeStart: () => void;
  onVimMode: (mode: string) => void;
  toast: ToastFn;
}) {
  const { value, environment, rootEntityName, onChange, onAnalysis, onAnalyzeStart, onVimMode, toast } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const requestRef = useRef(new Map<string, Promise<FetchXmlAnalysis>>());
  const onChangeRef = useRef(onChange);
  const onAnalysisRef = useRef(onAnalysis);
  const onAnalyzeStartRef = useRef(onAnalyzeStart);
  const onVimModeRef = useRef(onVimMode);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onAnalysisRef.current = onAnalysis; }, [onAnalysis]);
  useEffect(() => { onAnalyzeStartRef.current = onAnalyzeStart; }, [onAnalyzeStart]);
  useEffect(() => { onVimModeRef.current = onVimMode; }, [onVimMode]);

  useEffect(() => {
    valueRef.current = value;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const analyze = (source: string, cursor: number) => {
      const key = JSON.stringify({ source, cursor, environment, rootEntityName });
      const cached = requestRef.current.get(key);
      if (cached) return cached;
      onAnalyzeStartRef.current();
      const request = analyzeFetchXml({
        environmentAlias: environment,
        source,
        cursor,
        rootEntityName,
      }).finally(() => requestRef.current.delete(key));
      requestRef.current.set(key, request);
      return request;
    };

    const acceptCompletionIfOpen = (view: EditorView) => completionStatus(view.state) === 'active' ? acceptCompletion(view) : false;
    const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const before = context.matchBefore(/[^\s<>"'=\/]*$/);
      const triggerChar = context.pos > 0 ? context.state.sliceDoc(context.pos - 1, context.pos) : '';
      if (!context.explicit && !before && !'<="/ '.includes(triggerChar)) return null;
      const analysis = await analyze(context.state.doc.toString(), context.pos);
      onAnalysisRef.current(analysis);
      if (!analysis.completions.length) return null;
      return {
        from: analysis.context?.from ?? context.pos,
        to: analysis.context?.to ?? context.pos,
        options: analysis.completions.map(toCodeMirrorCompletion),
      };
    };

    const diagnosticSource = async (view: EditorView) => {
      const analysis = await analyze(view.state.doc.toString(), view.state.selection.main.head);
      onAnalysisRef.current(analysis);
      return analysis.diagnostics.map((item) => ({
        from: item.from ?? 0,
        to: item.to ?? item.from ?? 0,
        severity: item.level === 'error' ? 'error' as const : item.level === 'warning' ? 'warning' as const : 'info' as const,
        message: item.message,
        source: item.code,
      }));
    };

    const diagnosticsCompartment = new Compartment();
    const view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: valueRef.current || '',
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          xml(),
          vim(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [completionSource], activateOnTyping: true, defaultKeymap: false, icons: true }),
          diagnosticsCompartment.of(linter(diagnosticSource, { delay: 250 })),
          Prec.highest(keymap.of([
            { key: 'Tab', run: acceptCompletionIfOpen },
            { key: 'Enter', run: acceptCompletionIfOpen },
          ])),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              valueRef.current = next;
              onChangeRef.current(next);
              startCompletion(update.view);
            }
          }),
          codeMirrorTheme,
        ],
      }),
    });

    viewRef.current = view;
    const cm = getCM(view);
    if (cm && typeof cm.on === 'function') {
      cm.on('vim-mode-change', (event: { mode?: string }) => onVimModeRef.current(event.mode || 'normal'));
    }
    onVimModeRef.current('normal');

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [environment, rootEntityName]);

  return <div ref={mountRef} className="fetchxml-editor-mount" />;
}

function toCodeMirrorCompletion(item: FetchXmlCompletionItem) {
  return {
    label: item.label,
    type: item.type,
    detail: item.detail,
    info: item.info,
    apply: item.apply,
  };
}

function FetchXmlLinksEditor(props: {
  dataverse: DataverseState;
  environment: string;
  links: LinkRow[];
  setLinks: Dispatch<SetStateAction<LinkRow[]>>;
  toast: ToastFn;
}) {
  const { dataverse, environment, links, setLinks, toast } = props;
  const [details, setDetails] = useState<Record<number, DataverseEntityDetail>>({});

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
      const detail = await getEntityDetail(environment, logicalName);
      setDetails((current) => ({ ...current, [id]: detail }));
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
          const linkAttributes: DataverseAttribute[] = detail ? getSelectableAttributes(detail) : [];
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
                    {dataverse.entities.map((item) => <option key={item.logicalName} value={item.logicalName}>{(item.displayName || item.logicalName)} ({item.logicalName})</option>)}
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
                    {linkAttributes.map((attribute) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">To (parent attr)</span>
                  <select value={link.to} onChange={(event) => updateLink(link.id, { to: event.target.value })}>
                    <option value="">select…</option>
                    {dataverse.currentEntityDetail ? (getSelectableAttributes(dataverse.currentEntityDetail) as DataverseAttribute[]).map((attribute) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>) : null}
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
                  {linkAttributes.length ? linkAttributes.map((attribute) => (
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
                        {linkAttributes.map((attribute) => <option key={attribute.logicalName} value={attribute.logicalName}>{attribute.logicalName}</option>)}
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
  dataverse: DataverseState;
  environment: string;
  loadEntityDetail: (logicalName: string) => Promise<void>;
  toast: ToastFn;
}) {
  const { dataverse, environment, loadEntityDetail, toast } = props;
  const [entityName, setEntityName] = useState('');
  const [depth, setDepth] = useState(2);
  const [hideSystem, setHideSystem] = useState(true);
  const [graph, setGraph] = useState<RelationshipsGraph>({ nodes: [], edges: [], cache: {} });
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewBox, setViewBox] = useState<RelationshipsViewBox>({ x: -500, y: -380, width: 1000, height: 760 });
  const [drag, setDrag] = useState<RelationshipsDrag | null>(null);
  const [tooltip, setTooltip] = useState<RelationshipsTooltip | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (dataverse.currentEntityDetail?.logicalName) setEntityName(dataverse.currentEntityDetail.logicalName);
  }, [dataverse.currentEntityDetail]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedDetail = selectedNode ? graph.cache[selectedNode.id] : null;

  function eventToSvgPoint(event: ReactPointerEvent<SVGElement>) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function tooltipPosition(event: ReactPointerEvent<SVGElement>) {
    const bounds = svgRef.current?.parentElement?.getBoundingClientRect();
    return {
      x: event.clientX - (bounds?.left || 0) + 12,
      y: event.clientY - (bounds?.top || 0) + 12,
    };
  }

  function showNodeTooltip(node: RelationshipsNode, event: ReactPointerEvent<SVGElement>) {
    const position = tooltipPosition(event);
    const detail = graph.cache[node.id];
    const metadataLookupCount = detail?.attributes?.filter((attribute) => attribute.targets?.length).length || 0;
    const outEdges = graph.edges.filter((edge) => edge.source === node.id);
    const inEdges = graph.edges.filter((edge) => edge.target === node.id);
    setTooltip({
      ...position,
      title: node.label,
      detail: [
        node.logicalName,
        `${node.attrCount} attrs · ${metadataLookupCount} metadata lookups · ${outEdges.length} shown`,
        node.entitySetName,
        outEdges.length ? `References: ${outEdges.map((edge) => edge.label).join(', ')}` : '',
        inEdges.length ? `Referenced by: ${inEdges.map((edge) => `${edge.source}.${edge.label}`).join(', ')}` : '',
      ].filter(Boolean).join('\n'),
      nodeId: node.id,
    });
  }

  function showEdgeTooltip(edge: RelationshipsEdge, event: ReactPointerEvent<SVGElement>) {
    const position = tooltipPosition(event);
    setTooltip({
      ...position,
      title: edge.label,
      detail: `${edge.source} → ${edge.target}`,
    });
  }

  function startNodeDrag(node: RelationshipsNode, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const point = eventToSvgPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNodeId(node.id);
    setTooltip(null);
    setDrag({ kind: 'node', pointerId: event.pointerId, nodeId: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y });
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setTooltip(null);
    setDrag({ kind: 'pan', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startViewBox: viewBox });
  }

  function moveGraphPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'node') {
      const point = eventToSvgPoint(event);
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (
          node.id === drag.nodeId ? { ...node, x: point.x - drag.offsetX, y: point.y - drag.offsetY } : node
        )),
      }));
      return;
    }
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = drag.startViewBox.width / rect.width;
    const scaleY = drag.startViewBox.height / rect.height;
    setViewBox({
      ...drag.startViewBox,
      x: drag.startViewBox.x - (event.clientX - drag.startClientX) * scaleX,
      y: drag.startViewBox.y - (event.clientY - drag.startClientY) * scaleY,
    });
  }

  function endGraphPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag?.pointerId === event.pointerId) setDrag(null);
  }

  function zoomGraph(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    const nextWidth = Math.max(320, Math.min(2400, viewBox.width * factor));
    const nextHeight = Math.max(240, Math.min(1800, viewBox.height * factor));
    const relX = (event.clientX - rect.left) / rect.width;
    const relY = (event.clientY - rect.top) / rect.height;
    const anchorX = viewBox.x + viewBox.width * relX;
    const anchorY = viewBox.y + viewBox.height * relY;
    setViewBox({
      x: anchorX - nextWidth * relX,
      y: anchorY - nextHeight * relY,
      width: nextWidth,
      height: nextHeight,
    });
  }

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
      const cache: Record<string, DataverseEntityDetail> = {};
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
            {dataverse.entities.map((item) => <option key={item.logicalName} value={item.logicalName}>{(item.displayName || item.logicalName)} ({item.logicalName})</option>)}
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
        <div className="rel-canvas-container" onPointerLeave={() => { if (!drag) setTooltip(null); }}>
          <svg
            ref={svgRef}
            className="rel-svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onPointerDown={startPan}
            onPointerMove={moveGraphPointer}
            onPointerUp={endGraphPointer}
            onPointerCancel={endGraphPointer}
            onWheel={zoomGraph}
          >
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
                <g
                  key={edge.id}
                  className="rel-edge"
                  onPointerEnter={(event) => showEdgeTooltip(edge, event)}
                  onPointerMove={(event) => showEdgeTooltip(edge, event)}
                  onPointerLeave={() => setTooltip(null)}
                >
                  <line className="rel-edge-hit" x1={sx} y1={sy} x2={tx} y2={ty}></line>
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
                  className={`rel-node ${node.isRoot ? 'root' : ''} ${node.isCustom ? 'custom' : ''} ${selectedNodeId === node.id ? 'selected' : ''}`}
                  transform={`translate(${x},${y})`}
                  onPointerDown={(event) => startNodeDrag(node, event)}
                  onPointerEnter={(event) => showNodeTooltip(node, event)}
                  onClick={(event) => showNodeTooltip(node, event as unknown as ReactPointerEvent<SVGElement>)}
                >
                  <rect width="160" height="44" rx="10"></rect>
                  <text x="80" y="17" className="rel-node-label">{node.label}</text>
                  <text x="80" y="32" className="rel-node-sub">{node.logicalName}</text>
                </g>
              );
            })}
          </svg>
          {tooltip ? (
            <div className="rel-tooltip" style={{ left: tooltip.x, top: tooltip.y, whiteSpace: 'pre-line', pointerEvents: tooltip.nodeId ? 'auto' : undefined }}>
              <strong>{tooltip.title}</strong>
              <br />
              <span>{tooltip.detail}</span>
              {tooltip.nodeId ? (
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary" type="button" style={{ fontSize: '0.6875rem', padding: '3px 10px' }} onClick={() => {
                    const nodeId = tooltip.nodeId;
                    if (!nodeId) return;
                    setTooltip(null);
                    void expandRelationshipsNode(nodeId, environment, hideSystem, graph, setGraph, toast);
                  }}>Expand</button>
                  <button className="btn btn-ghost" type="button" style={{ fontSize: '0.6875rem', padding: '3px 10px' }} onClick={() => {
                    const node = graph.nodes.find((item) => item.id === tooltip.nodeId);
                    setTooltip(null);
                    if (node) void loadEntityDetail(node.logicalName);
                  }}>Open in Explorer</button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="rel-hint">Drag nodes to rearrange. Drag the canvas to pan. Scroll to zoom.</div>
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
              {[
                ['Entity Set', selectedNode.entitySetName || '-'],
                ['Attributes', String(selectedNode.attrCount)],
                ['Custom', selectedNode.isCustom ? 'Yes' : 'No'],
                ['Outgoing', String(graph.edges.filter((edge) => edge.source === selectedNode.id).length)],
                ['Incoming', String(graph.edges.filter((edge) => edge.target === selectedNode.id).length)],
              ].map(([label, value]) => (
                <div className="metric" key={label}>
                  <div className="metric-label">{label}</div>
                  <div className="metric-value copy-inline">
                    <span className="copy-inline-value">{value}</span>
                    <CopyButton value={value} label="copy" title={`Copy ${label}`} toast={toast} />
                  </div>
                </div>
              ))}
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
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <CopyButton value={{
                    description: selectedDetail.description,
                    primaryIdAttribute: selectedDetail.primaryIdAttribute,
                    primaryNameAttribute: selectedDetail.primaryNameAttribute,
                    ownershipType: selectedDetail.ownershipType,
                  }} label="Copy JSON" title="Copy relationship detail JSON" toast={toast} />
                </div>
                <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson({
                  description: selectedDetail.description,
                  primaryIdAttribute: selectedDetail.primaryIdAttribute,
                  primaryNameAttribute: selectedDetail.primaryNameAttribute,
                  ownershipType: selectedDetail.ownershipType,
                }) }}></pre>
              </div>
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
  cache: Record<string, DataverseEntityDetail>,
  nodes: RelationshipsNode[],
  edges: RelationshipsEdge[],
) {
  let detail = cache[entityName];
  if (!detail) {
    try {
      detail = await getEntityDetail(environment, entityName);
      cache[entityName] = detail;
    } catch {
      return;
    }
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
  const lookups = (detail.attributes || []).filter((attribute: DataverseAttribute) => {
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
  graph: RelationshipsGraph,
  setGraph: Dispatch<SetStateAction<RelationshipsGraph>>,
  toast: ToastFn,
) {
  try {
    const cache = { ...graph.cache };
    const nodes = [...graph.nodes.map((node) => ({ ...node }))];
    const edges = [...graph.edges];
    const initialNodeCount = nodes.length;
    const initialEdgeCount = edges.length;
    await loadRelationshipsRecursive(entityName, 1, environment, hideSystem, cache, nodes, edges);
    if (nodes.length === initialNodeCount && edges.length === initialEdgeCount) {
      toast('No additional relationships found for this node.');
    }
    layoutNodes(nodes, edges);
    setGraph({ nodes, edges, cache });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}
