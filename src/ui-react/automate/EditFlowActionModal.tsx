import { useEffect, useMemo, useState } from 'react';
import { loadFlowApiOperationSchema } from '../automate-data.js';
import type { FlowApiOperationSchema, ToastFn } from '../ui-types.js';
import type { FlowActionEditTarget } from './types.js';
import { isActionLikeOutlineItem, outlineTitle } from './outline-utils.js';
import { CommonActionFields, SchemaFieldEditor } from './FlowActionFieldEditors.js';
import {
  connectorFieldPath,
  existingConnectorParameterFields,
  formatOutlineEditName,
  isObject,
  readPathValue,
  resolveActionOperation,
  setPathValue,
} from './flow-action-document.js';
import {
  connectorLocationLabel,
  expandDynamicSchemaFields,
  fieldSchemaKey,
  groupConnectorFields,
  useFlowDynamicOptions,
  useFlowDynamicSchemaFields,
  visibleConnectorSchemaFields,
} from './flow-dynamic-schema.js';

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
