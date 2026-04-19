import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadFlowApiOperationSchema, loadFlowApiOperations } from '../automate-data.js';
import { Icon } from '../Icon.js';
import { Select } from '../Select.js';
import type { FlowAnalysis, FlowApiOperation, FlowApiOperationSchema, ToastFn } from '../ui-types.js';
import type { OutlineContainerTarget } from './outline-utils.js';
import { CommonActionFields, SchemaFieldEditor } from './FlowActionFieldEditors.js';
import {
  BUILT_IN_ACTION_TEMPLATES,
  BUILT_IN_CATEGORIES,
  buildBuiltInAction,
  type BuiltInActionTemplate,
} from './flow-built-in-templates.js';
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
import {
  compatibleConnectionReferences,
  connectorLabel,
  setActionConnectionReference,
  type FlowConnectionModel,
  type FlowConnectionReference,
} from './flow-connections.js';

export function AddFlowActionModal(props: {
  environment: string;
  source: string;
  analysis: FlowAnalysis | null;
  initialRunAfter?: string;
  /** When set, the new action is inserted into a nested container instead of the top-level actions map. */
  containerTarget?: OutlineContainerTarget | null;
  connectionModel: FlowConnectionModel;
  onClose: () => void;
  onAdd: (actionName: string, action: Record<string, unknown>) => void;
  toast: ToastFn;
}) {
  const [pickerTab, setPickerTab] = useState<'builtin' | 'connector'>('builtin');
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
  const [selectedConnectionReferenceName, setSelectedConnectionReferenceName] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topLevelActions = useMemo(() => topLevelActionNames(props.analysis), [props.analysis]);
  const runAfterOptions = props.containerTarget ? props.containerTarget.siblings : topLevelActions;
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
    if (!runAfter && runAfterOptions.length) setRunAfter(runAfterOptions[runAfterOptions.length - 1] || '');
  }, [runAfter, runAfterOptions, props.initialRunAfter]);

  useEffect(() => {
    void doSearch('');
  }, [doSearch]);

  useEffect(() => {
    if (pickerTab === 'connector') {
      // Focus the search once the connector tab renders it.
      const handle = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(handle);
    }
    return undefined;
  }, [pickerTab]);

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
    const compatibleRefs = compatibleConnectionReferences(props.connectionModel, operation);
    const nextReferenceName = compatibleRefs[0]?.name || '';
    setSelectedConnectionReferenceName(nextReferenceName);
    setSelectedOperation(operation);
    setSelectedTemplate(null);
    setSelectedSchema(null);
    const initialName = uniqueActionName(props.source, sanitizeActionName(operation.summary || operation.name || 'Action'));
    setActionName(initialName);
    if (operation.isBuiltIn && !operation.hasConnectorSchema) {
      const builtIn = buildBuiltInAction(operation);
      if (builtIn) {
        setOperationDraft({ ...builtIn, runAfter: buildRunAfter(runAfter) });
        return;
      }
    }
    setOperationDraft(buildApiOperationAction(props.source, operation, buildRunAfter(runAfter), undefined, nextReferenceName || undefined));
  }

  function selectTemplate(template: BuiltInActionTemplate) {
    setSelectedTemplate(template);
    setSelectedOperation(null);
    setSelectedConnectionReferenceName('');
    setSelectedSchema(null);
    setOperationDraft({ ...template.action(), runAfter: buildRunAfter(runAfter) });
    setActionName(uniqueActionName(props.source, template.name));
  }

  useEffect(() => {
    let cancelled = false;
    if (!selectedOperation) return;
    // Non-connector built-ins (Control, DataOperation, Variable, Http, Request, Schedule, ...) have no
    // server-side schema — selectOperation already populates operationDraft from a hardcoded
    // WDL template, so skip the schema fetch and avoid the 404.
    if (!selectedOperation.hasConnectorSchema) return;
    const apiRef = selectedOperation.apiId || selectedOperation.apiName;
    if (!apiRef || !selectedOperation.name) {
      setSelectedSchema(null);
      setOperationDraft(buildApiOperationAction(props.source, selectedOperation, buildRunAfter(runAfter), undefined, selectedConnectionReferenceName || undefined));
      return;
    }
    setSchemaLoading(true);
    void loadFlowApiOperationSchema(props.environment, apiRef, selectedOperation.name)
      .then((schema) => {
        if (cancelled) return;
        setSelectedSchema(schema);
        setOperationDraft(buildApiOperationAction(props.source, selectedOperation, buildRunAfter(runAfter), schema || undefined, selectedConnectionReferenceName || undefined));
      })
      .catch((error) => props.toast(error instanceof Error ? error.message : String(error), true))
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [props.environment, props.source, props.toast, selectedConnectionReferenceName, selectedOperation]);

  const operationDraftRef = useMemo(() => operationDraft ? resolveActionOperation(props.source, operationDraft) : {}, [props.source, operationDraft]);
  const operationDynamicOptions = useFlowDynamicOptions(props.environment, operationDraft, selectedSchema, operationDraftRef, props.toast);
  const operationDynamicSchemaFields = useFlowDynamicSchemaFields(props.environment, operationDraft, selectedSchema, operationDraftRef, props.toast);

  function updateOperationDraft(path: string[], value: unknown) {
    setOperationDraft((current) => current ? setPathValue(current, path, value) : current);
  }

  function updateConnectionReference(referenceName: string) {
    setSelectedConnectionReferenceName(referenceName);
    setOperationDraft((current) => current && referenceName ? setActionConnectionReference(current, referenceName) : current);
  }

  function addAction() {
    const runAfterValue = buildRunAfter(runAfter);
    if (selectedOperation) {
      if (selectedOperation.hasConnectorSchema && !selectedConnectionReferenceName) {
        props.toast('Select or create a compatible connection reference before inserting this connector action.', true);
        return;
      }
      const action = operationDraft || buildApiOperationAction(props.source, selectedOperation, runAfterValue, selectedSchema || undefined, selectedConnectionReferenceName || undefined);
      props.onAdd(actionName, { ...action, runAfter: runAfterValue });
      return;
    }
    if (selectedTemplate) {
      props.onAdd(actionName, { ...(operationDraft || selectedTemplate.action()), runAfter: runAfterValue });
    }
  }

  const selectedSchemaFields = expandDynamicSchemaFields(selectedSchema?.fields || [], operationDynamicSchemaFields);
  const visibleSelectedSchemaFields = visibleConnectorSchemaFields(selectedSchemaFields);
  const hasSelection = Boolean(selectedOperation || selectedTemplate);
  const compatibleReferences = useMemo(
    () => selectedOperation ? compatibleConnectionReferences(props.connectionModel, selectedOperation) : [],
    [props.connectionModel, selectedOperation],
  );
  const connectorNeedsReference = Boolean(selectedOperation && selectedOperation.hasConnectorSchema);
  const canInsert = Boolean(actionName.trim() && hasSelection && (!connectorNeedsReference || selectedConnectionReferenceName));

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal size-xxl add-action-modal">
        <div className="rt-modal-header add-action-header">
          <div className="add-action-title">
            <h2>Add Action</h2>
            <span className="add-action-subtitle">
              {props.containerTarget
                ? <>Inserting into <strong>{props.containerTarget.label}</strong>. Pick a built-in template or connector operation.</>
                : 'Pick a built-in template or a connector operation, then configure it.'}
            </span>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div className="rt-modal-body add-action-body">
          <div className="add-action-pane add-action-picker">
            <div className="add-action-picker-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={pickerTab === 'builtin'}
                className={`add-action-picker-tab ${pickerTab === 'builtin' ? 'active' : ''}`}
                onClick={() => setPickerTab('builtin')}
              >Built-in</button>
              <button
                type="button"
                role="tab"
                aria-selected={pickerTab === 'connector'}
                className={`add-action-picker-tab ${pickerTab === 'connector' ? 'active' : ''}`}
                onClick={() => setPickerTab('connector')}
              >Connectors</button>
            </div>

            {pickerTab === 'builtin' ? (
              <div className="add-action-picker-body add-action-picker-builtins">
                <div className="add-action-section-desc">Workflow primitives that don't need a connector or connection.</div>
                {BUILT_IN_CATEGORIES.map((group) => {
                  const items = BUILT_IN_ACTION_TEMPLATES.filter((item) => item.category === group.key);
                  if (!items.length) return null;
                  return (
                    <div key={group.key} className="add-action-subgroup">
                      <div className="add-action-subgroup-label">
                        <span>{group.label}</span>
                        <span className="add-action-subgroup-hint">{group.hint}</span>
                      </div>
                      <div className="add-action-template-row">
                        {items.map((template) => (
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
                  );
                })}
              </div>
            ) : (
              <div className="add-action-picker-body add-action-picker-connectors">
                <div className="add-action-picker-search-section">
                  <div className="add-action-section-desc">
                    Operations from Dataverse, Outlook, SharePoint, and other Power Platform connectors. Require a connection reference.
                    {loading ? <span className="add-action-searching" style={{ marginLeft: 8 }}>Searching…</span> : null}
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
                        <span className="add-action-operation-title">
                          {operation.summary || operation.name}
                          {operation.isBuiltIn && !operation.hasConnectorSchema ? <span className="add-action-builtin-badge">Built-in</span> : null}
                        </span>
                        <span className="add-action-operation-meta">{operation.apiDisplayName || operation.apiName || 'Connector'} &middot; {operation.name}</span>
                        {operation.description ? <span className="add-action-operation-desc">{operation.description}</span> : null}
                      </span>
                    </button>
                  )) : <div className="add-action-results-empty">{loading ? 'Loading operations…' : 'No operations found.'}</div>}
                </div>
              </div>
            )}
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
                        ...runAfterOptions.map((name) => ({ value: name, label: name })),
                      ]}
                    />
                  </label>
                </div>

                {selectedOperation ? (
                  selectedOperation.isBuiltIn && !selectedOperation.hasConnectorSchema ? (
                    <div className="add-action-note">
                      Built-in workflow action — inserts as WDL type <code>{String(operationDraft?.type || selectedOperation.operationType || '')}</code>.
                    </div>
                  ) : (
                    <div className="add-action-note">
                      Select the connection reference this action should use. Create or repair references in the Connections tab.
                      {' '}
                      {schemaLoading
                        ? 'Loading operation metadata…'
                        : selectedSchema
                          ? `${visibleSelectedSchemaFields.length} parameter${visibleSelectedSchemaFields.length === 1 ? '' : 's'} found${visibleSelectedSchemaFields.some((field) => field.required) ? `, ${visibleSelectedSchemaFields.filter((field) => field.required).length} required` : ''}.`
                          : 'No detailed operation metadata found.'}
                    </div>
                  )
                ) : null}

                {connectorNeedsReference ? (
                  <div className="add-action-config-params">
                    <div className="add-action-section-label">Connection reference</div>
                    {compatibleReferences.length ? (
                      <Select
                        aria-label="Connection reference"
                        value={selectedConnectionReferenceName}
                        onChange={updateConnectionReference}
                        options={compatibleReferences.map(referenceOption)}
                      />
                    ) : (
                      <div className="flow-connection-issue warning">
                        No compatible reference exists for {selectedOperation?.apiDisplayName || selectedOperation?.apiName || 'this connector'}.
                      </div>
                    )}
                  </div>
                ) : null}

                {((selectedOperation?.isBuiltIn && !selectedOperation.hasConnectorSchema) || selectedTemplate) && operationDraft ? (
                  <div className="add-action-config-params">
                    <div className="add-action-section-label">Fields</div>
                    <CommonActionFields action={operationDraft} includeTrailing={false} onChange={updateOperationDraft} />
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
          <button className="btn btn-primary" type="button" disabled={!canInsert} onClick={addAction}>Insert Action</button>
        </div>
      </div>
    </div>
  );
}

function referenceOption(reference: FlowConnectionReference) {
  const connection = reference.connection ? ` -> ${reference.connection.displayName || reference.connection.name}` : '';
  return {
    value: reference.name,
    label: `${reference.name} (${connectorLabel(reference)})${connection}`,
  };
}
