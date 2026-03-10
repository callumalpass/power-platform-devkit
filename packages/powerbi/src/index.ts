import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';

export interface PowerBiWorkspace {
  id: string;
  name: string;
  isReadOnly?: boolean;
  isOnDedicatedCapacity?: boolean;
  capacityId?: string;
  datasets?: Array<{
    id: string;
    name: string;
  }>;
  reports?: Array<{
    id: string;
    name: string;
    datasetId?: string;
    webUrl?: string;
  }>;
}

export interface PowerBiDataset {
  id: string;
  name: string;
  workspaceId: string;
  configuredBy?: string;
  addRowsApiEnabled?: boolean;
  isRefreshable?: boolean;
  isEffectiveIdentityRequired?: boolean;
  isOnPremGatewayRequired?: boolean;
  targetStorageMode?: string;
  datasources: Array<{
    datasourceType?: string;
    connectionDetails?: Record<string, string>;
    gatewayId?: string;
    datasourceId?: string;
  }>;
  refreshSchedule?: {
    enabled?: boolean;
    timezone?: string;
    times?: string[];
    days?: string[];
  };
}

export interface PowerBiReport {
  id: string;
  name: string;
  workspaceId: string;
  datasetId?: string;
  webUrl?: string;
  embedUrl?: string;
}

interface PowerBiCollection<T> {
  value: T[];
}

interface PowerBiWorkspaceResponse {
  id: string;
  name: string;
  isReadOnly?: boolean;
  isOnDedicatedCapacity?: boolean;
  capacityId?: string;
}

interface PowerBiDatasetResponse {
  id: string;
  name: string;
  configuredBy?: string;
  addRowsAPIEnabled?: boolean;
  isRefreshable?: boolean;
  isEffectiveIdentityRequired?: boolean;
  isOnPremGatewayRequired?: boolean;
  targetStorageMode?: string;
}

interface PowerBiReportResponse {
  id: string;
  name: string;
  datasetId?: string;
  webUrl?: string;
  embedUrl?: string;
}

interface PowerBiDatasourceResponse {
  datasourceType?: string;
  connectionDetails?: Record<string, string>;
  gatewayId?: string;
  datasourceId?: string;
}

interface PowerBiRefreshScheduleResponse {
  enabled?: boolean;
  timezone?: string;
  times?: string[];
  days?: string[];
}

export class PowerBiClient {
  constructor(private readonly httpClient: HttpClient) {}

  async listWorkspaces(): Promise<OperationResult<{ value: PowerBiWorkspace[] }>> {
    const response = await this.httpClient.requestJson<PowerBiCollection<PowerBiWorkspaceResponse>>({
      path: '/v1.0/myorg/groups',
    });

    if (!response.success || !response.data) {
      return response as unknown as OperationResult<{ value: PowerBiWorkspace[] }>;
    }

    return ok(
      {
        value: response.data.value.map((workspace) => normalizeWorkspace(workspace)),
      },
      {
        supportTier: response.supportTier,
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
  }

  async inspectWorkspace(reference: string): Promise<OperationResult<PowerBiWorkspace>> {
    const workspaceResult = isGuid(reference)
      ? await this.httpClient.requestJson<PowerBiWorkspaceResponse>({
          path: `/v1.0/myorg/groups/${encodeURIComponent(reference)}`,
        })
      : await this.matchNamedWorkspace(reference);

    if (!workspaceResult.success || !workspaceResult.data) {
      return workspaceResult as unknown as OperationResult<PowerBiWorkspace>;
    }

    const [datasetsResult, reportsResult] = await Promise.all([
      this.httpClient.requestJson<PowerBiCollection<PowerBiDatasetResponse>>({
        path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/datasets`,
      }),
      this.httpClient.requestJson<PowerBiCollection<PowerBiReportResponse>>({
        path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/reports`,
      }),
    ]);

    if (!datasetsResult.success || !datasetsResult.data) {
      return datasetsResult as unknown as OperationResult<PowerBiWorkspace>;
    }

    if (!reportsResult.success || !reportsResult.data) {
      return reportsResult as unknown as OperationResult<PowerBiWorkspace>;
    }

    return ok(
      normalizeWorkspace(workspaceResult.data, {
        datasets: datasetsResult.data.value,
        reports: reportsResult.data.value,
      }),
      {
        supportTier: workspaceResult.supportTier,
        diagnostics: [
          ...workspaceResult.diagnostics,
          ...datasetsResult.diagnostics,
          ...reportsResult.diagnostics,
        ],
        warnings: [...(workspaceResult.warnings ?? []), ...(datasetsResult.warnings ?? []), ...(reportsResult.warnings ?? [])],
      }
    );
  }

  async inspectDataset(workspaceReference: string, datasetReference: string): Promise<OperationResult<PowerBiDataset>> {
    const workspaceResult = await this.inspectWorkspace(workspaceReference);

    if (!workspaceResult.success || !workspaceResult.data) {
      return workspaceResult as unknown as OperationResult<PowerBiDataset>;
    }

    const datasetResult = isGuid(datasetReference)
      ? await this.httpClient.requestJson<PowerBiDatasetResponse>({
          path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/datasets/${encodeURIComponent(datasetReference)}`,
        })
      : await this.matchNamedDataset(workspaceResult.data.id, datasetReference);

    if (!datasetResult.success || !datasetResult.data) {
      return datasetResult as unknown as OperationResult<PowerBiDataset>;
    }

    const [datasourcesResult, refreshScheduleResult] = await Promise.all([
      this.httpClient.requestJson<PowerBiCollection<PowerBiDatasourceResponse>>({
        path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/datasets/${encodeURIComponent(datasetResult.data.id)}/datasources`,
      }),
      this.httpClient.requestJson<PowerBiRefreshScheduleResponse>({
        path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/datasets/${encodeURIComponent(datasetResult.data.id)}/refreshSchedule`,
      }),
    ]);

    if (!datasourcesResult.success || !datasourcesResult.data) {
      return datasourcesResult as unknown as OperationResult<PowerBiDataset>;
    }

    if (!refreshScheduleResult.success || !refreshScheduleResult.data) {
      return refreshScheduleResult as unknown as OperationResult<PowerBiDataset>;
    }

    return ok(normalizeDataset(workspaceResult.data.id, datasetResult.data, datasourcesResult.data.value, refreshScheduleResult.data), {
      supportTier: datasetResult.supportTier,
      diagnostics: [
        ...workspaceResult.diagnostics,
        ...datasetResult.diagnostics,
        ...datasourcesResult.diagnostics,
        ...refreshScheduleResult.diagnostics,
      ],
      warnings: [
        ...(workspaceResult.warnings ?? []),
        ...(datasetResult.warnings ?? []),
        ...(datasourcesResult.warnings ?? []),
        ...(refreshScheduleResult.warnings ?? []),
      ],
    });
  }

  async inspectReport(workspaceReference: string, reportReference: string): Promise<OperationResult<PowerBiReport>> {
    const workspaceResult = await this.inspectWorkspace(workspaceReference);

    if (!workspaceResult.success || !workspaceResult.data) {
      return workspaceResult as unknown as OperationResult<PowerBiReport>;
    }

    const reportResult = isGuid(reportReference)
      ? await this.httpClient.requestJson<PowerBiReportResponse>({
          path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceResult.data.id)}/reports/${encodeURIComponent(reportReference)}`,
        })
      : await this.matchNamedReport(workspaceResult.data.id, reportReference);

    if (!reportResult.success || !reportResult.data) {
      return reportResult as unknown as OperationResult<PowerBiReport>;
    }

    return ok(normalizeReport(workspaceResult.data.id, reportResult.data), {
      supportTier: reportResult.supportTier,
      diagnostics: [...workspaceResult.diagnostics, ...reportResult.diagnostics],
      warnings: [...(workspaceResult.warnings ?? []), ...(reportResult.warnings ?? [])],
    });
  }

  private async matchNamedWorkspace(reference: string): Promise<OperationResult<PowerBiWorkspaceResponse>> {
    const listResult = await this.httpClient.requestJson<PowerBiCollection<PowerBiWorkspaceResponse>>({
      path: '/v1.0/myorg/groups',
    });

    if (!listResult.success || !listResult.data) {
      return listResult as unknown as OperationResult<PowerBiWorkspaceResponse>;
    }

    const match = listResult.data.value.find((workspace) => workspace.name === reference || workspace.id === reference);

    if (!match) {
      return fail(
        createDiagnostic('error', 'POWERBI_WORKSPACE_NOT_FOUND', `Power BI workspace ${reference} was not found.`, {
          source: '@pp/powerbi',
        })
      );
    }

    return ok(match, {
      supportTier: listResult.supportTier,
      diagnostics: listResult.diagnostics,
      warnings: listResult.warnings,
    });
  }

  private async matchNamedDataset(workspaceId: string, reference: string): Promise<OperationResult<PowerBiDatasetResponse>> {
    const listResult = await this.httpClient.requestJson<PowerBiCollection<PowerBiDatasetResponse>>({
      path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceId)}/datasets`,
    });

    if (!listResult.success || !listResult.data) {
      return listResult as unknown as OperationResult<PowerBiDatasetResponse>;
    }

    const match = listResult.data.value.find((dataset) => dataset.name === reference || dataset.id === reference);

    if (!match) {
      return fail(
        createDiagnostic('error', 'POWERBI_DATASET_NOT_FOUND', `Power BI dataset ${reference} was not found.`, {
          source: '@pp/powerbi',
        })
      );
    }

    return ok(match, {
      supportTier: listResult.supportTier,
      diagnostics: listResult.diagnostics,
      warnings: listResult.warnings,
    });
  }

  private async matchNamedReport(workspaceId: string, reference: string): Promise<OperationResult<PowerBiReportResponse>> {
    const listResult = await this.httpClient.requestJson<PowerBiCollection<PowerBiReportResponse>>({
      path: `/v1.0/myorg/groups/${encodeURIComponent(workspaceId)}/reports`,
    });

    if (!listResult.success || !listResult.data) {
      return listResult as unknown as OperationResult<PowerBiReportResponse>;
    }

    const match = listResult.data.value.find((report) => report.name === reference || report.id === reference);

    if (!match) {
      return fail(
        createDiagnostic('error', 'POWERBI_REPORT_NOT_FOUND', `Power BI report ${reference} was not found.`, {
          source: '@pp/powerbi',
        })
      );
    }

    return ok(match, {
      supportTier: listResult.supportTier,
      diagnostics: listResult.diagnostics,
      warnings: listResult.warnings,
    });
  }
}

function normalizeWorkspace(
  workspace: PowerBiWorkspaceResponse,
  related: {
    datasets?: PowerBiDatasetResponse[];
    reports?: PowerBiReportResponse[];
  } = {}
): PowerBiWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    isReadOnly: workspace.isReadOnly,
    isOnDedicatedCapacity: workspace.isOnDedicatedCapacity,
    capacityId: workspace.capacityId,
    datasets: related.datasets?.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
    })),
    reports: related.reports?.map((report) => ({
      id: report.id,
      name: report.name,
      datasetId: report.datasetId,
      webUrl: report.webUrl,
    })),
  };
}

function normalizeDataset(
  workspaceId: string,
  dataset: PowerBiDatasetResponse,
  datasources: PowerBiDatasourceResponse[],
  refreshSchedule: PowerBiRefreshScheduleResponse
): PowerBiDataset {
  return {
    id: dataset.id,
    name: dataset.name,
    workspaceId,
    configuredBy: dataset.configuredBy,
    addRowsApiEnabled: dataset.addRowsAPIEnabled,
    isRefreshable: dataset.isRefreshable,
    isEffectiveIdentityRequired: dataset.isEffectiveIdentityRequired,
    isOnPremGatewayRequired: dataset.isOnPremGatewayRequired,
    targetStorageMode: dataset.targetStorageMode,
    datasources: datasources.map((datasource) => ({
      datasourceType: datasource.datasourceType,
      connectionDetails: datasource.connectionDetails,
      gatewayId: datasource.gatewayId,
      datasourceId: datasource.datasourceId,
    })),
    refreshSchedule,
  };
}

function normalizeReport(workspaceId: string, report: PowerBiReportResponse): PowerBiReport {
  return {
    id: report.id,
    name: report.name,
    workspaceId,
    datasetId: report.datasetId,
    webUrl: report.webUrl,
    embedUrl: report.embedUrl,
  };
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
