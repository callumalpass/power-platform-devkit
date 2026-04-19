import type { FlowApiOperationSchemaField, FlowDynamicValueOption } from '../ui-types.js';
import { Select } from '../Select.js';
import {
  builtInFieldsForAction,
  type BuiltInActionField,
} from './flow-built-in-templates.js';
import { FlowExpressionValueEditor } from './FlowExpressionValueEditor.js';
import {
  isObject,
  parseEditableJson,
  readPathValue,
  schemaTypeLabel,
  shouldEditAsJson,
  valueToEditText,
} from './flow-action-document.js';
import { summarizeDynamicMetadata } from './flow-dynamic-schema.js';

export function CommonActionFields(props: {
  action: Record<string, unknown>;
  includeTrailing?: boolean;
  source: string;
  onChange: (path: string[], value: unknown) => void;
}) {
  const type = String(props.action.type || '').toLowerCase();
  const builtInFields = builtInFieldsForAction(props.action);
  const fields: BuiltInActionField[] = builtInFields.length ? [...builtInFields] : [];
  if (!fields.length) {
    if (type === 'openapiconnection' || type === 'apiconnection') {
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
    }
  }
  const trailing: BuiltInActionField[] = props.includeTrailing === false ? [] : [
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
          source={props.source}
          onChange={(value) => props.onChange(field.path, value)}
        />
      ))}
      {fields.length > 0 && trailing.length > 0 ? <div className="flow-action-field-divider" /> : null}
      {trailing.map((field) => (
        <ActionValueEditor
          key={field.path.join('.')}
          label={field.label}
          value={readPathValue(props.action, field.path)}
          kind={field.kind}
          source={props.source}
          onChange={(value) => props.onChange(field.path, value)}
        />
      ))}
    </div>
  );
}
type ActionValueOption = string | FlowDynamicValueOption;

export function SchemaFieldEditor(props: { field: FlowApiOperationSchemaField; value: unknown; options?: FlowDynamicValueOption[]; source: string; onChange: (value: unknown) => void }) {
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
      <ActionValueEditor value={props.value} kind={options?.length ? 'select' : shouldEditAsJson(field) ? 'json' : 'text'} options={options} source={props.source} onChange={props.onChange} />
    </div>
  );
}
function ActionValueEditor(props: { label?: string; value: unknown; kind?: 'text' | 'json' | 'select'; options?: ActionValueOption[]; source: string; onChange: (value: unknown) => void }) {
  const kind = props.kind || (isObject(props.value) || Array.isArray(props.value) ? 'json' : 'text');
  const valueText = valueToEditText(props.value, kind);
  const content = kind === 'select' ? (
    <Select
      aria-label={props.label || 'Value'}
      value={String(props.value ?? '')}
      onChange={(next) => props.onChange(next)}
      options={[
        { value: '', label: 'not set' },
        ...(props.options || []).map((item) => ({ value: optionValue(item), label: optionLabel(item) })),
      ]}
    />
  ) : kind === 'json' ? (
    <FlowExpressionValueEditor
      value={valueText}
      source={props.source}
      mode="json"
      onChange={(next) => props.onChange(parseEditableJson(next))}
    />
  ) : (
    <FlowExpressionValueEditor
      value={valueText}
      source={props.source}
      mode="text"
      onChange={(next) => props.onChange(next)}
    />
  );
  return props.label ? (
    <div className="flow-action-value-editor" role="group" aria-label={props.label}>
      <span>{props.label}</span>
      {content}
    </div>
  ) : content;
}
function optionValue(option: ActionValueOption) {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: ActionValueOption) {
  if (typeof option === 'string') return option;
  return option.title && option.title !== option.value ? `${option.title} (${option.value})` : option.value;
}
