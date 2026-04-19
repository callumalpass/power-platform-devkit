import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadFlowApiOperationSchema, loadFlowApiOperations } from '../automate-data.js';
import { Icon } from '../Icon.js';
import { Select } from '../Select.js';
import type { FlowAnalysis, FlowApiOperation, FlowApiOperationSchema, ToastFn } from '../ui-types.js';
import { SchemaFieldEditor } from './FlowActionFieldEditors.js';
import {
  buildApiOperationAction,
  buildRunAfter,
  connectorFieldPath,
  readPathValue,
  resolveActionOperation,
  sanitizeActionName,
  setPathValue,
  topLevelActionNames,
  uniqueActionName,
} from './flow-action-document.js';
import {
  expandDynamicSchemaFields,
  fieldSchemaKey,
  useFlowDynamicOptions,
  useFlowDynamicSchemaFields,
  visibleConnectorSchemaFields,
} from './flow-dynamic-schema.js';

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
                    <Select
                      aria-label="Run after"
                      value={runAfter}
                      onChange={setRunAfter}
                      options={[
                        { value: '', label: 'none' },
                        ...topLevelActions.map((name) => ({ value: name, label: name })),
                      ]}
                    />
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
