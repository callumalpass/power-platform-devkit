import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { Select } from '../Select.js';

export function CreateRecordModal(props: {
  entityDetail: any;
  environment: string;
  entityMap: Map<string, string>;
  metadataWarnings?: string[];
  onClose: () => void;
  onCreated: (created: any) => void;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { entityDetail, environment, entityMap, metadataWarnings = [], onClose, onCreated, toast } = props;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [fieldFilter, setFieldFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState('{}');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [lookupSearches, setLookupSearches] = useState<Record<string, any>>({});
  const [lookupDetails, setLookupDetails] = useState<Record<string, any>>({});
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const creatableAttributes = useMemo(() => {
    return (entityDetail.attributes || [])
      .filter((attr: any) => {
        if (!attr.logicalName || !attr.isValidForCreate) return false;
        if (attr.isPrimaryId) return false;
        if (attr.attributeOf) return false;
        const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
        if (['partylisttype', 'virtualtype', 'entitynametype', 'managedpropertytype', 'image', 'filetype'].includes(typeName)) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        if (a.isPrimaryName && !b.isPrimaryName) return -1;
        if (!a.isPrimaryName && b.isPrimaryName) return 1;
        return (a.displayName || a.logicalName).localeCompare(b.displayName || b.logicalName);
      });
  }, [entityDetail]);

  const filteredCreatableAttributes = useMemo(() => {
    const filter = fieldFilter.trim().toLowerCase();
    return creatableAttributes.filter((attr: any) => {
      const key = payloadKeyForAttribute(attr);
      if (changedOnly && !(key in values)) return false;
      if (!filter) return true;
      return [attr.logicalName, attr.displayName, attr.description, attr.attributeTypeName, attr.attributeType].filter(Boolean).some((value) => String(value).toLowerCase().includes(filter));
    });
  }, [changedOnly, creatableAttributes, fieldFilter, values]);

  const groupedAttributes = useMemo(() => {
    const required: any[] = [];
    const common: any[] = [];
    const other: any[] = [];
    for (const attr of filteredCreatableAttributes) {
      if (isRequiredAttribute(attr)) required.push(attr);
      else if (attr.isPrimaryName || isLookupAttribute(attr) || attr.optionValues?.length) common.push(attr);
      else other.push(attr);
    }
    return [
      { label: 'Required', items: required },
      { label: 'Common', items: common },
      { label: 'All Fields', items: other }
    ].filter((group) => group.items.length);
  }, [filteredCreatableAttributes]);

  useEffect(() => {
    if (!advanced) setJsonText(JSON.stringify(values, null, 2));
  }, [advanced, values]);

  function updateValue(key: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === '' || value === null || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function updateLookup(attr: any, targetLogicalName: string, id: string) {
    const key = payloadKeyForAttribute(attr);
    const entitySetName = entityMap.get(targetLogicalName) || targetLogicalName;
    const cleanId = id.trim().replace(/[{}]/g, '');
    updateValue(key, cleanId ? `/${entitySetName}(${cleanId})` : null);
  }

  function updateLookupSearch(key: string, patch: Record<string, unknown>) {
    setLookupSearches((current) => ({ ...current, [key]: { ...(current[key] || {}), ...patch } }));
  }

  async function searchLookup(attr: any, targetLogicalName: string) {
    const key = payloadKeyForAttribute(attr);
    const state = lookupSearches[key] || {};
    updateLookupSearch(key, { loading: true, error: null, target: targetLogicalName });
    try {
      const detail = await loadLookupDetail(targetLogicalName);
      const primaryId = detail.primaryIdAttribute;
      const primaryName = detail.primaryNameAttribute;
      const select = [primaryId, primaryName].filter(Boolean);
      const query = String(state.query || '').trim();
      const filter = query && primaryName ? `contains(${primaryName},'${escapeODataString(query)}')` : undefined;
      const resultPayload = await api<any>('/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: detail.entitySetName || entityMap.get(targetLogicalName),
          select,
          filter,
          top: 10
        })
      });
      updateLookupSearch(key, {
        loading: false,
        error: null,
        target: targetLogicalName,
        primaryId,
        primaryName,
        results: resultPayload.data?.records || []
      });
    } catch (err) {
      updateLookupSearch(key, { loading: false, error: err instanceof Error ? err.message : String(err), results: [] });
    }
  }

  async function loadLookupDetail(targetLogicalName: string) {
    const cached = lookupDetails[targetLogicalName];
    if (cached) return cached;
    const detailPayload = await api<any>(`/api/dv/entities/${encodeURIComponent(targetLogicalName)}?environment=${encodeURIComponent(environment)}`);
    const detail = detailPayload.data;
    setLookupDetails((current) => ({ ...current, [targetLogicalName]: detail }));
    return detail;
  }

  function inputForAttribute(attr: any) {
    const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
    const key = payloadKeyForAttribute(attr);
    const val = values[key];
    const commonProps = {
      'aria-label': attr.displayName || attr.logicalName
    };
    if (isLookupAttribute(attr)) {
      const targets = Array.isArray(attr.targets) && attr.targets.length ? attr.targets : [];
      const currentTarget = targets[0] || '';
      const bind = typeof val === 'string' ? val : '';
      const idMatch = /\(([0-9a-f-]{0,36})\)/i.exec(bind);
      const id = idMatch?.[1] || '';
      const targetMatch = /^\/([^()]+)\(/.exec(bind);
      const selectedTarget = targets.find((target: string) => entityMap.get(target) === targetMatch?.[1]) || currentTarget;
      const lookupState = lookupSearches[key] || {};
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: targets.length > 1 ? 'minmax(120px, 0.8fr) minmax(160px, 1.2fr)' : '1fr', gap: 6 }}>
            {targets.length > 1 ? (
              <Select
                className="rt-edit-input"
                value={selectedTarget}
                onChange={(next) => {
                  updateLookup(attr, next, id);
                  updateLookupSearch(key, { target: next, results: [] });
                }}
                {...commonProps}
                options={targets.map((target: string) => ({ value: target, label: target }))}
              />
            ) : null}
            <input
              className="rt-edit-input"
              type="text"
              value={id}
              onChange={(e) => updateLookup(attr, selectedTarget, e.target.value)}
              placeholder={targets.length ? `${selectedTarget || targets[0]} GUID` : 'Related record GUID'}
              {...commonProps}
            />
          </div>
          {selectedTarget ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) auto', gap: 6 }}>
              <input
                className="rt-edit-input"
                type="text"
                value={lookupState.query || ''}
                onChange={(e) => updateLookupSearch(key, { query: e.target.value, target: selectedTarget })}
                placeholder="Search by primary name"
              />
              <button className="btn btn-secondary" type="button" onClick={() => void searchLookup(attr, selectedTarget)} disabled={lookupState.loading}>
                {lookupState.loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          ) : null}
          {lookupState.error ? (
            <div className="create-record-help" style={{ color: 'var(--danger)' }}>
              {lookupState.error}
            </div>
          ) : null}
          {Array.isArray(lookupState.results) && lookupState.results.length ? (
            <div className="create-record-lookup-results">
              {lookupState.results.map((row: any, index: number) => {
                const rowId = row[lookupState.primaryId] || row[Object.keys(row).find((rowKey) => rowKey.endsWith('id')) || ''];
                const label = row[lookupState.primaryName] || row[`${lookupState.primaryId}@OData.Community.Display.V1.FormattedValue`] || rowId;
                if (typeof rowId !== 'string') return null;
                return (
                  <button key={`${rowId}-${index}`} className="create-record-lookup-result" type="button" onClick={() => updateLookup(attr, selectedTarget, rowId)}>
                    <span>{String(label)}</span>
                    <code>{rowId.slice(0, 8)}...</code>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }
    if (Array.isArray(attr.optionValues) && attr.optionValues.length) {
      return (
        <Select
          className="rt-edit-input"
          value={val === undefined ? '' : String(val)}
          onChange={(next) => updateValue(key, next === '' ? null : Number(next))}
          {...commonProps}
          options={[
            { value: '', label: 'Select value...' },
            ...attr.optionValues.map((option: any) => ({
              value: String(option.value),
              label: option.label ? `${option.label} (${option.value})` : String(option.value)
            }))
          ]}
        />
      );
    }
    if (typeName === 'booleantype' || typeName === 'boolean') {
      return (
        <Select
          className="rt-edit-input"
          value={val === undefined ? '' : String(val)}
          onChange={(next) => updateValue(key, next === '' ? null : next === 'true')}
          {...commonProps}
          options={[
            { value: '', label: 'Use default' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' }
          ]}
        />
      );
    }
    if (typeName.includes('integer') || typeName.includes('decimal') || typeName.includes('double') || typeName.includes('money') || typeName.includes('bigint')) {
      const step = attr.precision != null && attr.precision > 0 ? `0.${'0'.repeat(Math.max(0, attr.precision - 1))}1` : '1';
      return (
        <input
          className="rt-edit-input"
          type="number"
          min={attr.minValue ?? undefined}
          max={attr.maxValue ?? undefined}
          step={step}
          value={val === undefined ? '' : String(val)}
          onChange={(e) => updateValue(key, e.target.value === '' ? null : Number(e.target.value))}
          {...commonProps}
        />
      );
    }
    if (typeName.includes('memo')) {
      return (
        <textarea
          className="rt-edit-input"
          rows={3}
          maxLength={attr.maxLength ?? undefined}
          value={val === undefined ? '' : String(val)}
          onChange={(e) => updateValue(key, e.target.value || null)}
          {...commonProps}
        />
      );
    }
    if (typeName.includes('datetime')) {
      return (
        <input
          className="rt-edit-input"
          type="datetime-local"
          value={dateInputValue(val)}
          onChange={(e) => updateValue(key, e.target.value ? new Date(e.target.value).toISOString() : null)}
          {...commonProps}
        />
      );
    }
    return (
      <input
        className="rt-edit-input"
        type="text"
        maxLength={attr.maxLength ?? undefined}
        value={val === undefined ? '' : String(val)}
        onChange={(e) => updateValue(key, e.target.value || null)}
        placeholder={isRequiredAttribute(attr) || attr.isPrimaryName ? 'Required' : ''}
        {...commonProps}
      />
    );
  }

  function readSubmitBody(): Record<string, unknown> | null {
    if (!advanced) return values;
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFormErrors(['Advanced JSON must be an object.']);
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      setFormErrors([err instanceof Error ? err.message : String(err)]);
      return null;
    }
  }

  async function handleSubmit() {
    const body = readSubmitBody();
    if (!body) return;
    const errors = validateCreateBody(body, creatableAttributes);
    setFormErrors(errors);
    if (errors.length) {
      toast(errors[0], true);
      return;
    }
    setSaving(true);
    try {
      const payload = await api<any>('/api/dv/records/create', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: entityDetail.entitySetName,
          logicalName: entityDetail.logicalName,
          primaryIdAttribute: entityDetail.primaryIdAttribute,
          body
        })
      });
      const created = payload.data;
      toast(created?.id ? 'Record created and opened.' : 'Record created. Dataverse did not return the new row ID.');
      onCreated(payload.data);
    } catch (err) {
      toast(formatCreateError(err), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rt-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="rt-modal size-md">
        <div className="rt-modal-header">
          <div>
            <h3 className="rt-modal-title">New {entityDetail.displayName || entityDetail.logicalName}</h3>
            <span className="rt-modal-id">
              {environment} / {entityDetail.entitySetName}
            </span>
          </div>
          <div className="rt-modal-actions">
            <CopyButton value={advanced ? jsonText : JSON.stringify(values, null, 2)} label="Copy request" title="Copy create request body" toast={toast} />
            <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
        <div className="rt-modal-body body-flush">
          <div className="create-record-toolbar">
            <input className="rt-edit-input" type="text" placeholder="Filter fields..." value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} />
            <label className="rt-edit-check">
              <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed only
            </label>
            <label className="rt-edit-check">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(e) => {
                  setAdvanced(e.target.checked);
                  if (e.target.checked) setJsonText(JSON.stringify(values, null, 2));
                }}
              />{' '}
              Advanced JSON
            </label>
          </div>
          <div className="create-record-warning">
            Creates a Dataverse row in <strong>{environment}</strong>. Review required fields and lookup binds before submitting.
          </div>
          {metadataWarnings.length ? (
            <div className="create-record-metadata-warning">
              {metadataWarnings.slice(0, 3).map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
              {metadataWarnings.length > 3 ? <div>{metadataWarnings.length - 3} more metadata warnings. Advanced JSON is still available.</div> : null}
            </div>
          ) : null}
          {formErrors.length ? (
            <div className="rt-modal-error">
              {formErrors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </div>
          ) : null}
          {advanced ? (
            <textarea className="rt-edit-input create-record-json" value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
          ) : groupedAttributes.length ? (
            groupedAttributes.map((group) => (
              <div key={group.label}>
                <div className="create-record-section">{group.label}</div>
                <table className="rt-detail-table">
                  <tbody>
                    {group.items.map((attr: any) => {
                      const key = payloadKeyForAttribute(attr);
                      return (
                        <tr key={attr.logicalName} className={key in values ? 'rt-detail-edited' : ''}>
                          <td className="rt-detail-key">
                            {attr.displayName || attr.logicalName}
                            {isRequiredAttribute(attr) ? <span className="create-record-required">required</span> : null}
                            <div style={{ fontSize: '0.5625rem', color: 'var(--border)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{key}</div>
                          </td>
                          <td className="rt-detail-value">
                            {inputForAttribute(attr)}
                            <div className="create-record-help">{[attr.description, fieldConstraintLabel(attr)].filter(Boolean).join(' ')}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <div className="rt-modal-loading">No creatable fields match the current filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function payloadKeyForAttribute(attr: any): string {
  return isLookupAttribute(attr) ? `${attr.logicalName}@odata.bind` : attr.logicalName;
}

function isLookupAttribute(attr: any): boolean {
  const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
  return typeName.includes('lookup') || typeName.includes('customer') || typeName.includes('owner');
}

function isRequiredAttribute(attr: any): boolean {
  return /required/i.test(String(attr.requiredLevel || ''));
}

function fieldConstraintLabel(attr: any): string {
  const parts = [];
  if (attr.maxLength != null) parts.push(`Max ${attr.maxLength} chars.`);
  if (attr.minValue != null || attr.maxValue != null) parts.push(`Range ${attr.minValue ?? '-inf'} to ${attr.maxValue ?? 'inf'}.`);
  if (Array.isArray(attr.targets) && attr.targets.length) parts.push(`Targets: ${attr.targets.join(', ')}.`);
  return parts.join(' ');
}

function dateInputValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatCreateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/DV_RECORD_BODY_REQUIRED/i.test(message) || /at least one field/i.test(message)) return 'Add at least one field before creating the record.';
  if (/ENVIRONMENT_WRITE_BLOCKED/i.test(message) || /read-only/i.test(message)) return 'This environment is read-only. Choose a writable environment before creating records.';
  if (/HTTP_REQUEST_FAILED/i.test(message)) return 'Dataverse rejected the create request. Review required fields, lookup binds, and field values.';
  if (/0x800402|required|Business Process Error|validation/i.test(message)) return `Dataverse rejected the record: ${message}`;
  return message;
}

function validateCreateBody(body: Record<string, unknown>, attributes: any[]): string[] {
  const errors: string[] = [];
  if (!Object.keys(body).length) errors.push('Enter at least one field value.');
  const attributesByPayloadKey = new Map(attributes.map((attr: any) => [payloadKeyForAttribute(attr), attr]));
  for (const attr of attributes) {
    const key = payloadKeyForAttribute(attr);
    if (isRequiredAttribute(attr) && !(key in body)) errors.push(`${attr.displayName || attr.logicalName} is required.`);
  }
  for (const [key, value] of Object.entries(body)) {
    const attr = attributesByPayloadKey.get(key);
    if (!attr) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(`${key} must be a valid number.`);
      if (attr.minValue != null && value < attr.minValue) errors.push(`${key} must be at least ${attr.minValue}.`);
      if (attr.maxValue != null && value > attr.maxValue) errors.push(`${key} must be no more than ${attr.maxValue}.`);
    }
    if (typeof value === 'string' && attr.maxLength != null && value.length > attr.maxLength) {
      errors.push(`${key} must be ${attr.maxLength} characters or fewer.`);
    }
    if (key.endsWith('@odata.bind') && typeof value === 'string' && !/^\/[^()]+\([0-9a-f-]{36}\)$/i.test(value)) {
      errors.push(`${key} must look like /entityset(00000000-0000-0000-0000-000000000000).`);
    }
  }
  return errors;
}
