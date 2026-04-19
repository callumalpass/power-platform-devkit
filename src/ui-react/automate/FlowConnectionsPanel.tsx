import { useEffect, useState } from 'react';
import { CopyButton } from '../CopyButton.js';
import { Select } from '../Select.js';
import type { ToastFn } from '../ui-types.js';
import {
  compatibleEnvironmentConnections,
  connectionStatusLabel,
  connectionStatusLevel,
  connectorLabel,
  defaultReferenceNameForConnection,
  findReferenceForUsage,
  findUsageForAction,
  type FlowConnectionModel,
  type FlowConnectionReference,
  type FlowConnectionUsage,
  type FlowEnvironmentConnection,
} from './flow-connections.js';

export type FlowConnectionInspectSeed = {
  title: string;
  subtitle?: string;
  api: string;
  method: string;
  path: string;
};

export function FlowConnectionsPanel(props: {
  active: boolean;
  source: string;
  model: FlowConnectionModel;
  loading: boolean;
  toast: ToastFn;
  onBindReference: (referenceName: string, connection: FlowEnvironmentConnection) => void;
  onRemoveReference: (reference: FlowConnectionReference) => void;
  onRefreshConnections: () => void;
  onInspect: (seed: FlowConnectionInspectSeed) => void;
}) {
  const { active, model } = props;
  const errorCount = model.issues.filter((issue) => issue.level === 'error').length;
  const warningCount = model.issues.filter((issue) => issue.level === 'warning').length;
  const connectedCount = model.references.filter((reference) => reference.status === 'bound').length;

  return (
    <div className={`dv-subpanel ${active ? 'active' : ''}`}>
      <div className="panel flow-connections-panel">
        <div className="flow-connections-header">
          <div>
            <h2>Connections &amp; References</h2>
            <p className="desc no-mb">Bind flow connection references to authenticated environment connections. Changes update the editor only.</p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" disabled={props.loading} onClick={props.onRefreshConnections}>
            {props.loading ? 'Refreshing...' : 'Refresh connections'}
          </button>
        </div>

        <div className="metrics flow-connections-metrics">
          <SummaryMetric label="References" value={String(model.references.length)} />
          <SummaryMetric label="Bound" value={String(connectedCount)} />
          <SummaryMetric label="Environment connections" value={String(model.connections.length)} />
          <SummaryMetric label="Problems" value={`${errorCount} errors, ${warningCount} warnings`} />
        </div>

        <AddReferenceCard
          source={props.source}
          connections={model.connections}
          onBindReference={props.onBindReference}
        />

        <div className="flow-connections-grid">
          <section className="flow-connections-section">
            <div className="flow-connections-section-title">References</div>
            {model.references.length ? model.references.map((reference) => (
              <ReferenceCard
                key={reference.name}
                reference={reference}
                connections={model.connections}
                toast={props.toast}
                onBindReference={props.onBindReference}
                onRemoveReference={props.onRemoveReference}
                onInspect={props.onInspect}
              />
            )) : <div className="empty">No connection references in this flow.</div>}
          </section>

          <section className="flow-connections-section">
            <div className="flow-connections-section-title">Repair</div>
            {model.issues.length ? (
              <div className="flow-connection-issues">
                {model.issues.map((issue, index) => (
                  <div key={`${issue.code}:${issue.referenceName || issue.actionName || index}`} className={`flow-connection-issue ${issue.level}`}>
                    <div className="flow-connection-issue-code">
                      {issue.code}
                      {issue.referenceName ? ` · ${issue.referenceName}` : ''}
                      {issue.actionName ? ` · ${issue.actionName}` : ''}
                    </div>
                    <div>{issue.message}</div>
                    {issue.referenceName && !model.references.some((reference) => reference.name === issue.referenceName) ? (
                      <MissingReferenceRepair
                        referenceName={issue.referenceName}
                        usage={model.usages.find((usage) => usage.referenceName === issue.referenceName)}
                        model={model}
                        onBindReference={props.onBindReference}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <div className="empty">No connection problems found.</div>}

            <div className="flow-connections-section-title" style={{ marginTop: 16 }}>Environment connections</div>
            {model.connections.length ? model.connections.map((connection) => (
              <EnvironmentConnectionRow
                key={connection.name}
                connection={connection}
                toast={props.toast}
                onInspect={props.onInspect}
              />
            )) : <div className="empty">{props.loading ? 'Loading connections...' : 'No environment connections found.'}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

export function FlowActionConnectionCard(props: {
  model: FlowConnectionModel;
  actionName?: string;
  toast: ToastFn;
}) {
  const usage = findUsageForAction(props.model, props.actionName);
  const reference = findReferenceForUsage(props.model, usage);
  const issue = props.model.issues.find((item) => item.actionName === props.actionName);
  if (!usage && !issue) return null;
  return (
    <div className="flow-action-connection-card">
      <div className="flow-action-connection-card-title">Connection reference</div>
      {usage ? (
        <div className="metrics" style={{ marginBottom: 0 }}>
          <SummaryMetric label="Connector" value={connectorLabel(usage)} />
          <SummaryMetric label="Operation" value={usage.operationId || '-'} />
          <SummaryMetric label="Reference" value={usage.referenceName || '-'} copy toast={props.toast} />
          <SummaryMetric label="Status" value={reference ? connectionStatusLabel(reference.status) : 'Missing reference'} />
        </div>
      ) : (
        <div className="empty">No connector wiring found for this action.</div>
      )}
      {reference?.connection ? (
        <div className="flow-action-connection-note">
          Bound to {reference.connection.displayName || reference.connection.name}
        </div>
      ) : null}
      {issue ? <div className={`flow-connection-issue ${issue.level}`} style={{ marginTop: 8 }}>{issue.message}</div> : null}
    </div>
  );
}

function AddReferenceCard(props: {
  source: string;
  connections: FlowEnvironmentConnection[];
  onBindReference: (referenceName: string, connection: FlowEnvironmentConnection) => void;
}) {
  const [connectionName, setConnectionName] = useState('');
  const selectedConnection = props.connections.find((connection) => connection.name === connectionName);
  const [referenceName, setReferenceName] = useState('');

  useEffect(() => {
    const first = props.connections[0]?.name || '';
    setConnectionName((current) => current && props.connections.some((connection) => connection.name === current) ? current : first);
  }, [props.connections]);

  useEffect(() => {
    if (!selectedConnection) return;
    setReferenceName((current) => current || defaultReferenceNameForConnection(props.source, selectedConnection));
  }, [props.source, selectedConnection]);

  return (
    <div className="flow-connection-add-card">
      <div>
        <div className="flow-connections-section-title">Add reference</div>
        <div className="flow-connection-muted">Create a connection reference bound to an existing authenticated connection.</div>
      </div>
      <div className="flow-connection-add-controls">
        <input
          type="text"
          value={referenceName}
          placeholder="Reference name"
          onChange={(event) => setReferenceName(event.target.value)}
        />
        <Select
          aria-label="Environment connection"
          value={connectionName}
          onChange={(value) => {
            setConnectionName(value);
            const next = props.connections.find((connection) => connection.name === value);
            if (next) setReferenceName(defaultReferenceNameForConnection(props.source, next));
          }}
          options={props.connections.map((connection) => ({ value: connection.name, label: connectionOptionLabel(connection) }))}
        />
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={!selectedConnection || !referenceName.trim()}
          onClick={() => { if (selectedConnection) props.onBindReference(referenceName, selectedConnection); }}
        >
          Add reference
        </button>
      </div>
    </div>
  );
}

function ReferenceCard(props: {
  reference: FlowConnectionReference;
  connections: FlowEnvironmentConnection[];
  toast: ToastFn;
  onBindReference: (referenceName: string, connection: FlowEnvironmentConnection) => void;
  onRemoveReference: (reference: FlowConnectionReference) => void;
  onInspect: (seed: FlowConnectionInspectSeed) => void;
}) {
  const compatible = compatibleConnectionsForReference(props.reference, props.connections);
  const fallback = props.reference.connection?.name || compatible[0]?.name || props.connections[0]?.name || '';
  const [selectedConnectionName, setSelectedConnectionName] = useState(fallback);
  const selectedConnection = props.connections.find((connection) => connection.name === selectedConnectionName);
  const statusLevel = connectionStatusLevel(props.reference.status);

  useEffect(() => {
    setSelectedConnectionName((current) => current && props.connections.some((connection) => connection.name === current) ? current : fallback);
  }, [fallback, props.connections]);

  return (
    <div className={`flow-connection-card status-${statusLevel}`}>
      <div className="flow-connection-card-main">
        <div>
          <div className="flow-connection-title-row">
            <span className="flow-connection-title">{connectorLabel(props.reference)}</span>
            <span className={`flow-connection-status ${statusLevel}`}>{connectionStatusLabel(props.reference.status)}</span>
          </div>
          <div className="flow-connection-meta">
            Reference <code>{props.reference.name}</code>
            {props.reference.logicalName ? <> · logical <code>{props.reference.logicalName}</code></> : null}
          </div>
          <div className="flow-connection-meta">
            Connection {props.reference.connection ? (
              <>{props.reference.connection.displayName || props.reference.connection.name}</>
            ) : props.reference.connectionName ? (
              <code>{props.reference.connectionName}</code>
            ) : (
              'not bound'
            )}
          </div>
        </div>
        <div className="flow-connection-actions">
          <CopyButton value={props.reference.name} label="copy ref" title="Copy reference name" toast={props.toast} />
          {props.reference.connection ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => props.onInspect({
                title: props.reference.connection!.displayName || props.reference.connection!.name,
                subtitle: `Connection · ${connectorLabel(props.reference)}`,
                api: 'powerapps',
                method: 'GET',
                path: `/connections/${encodeURIComponent(props.reference.connection!.name)}`,
              })}
            >
              View connection
            </button>
          ) : null}
        </div>
      </div>

      <div className="flow-connection-usages">
        {props.reference.usages.length ? props.reference.usages.map((usage) => (
          <span key={`${usage.path}:${usage.name}`} className="flow-connection-usage">
            {usage.name}{usage.operationId ? ` · ${usage.operationId}` : ''}
          </span>
        )) : <span className="flow-connection-muted">No action usage found.</span>}
      </div>

      {props.reference.issues.length ? (
        <div className="flow-connection-issues compact">
          {props.reference.issues.map((issue, index) => (
            <div key={`${issue.code}:${index}`} className={`flow-connection-issue ${issue.level}`}>{issue.message}</div>
          ))}
        </div>
      ) : null}

      <div className="flow-connection-bind-row">
        <Select
          aria-label={`Connection for ${props.reference.name}`}
          value={selectedConnectionName}
          onChange={setSelectedConnectionName}
          options={props.connections.map((connection) => ({
            value: connection.name,
            label: connectionOptionLabel(connection, compatible.some((item) => item.name === connection.name) ? '' : 'other connector'),
          }))}
        />
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={!selectedConnection}
          onClick={() => { if (selectedConnection) props.onBindReference(props.reference.name, selectedConnection); }}
        >
          Rebind
        </button>
        <button
          className="btn btn-ghost btn-sm btn-danger-text"
          type="button"
          disabled={props.reference.usages.length > 0}
          title={props.reference.usages.length > 0 ? 'Only unused references can be removed here.' : undefined}
          onClick={() => props.onRemoveReference(props.reference)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function MissingReferenceRepair(props: {
  referenceName: string;
  usage: FlowConnectionUsage | undefined;
  model: FlowConnectionModel;
  onBindReference: (referenceName: string, connection: FlowEnvironmentConnection) => void;
}) {
  const options = compatibleEnvironmentConnections(props.model, props.usage?.apiName || props.usage?.apiId);
  const [connectionName, setConnectionName] = useState(options[0]?.name || '');
  const selected = props.model.connections.find((connection) => connection.name === connectionName);
  if (!options.length) return null;
  return (
    <div className="flow-connection-repair-row">
      <Select
        aria-label={`Repair ${props.referenceName}`}
        value={connectionName}
        onChange={setConnectionName}
        options={options.map((connection) => ({ value: connection.name, label: connectionOptionLabel(connection) }))}
      />
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={!selected}
        onClick={() => { if (selected) props.onBindReference(props.referenceName, selected); }}
      >
        Create reference
      </button>
    </div>
  );
}

function EnvironmentConnectionRow(props: {
  connection: FlowEnvironmentConnection;
  toast: ToastFn;
  onInspect: (seed: FlowConnectionInspectSeed) => void;
}) {
  return (
    <div className="flow-environment-connection-row">
      <div>
        <div className="flow-connection-title">{props.connection.displayName || props.connection.name}</div>
        <div className="flow-connection-meta">
          {connectorLabel(props.connection)}
          {props.connection.status ? ` · ${props.connection.status}` : ''}
        </div>
      </div>
      <div className="flow-connection-actions">
        <CopyButton value={props.connection.name} label="copy" title="Copy connection name" toast={props.toast} />
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => props.onInspect({
            title: props.connection.displayName || props.connection.name,
            subtitle: `Connection · ${connectorLabel(props.connection)}`,
            api: 'powerapps',
            method: 'GET',
            path: `/connections/${encodeURIComponent(props.connection.name)}`,
          })}
        >
          View
        </button>
      </div>
    </div>
  );
}

function SummaryMetric(props: { label: string; value: string; copy?: boolean; toast?: ToastFn }) {
  return (
    <div className="metric">
      <div className="metric-label">{props.label}</div>
      <div className="metric-value copy-inline">
        <span className="copy-inline-value">{props.value}</span>
        {props.copy && props.toast ? <CopyButton value={props.value} label="copy" title={`Copy ${props.label}`} toast={props.toast} /> : null}
      </div>
    </div>
  );
}

function compatibleConnectionsForReference(reference: FlowConnectionReference, connections: FlowEnvironmentConnection[]) {
  const apiName = reference.apiName || reference.apiId;
  if (!apiName) return connections;
  const model: FlowConnectionModel = { references: [], usages: [], issues: [], connections, unusedConnections: [] };
  return compatibleEnvironmentConnections(model, apiName);
}

function connectionOptionLabel(connection: FlowEnvironmentConnection, suffix = '') {
  return `${connection.displayName || connection.name} (${connectorLabel(connection)})${suffix ? ` - ${suffix}` : ''}`;
}
