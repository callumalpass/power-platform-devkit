import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadFlowApiOperationSchema,
  loadFlowApiOperations,
  loadFlowDynamicEnum,
  loadFlowDynamicProperties,
} from '../automate-data.js';
import { Icon } from '../Icon.js';
import {
  applyMonacoAppTheme,
  attachMonacoVim,
  MonacoVimToggle,
  type MonacoVimAttachment,
  useMonacoVimPreference,
} from '../monaco-support.js';
import { prop } from '../utils.js';
import type {
  FlowAnalysis,
  FlowAnalysisOutlineItem,
  FlowApiOperation,
  FlowApiOperationSchema,
  FlowApiOperationSchemaField,
  FlowDynamicValueOption,
  ToastFn,
} from '../ui-types.js';
import type { FlowActionEditTarget } from './types.js';
import { isActionLikeOutlineItem, outlineTitle } from './outline-utils.js';

const BUILT_IN_ACTION_TEMPLATES = [
  { key: 'compose', label: 'Compose', desc: 'Transform or pass through a value', name: 'Compose', action: () => ({ type: 'Compose', inputs: '' }) },
  { key: 'http', label: 'HTTP', desc: 'Call any REST endpoint', name: 'HTTP', action: () => ({ type: 'Http', inputs: { method: 'GET', uri: '' } }) },
  { key: 'scope', label: 'Scope', desc: 'Group related actions', name: 'Scope', action: () => ({ type: 'Scope', actions: {} }) },
  { key: 'condition', label: 'Condition', desc: 'Branch with if / else', name: 'Condition', action: () => ({ type: 'If', expression: { equals: ['', ''] }, actions: {}, else: { actions: {} } }) },
] as const;

type BuiltInActionTemplate = typeof BUILT_IN_ACTION_TEMPLATES[number];

export function AddFlowActionModal(props: {
  environment: string;
  source: string;
  analysis: FlowAnalysis | null;
  initialRunAfter?: string;
  onClose: () => void;
  onAdd: (actionName: string, action: Record<string, unknown>) => void;
  toast: ToastFn;
}) {
  const [search, setSearch] = useState('');
  const [operations, setOperations] = useState<FlowApiOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<FlowApiOperation | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltInActionTemplate | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<FlowApiOperationSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [operationDraft, setOperationDraft] = useState<Record<string, unknown> | null>(null);
  const [actionName, setActionName] = useState('');
  const [runAfter, setRunAfter] = useState(props.initialRunAfter || '');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topLevelActions = useMemo(() => topLevelActionNames(props.analysis), [props.analysis]);
  const propsRef = useRef(props);
  propsRef.current = props;

  const doSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const result = await loadFlowApiOperations(propsRef.current.environment, query);
      setOperations(result);
    } catch (error) {
      propsRef.current.toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (props.initialRunAfter !== undefined) return;
    if (!runAfter && topLevelActions.length) setRunAfter(topLevelActions[topLevelActions.length - 1] || '');
  }, [runAfter, topLevelActions, props.initialRunAfter]);

  useEffect(() => {
    searchRef.current?.focus();
    void doSearch('');
  }, [doSearch]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(value), 350);
  }

  function selectOperation(operation: FlowApiOperation) {
    setSelectedOperation(operation);
    setSelectedTemplate(null);
    setSelectedSchema(null);
    setOperationDraft(buildApiOperationAction(props.source, operation, buildRunAfter(runAfter)));
    setActionName(uniqueActionName(props.source, sanitizeActionName(operation.summary || operation.name || 'Action')));
  }

  function selectTemplate(template: BuiltInActionTemplate) {
    setSelectedTemplate(template);
    setSelectedOperation(null);
    setSelectedSchema(null);
    setOperationDraft(null);
    setActionName(uniqueActionName(props.source, template.name));
  }

  useEffect(() => {
    let cancelled = false;
    if (!selectedOperation) return;
    const apiRef = selectedOperation.apiId || selectedOperation.apiName;
    if (!apiRef || !selectedOperation.name) {
      setSelectedSchema(null);
      setOperationDraft(buildApiOperationAction(props.source, selectedOperation, buildRunAfter(runAfter)));
      return;
    }
    setSchemaLoading(true);
    void loadFlowApiOperationSchema(props.environment, apiRef, selectedOperation.name)
      .then((schema) => {
        if (cancelled) return;
        setSelectedSchema(schema);
        setOperationDraft(buildApiOperationAction(props.source, selectedOperation, buildRunAfter(runAfter), schema || undefined));
      })
      .catch((error) => props.toast(error instanceof Error ? error.message : String(error), true))
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [props.environment, props.source, props.toast, selectedOperation]);

  const operationDraftRef = useMemo(() => operationDraft ? resolveActionOperation(props.source, operationDraft) : {}, [props.source, operationDraft]);
  const operationDynamicOptions = useFlowDynamicOptions(props.environment, operationDraft, selectedSchema, operationDraftRef, props.toast);
  const operationDynamicSchemaFields = useFlowDynamicSchemaFields(props.environment, operationDraft, selectedSchema, operationDraftRef, props.toast);

  function updateOperationDraft(path: string[], value: unknown) {
    setOperationDraft((current) => current ? setPathValue(current, path, value) : current);
  }

  function addAction() {
    const runAfterValue = buildRunAfter(runAfter);
    if (selectedOperation) {
      const action = operationDraft || buildApiOperationAction(props.source, selectedOperation, runAfterValue, selectedSchema || undefined);
      props.onAdd(actionName, { ...action, runAfter: runAfterValue });
      return;
    }
    if (selectedTemplate) {
      props.onAdd(actionName, { ...selectedTemplate.action(), runAfter: runAfterValue });
    }
  }

  const selectedSchemaFields = expandDynamicSchemaFields(selectedSchema?.fields || [], operationDynamicSchemaFields);
  const visibleSelectedSchemaFields = visibleConnectorSchemaFields(selectedSchemaFields);
  const hasSelection = Boolean(selectedOperation || selectedTemplate);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal add-action-modal">
        <div className="rt-modal-header add-action-header">
          <div className="add-action-title">
            <h2>Add Action</h2>
            <span className="add-action-subtitle">Pick a built-in template or a connector operation, then configure it.</span>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div className="rt-modal-body add-action-body">
          <div className="add-action-pane add-action-picker">
            <div className="add-action-picker-section">
              <div className="add-action-section-label">Built-in</div>
              <div className="add-action-template-row">
                {BUILT_IN_ACTION_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className={`add-action-template ${selectedTemplate?.key === template.key ? 'active' : ''}`}
                    onClick={() => selectTemplate(template)}
                  >
                    <span className="add-action-template-label">{template.label}</span>
                    <span className="add-action-template-desc">{template.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="add-action-picker-section add-action-picker-search-section">
              <div className="add-action-section-label add-action-section-label-row">
                <span>Connector operations</span>
                {loading ? <span className="add-action-searching">Searching…</span> : null}
              </div>
              <div className="add-action-search">
                <span className="add-action-search-icon" aria-hidden="true"><Icon name="search" size={14} /></span>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  placeholder="Search connectors and actions…"
                  onChange={(event) => onSearchChange(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void doSearch(search); }}
                />
              </div>
            </div>
            <div className="add-action-results">
              {operations.length ? operations.map((operation) => (
                <button
                  key={`${operation.apiId || operation.apiName}:${operation.name}`}
                  type="button"
                  className={`add-action-operation ${selectedOperation?.name === operation.name && selectedOperation?.apiId === operation.apiId ? 'active' : ''}`}
                  onClick={() => selectOperation(operation)}
                >
                  {operation.iconUri ? <img className="add-action-operation-icon" src={operation.iconUri} alt="" /> : <span className="add-action-operation-icon add-action-operation-icon-placeholder" />}
                  <span className="add-action-operation-text">
                    <span className="add-action-operation-title">{operation.summary || operation.name}</span>
                    <span className="add-action-operation-meta">{operation.apiDisplayName || operation.apiName || 'Connector'} &middot; {operation.name}</span>
                    {operation.description ? <span className="add-action-operation-desc">{operation.description}</span> : null}
                  </span>
                </button>
              )) : <div className="add-action-results-empty">{loading ? 'Loading operations…' : 'No operations found.'}</div>}
            </div>
          </div>

          <div className="add-action-pane add-action-config">
            {!hasSelection ? (
              <div className="add-action-config-empty">
                <div className="add-action-config-empty-icon" aria-hidden="true"><Icon name="plus" size={22} /></div>
                <div className="add-action-config-empty-title">Select an action to configure</div>
                <div className="add-action-config-empty-desc">Pick a built-in template or search for a connector operation on the left. Its parameters will appear here.</div>
              </div>
            ) : (
              <>
                <div className="add-action-config-header">
                  {selectedOperation?.iconUri ? (
                    <img className="add-action-config-icon" src={selectedOperation.iconUri} alt="" />
                  ) : (
                    <span className="add-action-config-icon add-action-config-icon-placeholder" aria-hidden="true">{selectedTemplate?.label?.charAt(0) || '·'}</span>
                  )}
                  <div className="add-action-config-header-text">
                    <div className="add-action-config-title">
                      {selectedOperation
                        ? selectedOperation.summary || selectedOperation.name
                        : selectedTemplate?.label || 'Action'}
                    </div>
                    <div className="add-action-config-meta">
                      {selectedOperation
                        ? `${selectedOperation.apiDisplayName || selectedOperation.apiName || 'Connector'} · ${selectedOperation.name}`
                        : selectedTemplate?.desc || ''}
                    </div>
                  </div>
                </div>

                <div className="add-action-config-form">
                  <label>
                    <span>Action name</span>
                    <input type="text" value={actionName} onChange={(event) => setActionName(sanitizeActionName(event.target.value))} />
                  </label>
                  <label>
                    <span>Run after</span>
                    <select value={runAfter} onChange={(event) => setRunAfter(event.target.value)}>
                      <option value="">none</option>
                      {topLevelActions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                </div>

                {selectedOperation ? (
                  <div className="add-action-note">
                    Will use the matching connection reference when one exists, otherwise inserts a placeholder for {selectedOperation.apiDisplayName || selectedOperation.apiName || 'the connector'}.
                    {' '}
                    {schemaLoading
                      ? 'Loading operation metadata…'
                      : selectedSchema
                        ? `${visibleSelectedSchemaFields.length} parameter${visibleSelectedSchemaFields.length === 1 ? '' : 's'} found${visibleSelectedSchemaFields.some((field) => field.required) ? `, ${visibleSelectedSchemaFields.filter((field) => field.required).length} required` : ''}.`
                        : 'No detailed operation metadata found.'}
                  </div>
                ) : null}

                {selectedOperation && visibleSelectedSchemaFields.length && operationDraft ? (
                  <div className="add-action-config-params">
                    <div className="add-action-section-label">Parameters</div>
                    <div className="flow-action-field-list">
                      {visibleSelectedSchemaFields.slice(0, 16).map((field) => (
                        <SchemaFieldEditor
                          key={`${field.location || 'parameter'}:${(field.path || []).join('.')}:${field.name}`}
                          field={field}
                          options={operationDynamicOptions[fieldSchemaKey(field)]}
                          value={readPathValue(operationDraft, connectorFieldPath(field))}
                          onChange={(value) => updateOperationDraft(connectorFieldPath(field), value)}
                        />
                      ))}
                      {visibleSelectedSchemaFields.length > 16 ? <div className="flow-action-edit-note">Showing the first 16 parameters. More fields are available after insertion via Edit Action.</div> : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="add-action-footer">
          <span className="add-action-footer-hint">{hasSelection ? 'Inserts the action into the editor only — Check & Save when ready.' : 'Select an action to enable Insert.'}</span>
          <button className="btn btn-primary" type="button" disabled={!actionName.trim() || !hasSelection} onClick={addAction}>Insert Action</button>
        </div>
      </div>
    </div>
  );
}

type EditActionTab = 'fields' | 'json';

const WDL_ACTION_TYPES = [
  'ApiConnection',
  'Compose',
  'Foreach',
  'Http',
  'If',
  'InitializeVariable',
  'OpenApiConnection',
  'Response',
  'Scope',
  'ServiceProvider',
  'Switch',
  'Until',
] as const;

export function EditFlowActionModal(props: {
  environment: string;
  source: string;
  target: FlowActionEditTarget;
  onApply: (target: FlowActionEditTarget, actionName: string, action: Record<string, unknown>) => void;
  onClose: () => void;
  toast: ToastFn;
}) {
  const [actionName, setActionName] = useState(props.target.name);
  const [draft, setDraft] = useState<Record<string, unknown>>(props.target.value);
  const [rawText, setRawText] = useState(() => JSON.stringify(props.target.value, null, 2));
  const [tab, setTab] = useState<EditActionTab>(() => isActionLikeOutlineItem(props.target.item) ? 'fields' : 'json');
  const [schema, setSchema] = useState<FlowApiOperationSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const operationRef = useMemo(() => resolveActionOperation(props.source, props.target.value), [props.source, props.target.value]);
  const rawError = useMemo(() => {
    try {
      JSON.parse(rawText);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [rawText]);

  useEffect(() => {
    setActionName(props.target.name);
    setDraft(props.target.value);
    setRawText(JSON.stringify(props.target.value, null, 2));
    setTab(isActionLikeOutlineItem(props.target.item) ? 'fields' : 'json');
  }, [props.target]);

  useEffect(() => {
    let cancelled = false;
    if (!operationRef.apiRef || !operationRef.operationId) {
      setSchema(null);
      return;
    }
    setSchemaLoading(true);
    void loadFlowApiOperationSchema(props.environment, operationRef.apiRef, operationRef.operationId)
      .then((result) => { if (!cancelled) setSchema(result); })
      .catch((error) => props.toast(error instanceof Error ? error.message : String(error), true))
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [operationRef.apiRef, operationRef.operationId, props.environment, props.toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        tryApply();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function updateDraft(path: string[], value: unknown) {
    const next = setPathValue(draft, path, value);
    setDraft(next);
    setRawText(JSON.stringify(next, null, 2));
  }

  function switchTab(next: EditActionTab) {
    if (next === 'fields' && tab === 'json' && !rawError) {
      try {
        const parsed = JSON.parse(rawText) as unknown;
        if (isObject(parsed)) setDraft(parsed);
      } catch { /* keep current draft */ }
    }
    if (next === 'json' && tab === 'fields') {
      setRawText(JSON.stringify(draft, null, 2));
    }
    setTab(next);
  }

  function tryApply() {
    try {
      const source = tab === 'json' ? rawText : JSON.stringify(draft, null, 2);
      const parsed = JSON.parse(source) as unknown;
      if (!isObject(parsed)) throw new Error('Edited JSON must be an object.');
      const nextName = props.target.canRename ? formatOutlineEditName(props.target.item, actionName) : actionName.trim();
      if (!nextName) throw new Error('Name is required.');
      props.onApply(props.target, nextName, parsed);
    } catch (error) {
      props.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function formatRawJson() {
    try {
      setRawText(JSON.stringify(JSON.parse(rawText), null, 2));
    } catch (error) {
      props.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function syncJsonFromFields() {
    setRawText(JSON.stringify(draft, null, 2));
    setTab('json');
  }

  const type = String(draft.type || props.target.item.type || '');
  const actionLike = isActionLikeOutlineItem(props.target.item);
  const dynamicSchemaFields = useFlowDynamicSchemaFields(props.environment, draft, schema, operationRef, props.toast);
  const connectorFields = visibleConnectorSchemaFields(expandDynamicSchemaFields(schema?.fields || [], dynamicSchemaFields));
  const existingParameterFields = existingConnectorParameterFields(draft, connectorFields);
  const connectorFieldGroups = groupConnectorFields([...connectorFields, ...existingParameterFields]);
  const dynamicOptions = useFlowDynamicOptions(props.environment, draft, schema, operationRef, props.toast);
  const hasConnectorSchema = actionLike && Boolean(operationRef.operationId);
  const schemaLabel = schemaLoading
    ? 'Loading schema…'
    : schema
      ? `${schema.apiDisplayName || schema.apiName || 'Connector'} · ${schema.summary || schema.operationId}`
      : hasConnectorSchema
        ? 'No schema found'
        : null;

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal flow-action-edit-modal">
        <div className="rt-modal-header flow-action-edit-header">
          <div className="flow-action-edit-header-info">
            <div className="flow-action-edit-title-row">
              <h2>Edit {outlineTitle(props.target.item)}</h2>
              {type ? <span className="flow-action-edit-badge">{type}</span> : null}
              {operationRef.operationId ? <span className="flow-action-edit-badge mono">{operationRef.operationId}</span> : null}
            </div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div className="rt-modal-body flow-action-edit-body">
          <div className="flow-action-edit-section flow-action-edit-grid">
            <label>
              <span>Name</span>
              <input type="text" value={actionName} disabled={!props.target.canRename} onChange={(event) => setActionName(formatOutlineEditName(props.target.item, event.target.value))} />
            </label>
            {actionLike || type ? (
              <label>
                <span>Type</span>
                <input type="text" list="flow-action-type-options" value={type} onChange={(event) => updateDraft(['type'], event.target.value)} />
                <datalist id="flow-action-type-options">
                  {WDL_ACTION_TYPES.map((item) => <option key={item} value={item} />)}
                </datalist>
              </label>
            ) : null}
          </div>

          <div className="flow-action-edit-tabs">
            <button type="button" className={`flow-action-edit-tab ${tab === 'fields' ? 'active' : ''}`} onClick={() => switchTab('fields')}>Fields</button>
            <button type="button" className={`flow-action-edit-tab ${tab === 'json' ? 'active' : ''}`} onClick={() => switchTab('json')}>JSON</button>
            {schemaLabel ? <span className="flow-action-edit-schema-label">{schemaLabel}</span> : null}
          </div>

          {tab === 'fields' ? (
            <>
              {hasConnectorSchema && (connectorFields.length || existingParameterFields.length) ? (
                <div className="flow-action-edit-section">
                  <h3>Connector parameters</h3>
                  {schema?.description ? <p className="desc" style={{ marginBottom: 0 }}>{schema.description}</p> : null}
                  {connectorFieldGroups.map((group) => (
                    <div key={group.location} className="flow-action-field-group">
                      <div className="flow-action-field-group-title">{connectorLocationLabel(group.location)}</div>
                      <div className="flow-action-field-list">
                        {group.fields.map((field) => (
                          <SchemaFieldEditor
                            key={`${field.location || 'parameter'}:${field.name}`}
                            field={field}
                            options={dynamicOptions[fieldSchemaKey(field)]}
                            value={readPathValue(draft, connectorFieldPath(field))}
                            onChange={(value) => updateDraft(connectorFieldPath(field), value)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {actionLike ? (
                <div className="flow-action-edit-section">
                  <h3>Common fields</h3>
                  <CommonActionFields action={draft} onChange={updateDraft} />
                </div>
              ) : null}
              {!actionLike && !hasConnectorSchema ? (
                <div className="empty">Use the JSON tab to edit this workflow section.</div>
              ) : null}
            </>
          ) : (
            <div className="flow-action-edit-section">
              <div className="flow-action-json-toolbar">
                <span className="flow-action-edit-note">Edit the exact JSON object that will replace this outline item.</span>
                <div className="flow-action-json-toolbar-actions">
                  <button className="btn btn-ghost" type="button" onClick={formatRawJson}>Format</button>
                  <button className="btn btn-ghost" type="button" onClick={syncJsonFromFields}>Reset from fields</button>
                </div>
              </div>
              <textarea className="flow-action-json-editor" value={rawText} onChange={(event) => setRawText(event.target.value)} spellCheck={false} />
              {rawError ? <div className="flow-action-edit-error">{rawError}</div> : null}
            </div>
          )}
        </div>
        <div className="flow-action-edit-footer">
          <span className="flow-action-edit-footer-text">Updates the editor only — use Check & Save when ready. <span className="flow-action-edit-footer-hint">Ctrl+Enter</span></span>
          <button className="btn btn-primary" type="button" disabled={!actionName.trim() || (tab === 'json' && Boolean(rawError))} onClick={tryApply}>Apply Changes</button>
        </div>
      </div>
    </div>
  );
}

function CommonActionFields(props: { action: Record<string, unknown>; onChange: (path: string[], value: unknown) => void }) {
  const type = String(props.action.type || '').toLowerCase();
  const fields: Array<{ label: string; path: string[]; kind?: 'text' | 'json' | 'select'; options?: string[] }> = [];
  if (type === 'http') {
    fields.push(
      { label: 'Method', path: ['inputs', 'method'], kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { label: 'URI', path: ['inputs', 'uri'] },
      { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
      { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    );
  } else if (type === 'openapiconnection' || type === 'apiconnection') {
    fields.push(
      { label: 'Host', path: ['inputs', 'host'], kind: 'json' },
      { label: 'Parameters', path: ['inputs', 'parameters'], kind: 'json' },
      { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
      { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    );
  } else if (type === 'serviceprovider') {
    fields.push(
      { label: 'Service provider config', path: ['inputs', 'serviceProviderConfiguration'], kind: 'json' },
      { label: 'Parameters', path: ['inputs', 'parameters'], kind: 'json' },
    );
  } else if (type === 'compose') {
    fields.push({ label: 'Inputs', path: ['inputs'], kind: 'json' });
  } else if (type === 'scope') {
    fields.push({ label: 'Actions', path: ['actions'], kind: 'json' });
  } else if (type === 'if' || type === 'condition') {
    fields.push(
      { label: 'Expression', path: ['expression'], kind: 'json' },
      { label: 'True actions', path: ['actions'], kind: 'json' },
      { label: 'False branch', path: ['else'], kind: 'json' },
    );
  } else if (type === 'foreach') {
    fields.push(
      { label: 'Collection', path: ['foreach'] },
      { label: 'Actions', path: ['actions'], kind: 'json' },
      { label: 'Runtime configuration', path: ['runtimeConfiguration'], kind: 'json' },
    );
  } else if (type === 'until') {
    fields.push(
      { label: 'Expression', path: ['expression'], kind: 'json' },
      { label: 'Actions', path: ['actions'], kind: 'json' },
      { label: 'Limit', path: ['limit'], kind: 'json' },
    );
  } else if (type === 'switch') {
    fields.push(
      { label: 'Expression', path: ['expression'], kind: 'json' },
      { label: 'Cases', path: ['cases'], kind: 'json' },
      { label: 'Default', path: ['default'], kind: 'json' },
    );
  } else if (type === 'response') {
    fields.push(
      { label: 'Status code', path: ['inputs', 'statusCode'] },
      { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
      { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    );
  } else if (type === 'request') {
    fields.push({ label: 'Inputs', path: ['inputs'], kind: 'json' });
  } else if (type.includes('variable')) {
    fields.push({ label: 'Inputs', path: ['inputs'], kind: 'json' });
  }
  const trailing = [
    { label: 'Run after', path: ['runAfter'], kind: 'json' as const },
    { label: 'Operation options', path: ['operationOptions'] },
    { label: 'Description', path: ['description'] },
    { label: 'Metadata', path: ['metadata'], kind: 'json' as const },
  ];
  return (
    <div className="flow-action-field-list">
      {fields.map((field) => (
        <ActionValueEditor
          key={field.path.join('.')}
          label={field.label}
          value={readPathValue(props.action, field.path)}
          kind={field.kind}
          options={field.options}
          onChange={(value) => props.onChange(field.path, value)}
        />
      ))}
      {fields.length > 0 ? <div className="flow-action-field-divider" /> : null}
      {trailing.map((field) => (
        <ActionValueEditor
          key={field.path.join('.')}
          label={field.label}
          value={readPathValue(props.action, field.path)}
          kind={field.kind}
          onChange={(value) => props.onChange(field.path, value)}
        />
      ))}
    </div>
  );
}

type ActionValueOption = string | FlowDynamicValueOption;

function useFlowDynamicOptions(
  environment: string,
  action: Record<string, unknown> | null,
  schema: FlowApiOperationSchema | null,
  operationRef: FlowActionOperationRef,
  toast: ToastFn,
): Record<string, FlowDynamicValueOption[]> {
  const [options, setOptions] = useState<Record<string, FlowDynamicValueOption[]>>({});
  const fields = useMemo(() => visibleConnectorSchemaFields(schema?.fields || []).filter((field) => field.dynamicValues), [schema]);
  const parameters = useMemo(() => readConnectorParameters(action), [action]);
  const dynamicParameters = useMemo(() => pickDynamicParameters(fields.map((field) => field.dynamicValues), parameters), [fields, parameters]);
  const signature = useMemo(() => JSON.stringify({
    environment,
    apiName: operationRef.apiName || schema?.apiName,
    connectionName: operationRef.connectionName,
    fields: fields.map((field) => [fieldSchemaKey(field), field.dynamicValues]),
    parameters: dynamicParameters,
  }), [dynamicParameters, environment, fields, operationRef.apiName, operationRef.connectionName, schema?.apiName]);

  useEffect(() => {
    let cancelled = false;
    const apiName = operationRef.apiName || schema?.apiName;
    if (!environment || !apiName || !fields.length) {
      setOptions({});
      return;
    }
    void Promise.all(fields.map(async (field) => {
      const values = await loadFlowDynamicEnum(environment, apiName, operationRef.connectionName, field.dynamicValues, dynamicParameters);
      return [fieldSchemaKey(field), values] as const;
    }))
      .then((entries) => {
        if (cancelled) return;
        setOptions(Object.fromEntries(entries.filter(([, values]) => values.length)));
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
      });
    return () => { cancelled = true; };
  }, [environment, fields, operationRef.apiName, operationRef.connectionName, schema?.apiName, signature, toast]);

  return options;
}

function useFlowDynamicSchemaFields(
  environment: string,
  action: Record<string, unknown> | null,
  schema: FlowApiOperationSchema | null,
  operationRef: FlowActionOperationRef,
  toast: ToastFn,
): Record<string, FlowApiOperationSchemaField[]> {
  const [fieldsByParent, setFieldsByParent] = useState<Record<string, FlowApiOperationSchemaField[]>>({});
  const fields = useMemo(() => visibleConnectorSchemaFields(schema?.fields || []).filter((field) => field.dynamicSchema), [schema]);
  const parameters = useMemo(() => readConnectorParameters(action), [action]);
  const dynamicParameters = useMemo(() => pickDynamicParameters(fields.map((field) => field.dynamicSchema), parameters), [fields, parameters]);
  const signature = useMemo(() => JSON.stringify({
    environment,
    apiName: operationRef.apiName || schema?.apiName,
    connectionName: operationRef.connectionName,
    fields: fields.map((field) => [fieldSchemaKey(field), field.dynamicSchema]),
    parameters: dynamicParameters,
  }), [dynamicParameters, environment, fields, operationRef.apiName, operationRef.connectionName, schema?.apiName]);

  useEffect(() => {
    let cancelled = false;
    const apiName = operationRef.apiName || schema?.apiName;
    if (!environment || !apiName || !fields.length) {
      setFieldsByParent({});
      return;
    }
    void Promise.all(fields.map(async (field) => {
      const values = await loadFlowDynamicProperties(environment, apiName, operationRef.connectionName, field, dynamicParameters);
      return [fieldSchemaKey(field), values] as const;
    }))
      .then((entries) => {
        if (cancelled) return;
        setFieldsByParent(Object.fromEntries(entries.filter(([, values]) => values.length)));
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
      });
    return () => { cancelled = true; };
  }, [environment, fields, operationRef.apiName, operationRef.connectionName, schema?.apiName, signature, toast]);

  return fieldsByParent;
}

function expandDynamicSchemaFields(fields: FlowApiOperationSchemaField[], dynamicFields: Record<string, FlowApiOperationSchemaField[]>): FlowApiOperationSchemaField[] {
  return fields.flatMap((field) => {
    const expanded = dynamicFields[fieldSchemaKey(field)] || [];
    return expanded.length ? expanded : [field];
  });
}

function readConnectorParameters(action: Record<string, unknown> | null): Record<string, unknown> {
  const parameters = prop(action || {}, 'inputs.parameters');
  return isObject(parameters) ? parameters : {};
}

function pickDynamicParameters(metadatas: unknown[], parameters: Record<string, unknown>): Record<string, unknown> {
  const refs = new Set<string>();
  for (const metadata of metadatas) {
    for (const ref of dynamicParameterReferences(metadata)) refs.add(ref);
  }
  const result: Record<string, unknown> = {};
  for (const ref of refs) {
    if (Object.prototype.hasOwnProperty.call(parameters, ref)) result[ref] = parameters[ref];
  }
  return result;
}

function dynamicParameterReferences(metadata: unknown): string[] {
  const rawParameters = prop(metadata, 'parameters');
  if (!isObject(rawParameters)) return [];
  return Object.entries(rawParameters).flatMap(([name, raw]) => {
    if (typeof raw === 'string') return raw ? [raw] : [];
    if (!isObject(raw)) return [];
    const ref = firstNonEmptyString(raw.parameterReference, raw.parameter, raw.name, raw.value, name);
    return ref ? [ref] : [];
  });
}

function fieldSchemaKey(field: FlowApiOperationSchemaField) {
  return `${field.location || 'parameter'}:${(field.path || []).join('.')}:${field.name}`;
}

function SchemaFieldEditor(props: { field: FlowApiOperationSchemaField; value: unknown; options?: FlowDynamicValueOption[]; onChange: (value: unknown) => void }) {
  const { field } = props;
  const type = field.type || schemaTypeLabel(field.schema) || 'value';
  const dynamicHint = summarizeDynamicMetadata(field);
  const options = props.options?.length ? props.options : field.enum;
  return (
    <div className="flow-action-schema-field">
      <div>
        <div className="flow-action-field-label">{field.title || field.name}{field.required ? ' *' : ''}</div>
        <div className="flow-action-field-meta">
          {field.location || 'parameter'} · {type}
          {field.visibility ? ` · ${field.visibility}` : ''}
        </div>
        {field.description ? <div className="flow-action-field-desc">{field.description}</div> : null}
        {dynamicHint ? <div className="flow-action-field-desc">{dynamicHint}</div> : null}
      </div>
      <ActionValueEditor value={props.value} kind={options?.length ? 'select' : shouldEditAsJson(field) ? 'json' : 'text'} options={options} onChange={props.onChange} />
    </div>
  );
}

function groupConnectorFields(fields: FlowApiOperationSchemaField[]): Array<{ location: string; fields: FlowApiOperationSchemaField[] }> {
  const order = ['path', 'query', 'body', 'header', 'parameter', 'internal'];
  const groups = new Map<string, FlowApiOperationSchemaField[]>();
  for (const field of fields) {
    const location = field.visibility === 'internal' ? 'internal' : field.location || 'parameter';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location)!.push(field);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (order.indexOf(left) < 0 ? 99 : order.indexOf(left)) - (order.indexOf(right) < 0 ? 99 : order.indexOf(right)))
    .map(([location, groupFields]) => ({ location, fields: groupFields }));
}

function visibleConnectorSchemaFields(fields: FlowApiOperationSchemaField[]) {
  return fields.filter((field) => field.visibility !== 'internal' && field.name !== 'connectionId');
}

function connectorLocationLabel(location: string) {
  const labels: Record<string, string> = {
    path: 'Path',
    query: 'Query',
    body: 'Body',
    header: 'Headers',
    parameter: 'Parameters',
    internal: 'Internal',
  };
  return labels[location] || location;
}

function summarizeDynamicMetadata(field: FlowApiOperationSchemaField) {
  if (isObject(field.dynamicValues)) {
    const operationId = prop(field.dynamicValues, 'operationId');
    return operationId ? `Dynamic values from ${operationId}.` : 'Dynamic values are available.';
  }
  if (field.dynamicSchema) return 'Dynamic schema is available.';
  return '';
}

function ActionValueEditor(props: { label?: string; value: unknown; kind?: 'text' | 'json' | 'select'; options?: ActionValueOption[]; onChange: (value: unknown) => void }) {
  const kind = props.kind || (isObject(props.value) || Array.isArray(props.value) ? 'json' : 'text');
  const valueText = valueToEditText(props.value, kind);
  const content = kind === 'select' ? (
    <select value={String(props.value ?? '')} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">not set</option>
      {(props.options || []).map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
    </select>
  ) : kind === 'json' ? (
    <textarea
      value={valueText}
      onChange={(event) => props.onChange(parseEditableJson(event.target.value))}
      spellCheck={false}
    />
  ) : (
    <input type="text" value={valueText} onChange={(event) => props.onChange(event.target.value)} />
  );
  return props.label ? (
    <label className="flow-action-value-editor">
      <span>{props.label}</span>
      {content}
    </label>
  ) : content;
}

export function addActionToFlowDocument(source: string, actionName: string, action: Record<string, unknown>, insertAfter?: string): string {
  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Flow definition JSON must be an object.');
  const definition = findMutableWorkflowDefinition(root);
  if (!definition) throw new Error('Could not find workflow definition actions.');
  const actions = isObject(definition.actions) ? definition.actions : {};
  definition.actions = actions;
  if (Object.prototype.hasOwnProperty.call(actions, actionName)) {
    throw new Error(`${actionName} already exists.`);
  }
  if (insertAfter && Object.prototype.hasOwnProperty.call(actions, insertAfter)) {
    const reordered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(actions)) {
      reordered[key] = val;
      if (key === insertAfter) reordered[actionName] = action;
    }
    definition.actions = reordered;
  } else {
    actions[actionName] = action;
  }
  return JSON.stringify(root, null, 2);
}

export function readOutlineEditTarget(source: string, item: FlowAnalysisOutlineItem): FlowActionEditTarget {
  if (item.from === undefined || item.to === undefined || !item.name) throw new Error('Outline item does not have a source range.');
  const direct = tryParseObjectSlice(source, item.from, item.to);
  if (direct) {
    return { item, name: item.name, value: direct, from: item.from, to: item.to, replaceMode: 'value', canRename: false };
  }
  const colon = source.indexOf(':', item.from);
  if (colon < 0 || colon > item.to) throw new Error(`Could not locate ${item.name} in the editor.`);
  const valueStart = firstNonWhitespaceOffset(source, colon + 1);
  if (valueStart < 0 || valueStart > item.to) throw new Error(`${item.name} does not have an editable JSON value.`);
  const parsed = tryParseObjectSlice(source, valueStart, item.to);
  if (!parsed) throw new Error(`${item.name} is not an editable JSON object.`);
  return { item, name: item.name, value: parsed, from: item.from, to: item.to, replaceMode: 'property', canRename: canRenameOutlineItem(item) };
}

export function replaceOutlineItemInFlowDocument(source: string, target: FlowActionEditTarget, itemName: string, value: Record<string, unknown>): string {
  const lineStart = source.lastIndexOf('\n', target.from - 1) + 1;
  const indent = source.slice(lineStart, target.from).match(/^\s*/)?.[0] || '';
  const body = JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
  if (target.replaceMode === 'value') {
    return `${source.slice(0, target.from)}${body}${source.slice(target.to)}`;
  }
  return `${source.slice(0, target.from)}"${escapeJsonString(itemName)}": ${body}${source.slice(target.to)}`;
}

function tryParseObjectSlice(source: string, from: number, to: number): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(source.slice(from, to)) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstNonWhitespaceOffset(source: string, from: number) {
  for (let index = from; index < source.length; index += 1) {
    if (!/\s/.test(source[index] || '')) return index;
  }
  return -1;
}

function canRenameOutlineItem(item: FlowAnalysisOutlineItem) {
  return !['workflow', 'actions', 'parameters', 'triggers', 'variables'].includes(String(item.name || item.kind || ''));
}

function escapeJsonString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type FlowActionOperationRef = {
  apiId?: string;
  apiName?: string;
  apiRef?: string;
  connectionName?: string;
  connectionReferenceName?: string;
  operationId?: string;
};

function resolveActionOperation(source: string, action: Record<string, unknown>): FlowActionOperationRef {
  const operation = readActionOperation(action);
  const reference = operation.connectionReferenceName ? readConnectionReference(source, operation.connectionReferenceName) : {};
  const apiRef = operation.apiId || reference.apiId || operation.apiName || reference.apiName;
  return {
    ...operation,
    apiId: operation.apiId || reference.apiId,
    apiName: operation.apiName || reference.apiName,
    apiRef,
    connectionName: operation.connectionName || reference.connectionName,
  };
}

function readActionOperation(action: Record<string, unknown>): FlowActionOperationRef {
  const host = prop(action, 'inputs.host');
  const connectionReferenceName = firstNonEmptyString(
    prop(host, 'connectionReferenceName'),
    prop(host, 'connection.referenceName'),
    prop(host, 'connection.name'),
    prop(host, 'connectionName'),
  );
  return {
    connectionReferenceName,
    connectionName: firstNonEmptyString(
      prop(host, 'connectionName'),
      prop(host, 'connection.name'),
      connectionNameFromId(prop(host, 'connection.id')),
    ),
    apiId: firstNonEmptyString(prop(host, 'apiId'), prop(action, 'inputs.apiId')),
    apiName: firstNonEmptyString(prop(host, 'apiName'), prop(action, 'inputs.apiName')),
    operationId: firstNonEmptyString(prop(host, 'operationId'), prop(action, 'inputs.operationId'), prop(action, 'operationId')),
  };
}

function readConnectionReference(source: string, name: string): { apiId?: string; apiName?: string; connectionName?: string } {
  try {
    const root = JSON.parse(source) as unknown;
    if (!isObject(root)) return {};
    const properties = isObject(root.properties) ? root.properties : root;
    const refs = isObject(properties.connectionReferences) ? properties.connectionReferences : isObject(root.connectionReferences) ? root.connectionReferences : {};
    const ref = isObject(refs[name]) ? refs[name] : undefined;
    if (!ref) return {};
    return {
      apiId: firstNonEmptyString(prop(ref, 'api.id'), prop(ref, 'apiId')),
      apiName: firstNonEmptyString(prop(ref, 'api.name'), prop(ref, 'apiName'), prop(ref, 'api.displayName')),
      connectionName: firstNonEmptyString(
        prop(ref, 'connectionName'),
        prop(ref, 'connection.name'),
        connectionNameFromId(prop(ref, 'connection.id')),
        connectionNameFromId(prop(ref, 'id')),
      ),
    };
  } catch {
    return {};
  }
}

function connectionNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'connections');
  const candidate = index >= 0 ? parts[index + 1] : undefined;
  return candidate || undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function connectorFieldPath(field: FlowApiOperationSchemaField): string[] {
  if (field.path?.length) return field.path;
  if (field.location === 'header') return ['inputs', 'headers', field.name];
  if (field.location === 'query') return ['inputs', 'queries', field.name];
  if (field.location === 'body') return ['inputs', 'parameters', field.name || 'body'];
  if (field.location === 'path') return ['inputs', 'parameters', field.name];
  return ['inputs', 'parameters', field.name];
}

function existingConnectorParameterFields(action: Record<string, unknown>, fields: FlowApiOperationSchemaField[]): FlowApiOperationSchemaField[] {
  const known = new Set(fields.map((field) => `${field.location || 'parameter'}:${field.name}`));
  const parameters = prop(action, 'inputs.parameters');
  if (!isObject(parameters)) return [];
  return Object.keys(parameters)
    .filter((name) => !known.has(`parameter:${name}`) && !known.has(`path:${name}`) && !known.has(`body:${name}`))
    .map((name) => ({ name, location: 'parameter', type: typeof parameters[name] }));
}

function readPathValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPathValue(source: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(source) as Record<string, unknown>;
  let current: Record<string, unknown> = clone;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
  return clone;
}

function parseEditableJson(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function valueToEditText(value: unknown, kind: 'text' | 'json' | 'select') {
  if (value === undefined || value === null) return '';
  if (kind === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function shouldEditAsJson(field: FlowApiOperationSchemaField) {
  const type = field.type || schemaTypeLabel(field.schema);
  return type === 'object' || type === 'array';
}

function schemaTypeLabel(schema: unknown) {
  return isObject(schema) && typeof schema.type === 'string' ? schema.type : undefined;
}

function findMutableWorkflowDefinition(root: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(root.actions) || isObject(root.triggers)) return root;
  if (isObject(root.definition) && (isObject(root.definition.actions) || isObject(root.definition.triggers))) return root.definition;
  if (isObject(root.properties) && isObject(root.properties.definition)) return root.properties.definition;
  return null;
}

function findActionsContainer(root: unknown, actionName: string): Record<string, unknown> | null {
  if (!isObject(root)) return null;
  if (isObject(root.actions)) {
    const actions = root.actions as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(actions, actionName)) return actions;
    for (const val of Object.values(actions)) {
      const found = findActionsContainer(val, actionName);
      if (found) return found;
    }
  }
  for (const key of ['else', 'definition', 'properties'] as const) {
    if (isObject(root[key])) {
      const found = findActionsContainer(root[key], actionName);
      if (found) return found;
    }
  }
  if (isObject(root.cases)) {
    for (const val of Object.values(root.cases as Record<string, unknown>)) {
      const found = findActionsContainer(val, actionName);
      if (found) return found;
    }
  }
  return null;
}

export function findSiblingActionNames(outline: FlowAnalysisOutlineItem[], actionName: string): string[] | null {
  for (const item of outline) {
    if (item.children) {
      const actionChildren = item.children.filter((c) => isActionLikeOutlineItem(c) && c.name);
      if (actionChildren.some((c) => c.name === actionName)) {
        return actionChildren.map((c) => c.name!);
      }
      const result = findSiblingActionNames(item.children, actionName);
      if (result) return result;
    }
  }
  return null;
}

export function reorderActionInFlowDocument(source: string, actionName: string, targetName: string, position: 'before' | 'after', siblingNames: string[]): string {
  const fromIdx = siblingNames.indexOf(actionName);
  const targetIdx = siblingNames.indexOf(targetName);
  if (fromIdx < 0 || targetIdx < 0) throw new Error('Action not found among siblings.');
  if (fromIdx === targetIdx) return source;

  // Build new order
  const newOrder = [...siblingNames];
  newOrder.splice(fromIdx, 1);
  const insertAt = position === 'before'
    ? newOrder.indexOf(targetName)
    : newOrder.indexOf(targetName) + 1;
  newOrder.splice(insertAt, 0, actionName);
  if (newOrder.every((name, i) => name === siblingNames[i])) return source;

  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Invalid flow definition.');
  const container = findActionsContainer(root, actionName);
  if (!container) throw new Error('Could not find actions container.');

  // Rebuild runAfter chain based on new order
  for (let i = 0; i < newOrder.length; i++) {
    const name = newOrder[i]!;
    const action = container[name];
    if (!isObject(action)) continue;
    action.runAfter = i === 0 ? {} : { [newOrder[i - 1]!]: ['Succeeded'] };
  }

  // Reorder JSON keys to match
  const reordered: Record<string, unknown> = {};
  for (const name of newOrder) reordered[name] = container[name];
  for (const key of Object.keys(container)) {
    if (!newOrder.includes(key)) reordered[key] = container[key];
  }
  for (const key of Object.keys(container)) delete container[key];
  for (const [key, val] of Object.entries(reordered)) container[key] = val;

  return JSON.stringify(root, null, 2);
}

function buildApiOperationAction(source: string, operation: FlowApiOperation, runAfter: Record<string, string[]>, schema?: FlowApiOperationSchema): Record<string, unknown> {
  const connectionReferenceName = findConnectionReferenceName(source, operation) || (operation.apiName ? `shared_${operation.apiName}` : 'shared_connector');
  const host: Record<string, unknown> = {
    connectionReferenceName,
    operationId: operation.name,
  };
  if (operation.apiId) host.apiId = operation.apiId;
  const action = {
    type: operation.operationType || 'OpenApiConnection',
    inputs: {
      host,
      parameters: {},
    },
    runAfter,
  };
  if (schema?.fields.length) {
    for (const field of schema.fields) {
      if (!field.required) continue;
      if (field.visibility === 'internal' || field.name === 'connectionId') continue;
      const value = defaultValueForSchemaField(field);
      if (value === undefined) continue;
      setPathValueInPlace(action, connectorFieldPath(field), value);
    }
  }
  return action;
}

function defaultValueForSchemaField(field: FlowApiOperationSchemaField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.enum?.length) return field.enum[0];
  const type = field.type || schemaTypeLabel(field.schema);
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return '';
}

function setPathValueInPlace(source: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> = source;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function findConnectionReferenceName(source: string, operation: FlowApiOperation): string | undefined {
  try {
    const root = JSON.parse(source) as unknown;
    if (!isObject(root)) return undefined;
    const properties = isObject(root.properties) ? root.properties : root;
    const refs = isObject(properties.connectionReferences) ? properties.connectionReferences : isObject(root.connectionReferences) ? root.connectionReferences : undefined;
    if (!refs) return undefined;
    for (const [key, value] of Object.entries(refs)) {
      if (!isObject(value)) continue;
      const apiId = String(prop(value, 'api.id') || prop(value, 'apiId') || '');
      const apiName = String(prop(value, 'api.name') || prop(value, 'apiName') || '');
      if (operation.apiId && apiId && apiId.toLowerCase() === operation.apiId.toLowerCase()) return key;
      if (operation.apiName && apiName && apiName.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
      if (operation.apiName && key.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
    }
  } catch {}
  return undefined;
}

function buildRunAfter(actionName: string): Record<string, string[]> {
  return actionName ? { [actionName]: ['Succeeded'] } : {};
}

function topLevelActionNames(analysis: FlowAnalysis | null): string[] {
  const workflow = analysis?.outline?.find((item) => item.kind === 'workflow') || analysis?.outline?.[0];
  const actions = workflow?.children?.find((item) => item.name === 'actions' || item.kind === 'action');
  return (actions?.children || []).map((item) => item.name).filter((name): name is string => Boolean(name));
}

function uniqueActionName(source: string, preferred: string): string {
  const base = sanitizeActionName(preferred || 'Action') || 'Action';
  const existing = new Set<string>();
  try {
    const root = JSON.parse(source) as unknown;
    if (isObject(root)) {
      const definition = findMutableWorkflowDefinition(root);
      const actions = definition && isObject(definition.actions) ? definition.actions : {};
      for (const key of Object.keys(actions)) existing.add(key);
    }
  } catch {}
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const next = `${base}_${index}`;
    if (!existing.has(next)) return next;
  }
  return `${base}_${Date.now()}`;
}

function sanitizeActionName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Action';
}

function formatOutlineEditName(item: FlowAnalysisOutlineItem, value: string): string {
  if (shouldSanitizeOutlineName(item)) return sanitizeActionName(value);
  return value;
}

function shouldSanitizeOutlineName(item: FlowAnalysisOutlineItem) {
  return ['action', 'scope', 'condition', 'foreach', 'switch', 'trigger'].includes(String(item.kind || ''));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function FlowDiffModal(props: { original: string; modified: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const originalVimStatusRef = useRef<HTMLSpanElement | null>(null);
  const modifiedVimStatusRef = useRef<HTMLSpanElement | null>(null);
  const vimAttachmentsRef = useRef<MonacoVimAttachment[]>([]);
  const [vimEnabled, setVimEnabled] = useMonacoVimPreference();
  const [vimMode, setVimMode] = useState('off');
  const vimEnabledRef = useRef(vimEnabled);

  useEffect(() => {
    vimEnabledRef.current = vimEnabled;
    for (const attachment of vimAttachmentsRef.current) attachment.setEnabled(vimEnabled);
  }, [vimEnabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    applyMonacoAppTheme();
    const originalModel = monaco.editor.createModel(props.original || '', 'json');
    const modifiedModel = monaco.editor.createModel(props.modified || '', 'json');
    const editor = monaco.editor.createDiffEditor(mount, {
      automaticLayout: true,
      originalEditable: false,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: 'pp-app',
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    vimAttachmentsRef.current = [
      attachMonacoVim(editor.getOriginalEditor(), originalVimStatusRef.current, {
        enabled: vimEnabledRef.current,
        onModeChange: setVimMode,
      }),
      attachMonacoVim(editor.getModifiedEditor(), modifiedVimStatusRef.current, {
        enabled: vimEnabledRef.current,
        onModeChange: setVimMode,
      }),
    ];
    return () => {
      for (const attachment of vimAttachmentsRef.current) attachment.dispose();
      vimAttachmentsRef.current = [];
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [props.original, props.modified]);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal flow-diff-modal">
        <div className="rt-modal-header">
          <div>
            <h2>Unsaved Changes</h2>
            <p className="desc" style={{ marginBottom: 0 }}>Review the loaded definition beside the current editor content.</p>
          </div>
          <div className="rt-modal-actions">
            <MonacoVimToggle enabled={vimEnabled} mode={vimMode} onToggle={setVimEnabled} />
            <span ref={originalVimStatusRef} className="monaco-vim-status-node" />
            <span ref={modifiedVimStatusRef} className="monaco-vim-status-node" />
            <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
          </div>
        </div>
        <div ref={mountRef} className="flow-diff-editor" />
      </div>
    </div>
  );
}

function optionValue(option: ActionValueOption) {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: ActionValueOption) {
  if (typeof option === 'string') return option;
  return option.title && option.title !== option.value ? `${option.title} (${option.value})` : option.value;
}
