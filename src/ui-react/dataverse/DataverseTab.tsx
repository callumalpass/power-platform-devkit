import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { getDefaultSelectedColumns } from '../utils.js';
import { FetchXmlTab, RelationshipsTab } from '../DataversePanels.js';
import { ResultView } from '../ResultView.js';
import { CopyButton } from '../CopyButton.js';
import { RecordDetailModal, useRecordDetail } from '../RecordDetailModal.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { api } from '../utils.js';
import { CreateRecordModal } from './CreateRecordModal.js';
import type { ApiEnvelope, DataverseAttribute, DataverseEntityDetail, DataverseEntitySummary, DataverseRecordPage, DataverseState, DiagnosticItem } from '../ui-types.js';

type DataverseSubTab = 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';

export function DataverseTab(props: {
  dataverse: DataverseState;
  setDataverse: React.Dispatch<React.SetStateAction<DataverseState>>;
  environment: string;
  environmentUrl: string;
  loadEntities: () => Promise<void>;
  loadEntityDetail: (logicalName: string) => Promise<void>;
  loadRecordPreview: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, setDataverse, environment, environmentUrl, loadEntities, loadEntityDetail, loadRecordPreview, toast } = props;
  const [showCreateRecord, setShowCreateRecord] = useState(false);
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null);
  const detail = useRecordDetail();
  const [queryForm, setQueryForm] = useState({
    entitySetName: '',
    top: '10',
    selectCsv: '',
    filter: '',
    orderByCsv: '',
    expandCsv: '',
    rawPath: '',
    includeCount: false
  });
  const filteredEntities = dataverse.entityFilter
    ? dataverse.entities.filter(
        (item: DataverseEntitySummary) =>
          item.logicalName.includes(dataverse.entityFilter.toLowerCase()) ||
          (item.displayName || '').toLowerCase().includes(dataverse.entityFilter.toLowerCase()) ||
          (item.entitySetName || '').toLowerCase().includes(dataverse.entityFilter.toLowerCase())
      )
    : dataverse.entities;

  const entityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of dataverse.entities) {
      if (entity.logicalName && entity.entitySetName) map.set(entity.logicalName, entity.entitySetName);
    }
    return map;
  }, [dataverse.entities]);

  useEffect(() => {
    setQueryForm({
      entitySetName: '',
      top: '10',
      selectCsv: '',
      filter: '',
      orderByCsv: '',
      expandCsv: '',
      rawPath: '',
      includeCount: false
    });
    setCreatedRecordId(null);
  }, [environment]);

  const filteredAttributes = dataverse.currentEntityDetail
    ? (dataverse.currentEntityDetail.attributes || []).filter((attribute: DataverseAttribute) => {
        if (!dataverse.attrFilter) return true;
        const filter = dataverse.attrFilter.toLowerCase();
        return attribute.logicalName.includes(filter) || (attribute.displayName || '').toLowerCase().includes(filter);
      })
    : [];

  useEffect(() => {
    const entityDetail = dataverse.currentEntityDetail;
    if (!entityDetail) return;
    setQueryForm((current) => ({
      ...current,
      entitySetName: entityDetail.entitySetName || '',
      selectCsv: (dataverse.selectedColumns.length ? dataverse.selectedColumns : getDefaultSelectedColumns(entityDetail, 0)).join(','),
      orderByCsv: orderByDefault(entityDetail)
    }));
    setCreatedRecordId(null);
  }, [dataverse.currentEntityDetail, dataverse.selectedColumns]);

  function readQueryForm(event: FormEvent<HTMLFormElement> | ReactMouseEvent<HTMLButtonElement>) {
    const target = event.currentTarget;
    const form = target instanceof HTMLFormElement ? target : target.form;
    if (!form) return queryForm;
    const data = new FormData(form);
    return {
      entitySetName: String(data.get('entitySetName') || ''),
      top: String(data.get('top') || ''),
      selectCsv: String(data.get('selectCsv') || ''),
      filter: String(data.get('filter') || ''),
      orderByCsv: String(data.get('orderByCsv') || ''),
      expandCsv: String(data.get('expandCsv') || ''),
      rawPath: String(data.get('rawPath') || ''),
      includeCount: data.get('includeCount') === 'on'
    };
  }

  async function runQuery(event: FormEvent<HTMLFormElement> | ReactMouseEvent<HTMLButtonElement>, previewOnly = false) {
    event.preventDefault();
    const submitted = readQueryForm(event);
    try {
      const payload = await api<ApiEnvelope<DataverseRecordPage>>(previewOnly ? '/api/dv/query/preview' : '/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: submitted.entitySetName,
          top: submitted.top,
          selectCsv: submitted.selectCsv,
          filter: submitted.filter,
          orderByCsv: submitted.orderByCsv,
          expandCsv: submitted.expandCsv,
          rawPath: submitted.rawPath,
          includeCount: submitted.includeCount
        })
      });
      if (previewOnly) {
        setDataverse((current) => ({ ...current, queryPreview: payload.data.path || '' }));
      } else {
        setDataverse((current) => ({
          ...current,
          queryPreview: payload.data?.path || current.queryPreview,
          queryResult: payload.data
        }));
        toast('Query executed');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <>
      <div className="entity-sidebar">
        <div className="panel">
          <h2>Entities</h2>
          <input
            type="text"
            id="entity-filter"
            className="entity-filter"
            placeholder="Filter entities…"
            value={dataverse.entityFilter}
            onChange={(event) => setDataverse((current) => ({ ...current, entityFilter: event.target.value }))}
          />
          <div id="entity-count" className="entity-count">
            {dataverse.entities.length ? `${dataverse.entities.length} entities` : ''}
          </div>
          <div id="entity-list" className="entity-list">
            {dataverse.entities.length ? (
              filteredEntities.map((entity: DataverseEntitySummary) => {
                const flags = [];
                if (entity.isCustomEntity)
                  flags.push(
                    <span key="custom" className="entity-item-flag">
                      custom
                    </span>
                  );
                if (entity.isActivity)
                  flags.push(
                    <span key="activity" className="entity-item-flag">
                      activity
                    </span>
                  );
                const isActive = dataverse.currentEntity?.logicalName === entity.logicalName;
                return (
                  <button
                    type="button"
                    key={entity.logicalName}
                    className={`entity-item ${isActive ? 'active' : ''}`}
                    data-entity={entity.logicalName}
                    aria-pressed={isActive}
                    onClick={() => void loadEntityDetail(entity.logicalName)}
                  >
                    <div className="entity-item-name">{entity.displayName || entity.logicalName}</div>
                    <div className="entity-item-logical">{entity.logicalName}</div>
                    <div className="entity-item-badges">
                      {entity.entitySetName ? <span className="entity-item-set">{entity.entitySetName}</span> : null}
                      {flags}
                    </div>
                  </button>
                );
              })
            ) : dataverse.entitiesLoadError ? (
              <div className="error-banner" role="alert">
                <div className="error-banner-header">
                  <Icon name="circle" size={14} />
                  <span>Could not load entities</span>
                </div>
                <div className="error-banner-body">{dataverse.entitiesLoadError}</div>
                <div className="error-banner-actions">
                  <button className="btn btn-sm btn-secondary" type="button" onClick={() => void loadEntities()}>
                    Retry
                  </button>
                  <CopyButton value={dataverse.entitiesLoadError} label="Copy error" title="Copy error message" toast={toast} />
                </div>
              </div>
            ) : (
              <div className="entity-loading">Select an environment to load entities.</div>
            )}
          </div>
        </div>
      </div>
      <div className="detail-area" id="dv-workspace-area">
        <div className="dv-sub-nav">
          {(['dv-explorer', 'dv-query', 'dv-fetchxml', 'dv-relationships'] as DataverseSubTab[]).map((tabName) => (
            <button
              key={tabName}
              className={`sub-tab ${dataverse.dvSubTab === tabName ? 'active' : ''}`}
              data-dvtab={tabName}
              onClick={() => setDataverse((current) => ({ ...current, dvSubTab: tabName }))}
            >
              {tabName === 'dv-explorer' ? 'Explorer' : tabName === 'dv-query' ? 'Query' : tabName === 'dv-fetchxml' ? 'FetchXML' : 'Relationships'}
            </button>
          ))}
        </div>

        <div className={`dv-subpanel ${dataverse.dvSubTab === 'dv-explorer' ? 'active' : ''}`} id="dv-subpanel-dv-explorer">
          <div className="panel" id="entity-detail-panel">
            {!dataverse.currentEntityDetail ? (
              <div id="entity-detail-empty">
                <EmptyState icon={<Icon name="circle-dashed" size={18} />} title="Entity Detail" description="Select an entity from the list to inspect its metadata and preview records." />
              </div>
            ) : (
              <div id="entity-detail">
                <div className="sub-tabs">
                  <button
                    className={`sub-tab ${dataverse.explorerSubTab === 'metadata' ? 'active' : ''}`}
                    data-subtab="metadata"
                    onClick={() => setDataverse((current) => ({ ...current, explorerSubTab: 'metadata' }))}
                  >
                    Metadata
                  </button>
                  <button
                    className={`sub-tab ${dataverse.explorerSubTab === 'records' ? 'active' : ''}`}
                    data-subtab="records"
                    onClick={() => setDataverse((current) => ({ ...current, explorerSubTab: 'records' }))}
                  >
                    Records
                  </button>
                </div>

                <div className={`sub-panel ${dataverse.explorerSubTab === 'metadata' ? 'active' : ''}`} id="subpanel-metadata">
                  <h2 id="entity-title">{dataverse.currentEntityDetail.displayName || dataverse.currentEntityDetail.logicalName}</h2>
                  <p className="desc" id="entity-subtitle">
                    {dataverse.currentEntityDetail.description || dataverse.currentEntityDetail.logicalName}
                  </p>
                  <div id="entity-metrics" className="metrics">
                    {[
                      ['Logical Name', dataverse.currentEntityDetail.logicalName],
                      ['Entity Set', dataverse.currentEntityDetail.entitySetName],
                      ['Primary ID', dataverse.currentEntityDetail.primaryIdAttribute],
                      ['Primary Name', dataverse.currentEntityDetail.primaryNameAttribute],
                      ['Ownership', dataverse.currentEntityDetail.ownershipType],
                      ['Attributes', (dataverse.currentEntityDetail.attributes || []).length],
                      ['Custom', dataverse.currentEntityDetail.isCustomEntity],
                      ['Change Tracking', dataverse.currentEntityDetail.changeTrackingEnabled]
                    ].map(([label, value]) => (
                      <div key={String(label)} className="metric">
                        <div className="metric-label">{label}</div>
                        <div className="metric-value copy-inline">
                          <span className="copy-inline-value">{String(value ?? '-')}</span>
                          <CopyButton value={value ?? ''} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-group" style={{ marginBottom: 12 }}>
                    <button className="btn btn-primary btn-sm" id="entity-to-query" type="button" onClick={() => setDataverse((current) => ({ ...current, dvSubTab: 'dv-query' }))}>
                      Use in Query
                    </button>
                    <button className="btn btn-primary btn-sm" id="entity-to-fetchxml" type="button" onClick={() => setDataverse((current) => ({ ...current, dvSubTab: 'dv-fetchxml' }))}>
                      Use in FetchXML
                    </button>
                  </div>
                  <div className="selected-cols" id="selected-cols">
                    <span className="selected-cols-label">Selected:</span>
                    {dataverse.selectedColumns.length ? (
                      dataverse.selectedColumns.map((column: string) => (
                        <span
                          key={column}
                          className="col-chip"
                          data-remove-col={column}
                          onClick={() => setDataverse((current) => ({ ...current, selectedColumns: current.selectedColumns.filter((item) => item !== column) }))}
                        >
                          {column} <span className="x">×</span>
                        </span>
                      ))
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Click attributes below to select columns</span>
                    )}
                    {dataverse.selectedColumns.length ? (
                      <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.6875rem' }} onClick={() => setDataverse((current) => ({ ...current, selectedColumns: [] }))}>
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    id="attr-filter"
                    className="attr-filter"
                    placeholder="Filter attributes…"
                    value={dataverse.attrFilter}
                    onChange={(event) => setDataverse((current) => ({ ...current, attrFilter: event.target.value }))}
                  />
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Column</th>
                          <th>Type</th>
                          <th>Flags</th>
                        </tr>
                      </thead>
                      <tbody id="attribute-table">
                        {filteredAttributes.map((attribute: DataverseAttribute) => {
                          const selected = dataverse.selectedColumns.includes(attribute.logicalName);
                          const flags = [
                            attribute.isPrimaryId ? 'PK' : '',
                            attribute.isPrimaryName ? 'name' : '',
                            attribute.isValidForRead ? 'R' : '',
                            attribute.isValidForCreate ? 'C' : '',
                            attribute.isValidForUpdate ? 'U' : ''
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <tr
                              key={attribute.logicalName}
                              className={`attr-row ${selected ? 'selected' : ''}`}
                              data-col={attribute.logicalName}
                              onClick={() =>
                                setDataverse((current) => ({
                                  ...current,
                                  selectedColumns: current.selectedColumns.includes(attribute.logicalName)
                                    ? current.selectedColumns.filter((item: string) => item !== attribute.logicalName)
                                    : [...current.selectedColumns, attribute.logicalName]
                                }))
                              }
                            >
                              <td style={{ width: 24, textAlign: 'center' }}>{selected ? '✓' : ''}</td>
                              <td>
                                <strong>{attribute.displayName || attribute.logicalName}</strong>
                                <br />
                                <code>{attribute.logicalName}</code>
                              </td>
                              <td>
                                <code>{attribute.attributeTypeName || attribute.attributeType || ''}</code>
                              </td>
                              <td>
                                <code>{flags}</code>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`sub-panel ${dataverse.explorerSubTab === 'records' ? 'active' : ''}`} id="subpanel-records">
                  <div className="toolbar-row">
                    <h2>Record Preview</h2>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowCreateRecord(true)}>
                        Add Record
                      </button>
                      <button className="btn btn-secondary" id="entity-refresh-records" type="button" onClick={() => void loadRecordPreview()}>
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 8 }} className="copy-inline">
                    <span className="copy-inline-value">{dataverse.recordPreview?.path || ''}</span>
                    {dataverse.recordPreview?.path ? <CopyButton value={dataverse.recordPreview.path} label="copy" title="Copy record preview path" toast={toast} /> : null}
                  </div>
                  <ResultView
                    result={dataverse.recordPreview}
                    entityLogicalName={dataverse.currentEntityDetail?.logicalName}
                    entitySetName={dataverse.currentEntityDetail?.entitySetName}
                    primaryIdAttribute={dataverse.currentEntityDetail?.primaryIdAttribute}
                    environment={environment}
                    environmentUrl={environmentUrl}
                    entityMap={entityMap}
                    highlightedRecordId={createdRecordId ?? undefined}
                    placeholder="Select an entity to preview records."
                    toast={toast}
                  />
                  {showCreateRecord && dataverse.currentEntityDetail && (
                    <CreateRecordModal
                      entityDetail={dataverse.currentEntityDetail}
                      environment={environment}
                      entityMap={entityMap}
                      metadataWarnings={(dataverse.currentEntityDiagnostics || [])
                        .filter((diagnostic: DiagnosticItem) => diagnostic?.level === 'warning')
                        .map((diagnostic: DiagnosticItem) => diagnostic.message || diagnostic.code || 'Some field metadata could not be loaded.')}
                      onClose={() => setShowCreateRecord(false)}
                      onCreated={(created) => {
                        const entityDetail = dataverse.currentEntityDetail;
                        setShowCreateRecord(false);
                        const id = created?.id || created?.record?.[entityDetail?.primaryIdAttribute || ''];
                        setCreatedRecordId(typeof id === 'string' ? id : null);
                        void loadRecordPreview();
                        if (typeof id === 'string' && entityDetail?.entitySetName) {
                          detail.open(entityDetail.logicalName, entityDetail.entitySetName, id);
                        }
                      }}
                      toast={toast}
                    />
                  )}
                  {detail.target && environment && (
                    <RecordDetailModal initial={detail.target} environment={environment} environmentUrl={environmentUrl} entityMap={entityMap} onClose={detail.close} toast={toast} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={`dv-subpanel ${dataverse.dvSubTab === 'dv-query' ? 'active' : ''}`} id="dv-subpanel-dv-query">
          <div className="panel">
            <h2>Web API Query</h2>
            <div className="entity-context" id="query-entity-context">
              {dataverse.currentEntityDetail ? (
                <>
                  <span className="entity-context-name">{dataverse.currentEntityDetail.displayName || dataverse.currentEntityDetail.logicalName}</span>
                  {dataverse.currentEntityDetail.entitySetName ? <span className="entity-context-set">{dataverse.currentEntityDetail.entitySetName}</span> : null}
                </>
              ) : (
                <span className="entity-context-empty">No entity selected — pick one in Explorer or type an entity set below</span>
              )}
            </div>
            <form id="query-form" onSubmit={(event) => void runQuery(event, false)}>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Entity Set</span>
                  <input
                    name="entitySetName"
                    id="query-entity-set"
                    placeholder="accounts"
                    value={queryForm.entitySetName}
                    onChange={(event) => setQueryForm((current) => ({ ...current, entitySetName: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Top</span>
                  <input name="top" type="number" min="1" step="1" value={queryForm.top} onChange={(event) => setQueryForm((current) => ({ ...current, top: event.target.value }))} />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Select Columns (CSV)</span>
                <input
                  name="selectCsv"
                  id="query-select"
                  placeholder="accountid,name,accountnumber"
                  value={queryForm.selectCsv}
                  onChange={(event) => setQueryForm((current) => ({ ...current, selectCsv: event.target.value }))}
                />
              </div>
              <div className="field">
                <span className="field-label">Filter</span>
                <input
                  name="filter"
                  id="query-filter"
                  placeholder="contains(name,'Contoso')"
                  value={queryForm.filter}
                  onChange={(event) => setQueryForm((current) => ({ ...current, filter: event.target.value }))}
                />
              </div>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Order By (CSV)</span>
                  <input
                    name="orderByCsv"
                    id="query-order"
                    placeholder="name asc,createdon desc"
                    value={queryForm.orderByCsv}
                    onChange={(event) => setQueryForm((current) => ({ ...current, orderByCsv: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Expand (CSV)</span>
                  <input
                    name="expandCsv"
                    id="query-expand"
                    placeholder="primarycontactid($select=fullname)"
                    value={queryForm.expandCsv}
                    onChange={(event) => setQueryForm((current) => ({ ...current, expandCsv: event.target.value }))}
                  />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Raw Path Override</span>
                <input
                  name="rawPath"
                  id="query-raw-path"
                  placeholder="/api/data/v9.2/accounts?$select=name"
                  value={queryForm.rawPath}
                  onChange={(event) => setQueryForm((current) => ({ ...current, rawPath: event.target.value }))}
                />
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  name="includeCount"
                  id="query-count"
                  checked={queryForm.includeCount}
                  onChange={(event) => setQueryForm((current) => ({ ...current, includeCount: event.target.checked }))}
                />
                <label htmlFor="query-count">Include count</label>
              </div>
              <div className="btn-group">
                <button className="btn btn-secondary" id="query-preview-btn" type="button" onClick={(event) => void runQuery(event, true)}>
                  Preview Path
                </button>
                <button className="btn btn-primary" id="query-run-btn" type="submit">
                  Run Query
                </button>
              </div>
            </form>
          </div>
          <div className="panel">
            <div className="toolbar-row tight">
              <h2>Generated Path</h2>
              <CopyButton value={dataverse.queryPreview} label="Copy path" title="Copy generated Dataverse path" toast={toast} />
            </div>
            <pre className="viewer" id="query-preview">
              {dataverse.queryPreview}
            </pre>
          </div>
          <div className="panel">
            <h2>Query Result</h2>
            <ResultView
              result={dataverse.queryResult}
              entityLogicalName={dataverse.queryResult?.logicalName}
              entitySetName={dataverse.queryResult?.entitySetName}
              primaryIdAttribute={dataverse.currentEntityDetail?.primaryIdAttribute}
              environment={environment}
              environmentUrl={environmentUrl}
              entityMap={entityMap}
              placeholder="Run a query to see the response."
              toast={toast}
            />
          </div>
        </div>

        <div
          id="dv-subpanel-dv-fetchxml"
          className={`dv-subpanel ${dataverse.dvSubTab === 'dv-fetchxml' ? 'active' : ''}`}
          style={{ display: dataverse.dvSubTab === 'dv-fetchxml' ? undefined : 'none' }}
        >
          <FetchXmlTab dataverse={dataverse} environment={environment} environmentUrl={environmentUrl} toast={toast} />
        </div>
        <div
          id="dv-subpanel-dv-relationships"
          className={`dv-subpanel ${dataverse.dvSubTab === 'dv-relationships' ? 'active' : ''}`}
          style={{ display: dataverse.dvSubTab === 'dv-relationships' ? undefined : 'none' }}
        >
          <RelationshipsTab dataverse={dataverse} environment={environment} loadEntityDetail={loadEntityDetail} toast={toast} />
        </div>
      </div>
    </>
  );
}
function orderByDefault(detail: DataverseEntityDetail) {
  const cols = getDefaultSelectedColumns(detail, 0);
  const orderColumn = cols.find((name) => name !== detail?.primaryIdAttribute) || cols[0] || '';
  return orderColumn ? `${orderColumn} asc` : '';
}
