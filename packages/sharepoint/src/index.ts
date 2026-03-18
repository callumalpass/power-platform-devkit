import { createTokenProvider, type AuthProfile, type PublicClientLoginOptions } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0/';
const GRAPH_RESOURCE = 'https://graph.microsoft.com';

interface GraphCollectionResponse<T> {
  value?: T[];
}

export interface SharePointClientOptions extends ConfigStoreOptions {
  resource?: string;
  publicClientLoginOptions?: PublicClientLoginOptions;
}

export interface SharePointResolution {
  environment: EnvironmentAlias;
  authProfile: AuthProfile;
  authResource: string;
  client: HttpClient;
}

export interface SharePointSiteSummary extends Record<string, unknown> {
  id: string;
  name?: string;
  displayName?: string;
  webUrl?: string;
}

export interface SharePointListSummary extends Record<string, unknown> {
  id: string;
  name?: string;
  displayName?: string;
  webUrl?: string;
}

export interface SharePointDriveSummary extends Record<string, unknown> {
  id: string;
  name?: string;
  webUrl?: string;
  driveType?: string;
}

export interface SharePointDriveItemSummary extends Record<string, unknown> {
  id: string;
  name?: string;
  webUrl?: string;
}

export interface SharePointPermissionSummary extends Record<string, unknown> {
  id: string;
}

export interface SharePointListSitesOptions {
  search?: string;
  top?: number;
}

export interface SharePointListListsOptions {
  top?: number;
}

export interface SharePointListItemsOptions {
  top?: number;
}

export interface SharePointListFilesOptions {
  drive?: string;
  path?: string;
  top?: number;
}

export interface SharePointInspectFileOptions {
  drive?: string;
}

export interface SharePointListPermissionsOptions {
  list?: string;
  file?: string;
  drive?: string;
}

export class SharePointService {
  constructor(private readonly options: SharePointClientOptions = {}) {}

  async listSites(environmentAlias: string, options: SharePointListSitesOptions = {}): Promise<OperationResult<SharePointSiteSummary[]>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointSiteSummary[]>;
    }

    return requestCollection<SharePointSiteSummary>(resolution.data.client, '/sites', {
      search: options.search ?? '*',
      ...(options.top !== undefined ? { $top: options.top } : {}),
    });
  }

  async inspectSite(environmentAlias: string, identifier: string): Promise<OperationResult<SharePointSiteSummary>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointSiteSummary>;
    }

    return resolution.data.client.requestJson<SharePointSiteSummary>({
      method: 'GET',
      path: resolveSitePath(identifier),
    });
  }

  async listLists(environmentAlias: string, siteIdentifier: string, options: SharePointListListsOptions = {}): Promise<OperationResult<SharePointListSummary[]>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointListSummary[]>;
    }

    const site = await resolveSite(resolution.data.client, siteIdentifier);

    if (!site.success || !site.data) {
      return site as unknown as OperationResult<SharePointListSummary[]>;
    }

    return requestCollection<SharePointListSummary>(resolution.data.client, `/sites/${encodeURIComponent(site.data.id)}/lists`, {
      ...(options.top !== undefined ? { $top: options.top } : {}),
    });
  }

  async listItems(
    environmentAlias: string,
    siteIdentifier: string,
    listIdentifier: string,
    options: SharePointListItemsOptions = {}
  ): Promise<OperationResult<Record<string, unknown>[]>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<Record<string, unknown>[]>;
    }

    const site = await resolveSite(resolution.data.client, siteIdentifier);

    if (!site.success || !site.data) {
      return site as unknown as OperationResult<Record<string, unknown>[]>;
    }

    const list = await resolveList(resolution.data.client, site.data.id, listIdentifier);

    if (!list.success || !list.data) {
      return list as unknown as OperationResult<Record<string, unknown>[]>;
    }

    return requestCollection<Record<string, unknown>>(
      resolution.data.client,
      `/sites/${encodeURIComponent(site.data.id)}/lists/${encodeURIComponent(list.data.id)}/items`,
      {
        ...(options.top !== undefined ? { $top: options.top } : {}),
        $expand: 'fields',
      }
    );
  }

  async listFiles(
    environmentAlias: string,
    siteIdentifier: string,
    options: SharePointListFilesOptions = {}
  ): Promise<OperationResult<SharePointDriveItemSummary[]>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointDriveItemSummary[]>;
    }

    const site = await resolveSite(resolution.data.client, siteIdentifier);

    if (!site.success || !site.data) {
      return site as unknown as OperationResult<SharePointDriveItemSummary[]>;
    }

    const drive = await resolveDrive(resolution.data.client, site.data.id, options.drive);

    if (!drive.success || !drive.data) {
      return drive as unknown as OperationResult<SharePointDriveItemSummary[]>;
    }

    const path = options.path
      ? `/drives/${encodeURIComponent(drive.data.id)}/root:${normalizeDrivePath(options.path)}:/children`
      : `/drives/${encodeURIComponent(drive.data.id)}/root/children`;

    return requestCollection<SharePointDriveItemSummary>(resolution.data.client, path, {
      ...(options.top !== undefined ? { $top: options.top } : {}),
    });
  }

  async inspectFile(
    environmentAlias: string,
    siteIdentifier: string,
    identifier: string,
    options: SharePointInspectFileOptions = {}
  ): Promise<OperationResult<SharePointDriveItemSummary>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointDriveItemSummary>;
    }

    const site = await resolveSite(resolution.data.client, siteIdentifier);

    if (!site.success || !site.data) {
      return site as unknown as OperationResult<SharePointDriveItemSummary>;
    }

    const drive = await resolveDrive(resolution.data.client, site.data.id, options.drive);

    if (!drive.success || !drive.data) {
      return drive as unknown as OperationResult<SharePointDriveItemSummary>;
    }

    return resolution.data.client.requestJson<SharePointDriveItemSummary>({
      method: 'GET',
      path: buildDriveItemPath(drive.data.id, identifier),
    });
  }

  async listPermissions(
    environmentAlias: string,
    siteIdentifier: string,
    options: SharePointListPermissionsOptions = {}
  ): Promise<OperationResult<SharePointPermissionSummary[]>> {
    const resolution = await resolveSharePointClient(environmentAlias, this.options);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SharePointPermissionSummary[]>;
    }

    const site = await resolveSite(resolution.data.client, siteIdentifier);

    if (!site.success || !site.data) {
      return site as unknown as OperationResult<SharePointPermissionSummary[]>;
    }

    if (options.file) {
      const drive = await resolveDrive(resolution.data.client, site.data.id, options.drive);

      if (!drive.success || !drive.data) {
        return drive as unknown as OperationResult<SharePointPermissionSummary[]>;
      }

      const item = await resolveDriveItem(resolution.data.client, drive.data.id, options.file);

      if (!item.success || !item.data) {
        return item as unknown as OperationResult<SharePointPermissionSummary[]>;
      }

      return requestCollection<SharePointPermissionSummary>(
        resolution.data.client,
        `/drives/${encodeURIComponent(drive.data.id)}/items/${encodeURIComponent(item.data.id)}/permissions`
      );
    }

    if (options.list) {
      const list = await resolveList(resolution.data.client, site.data.id, options.list);

      if (!list.success || !list.data) {
        return list as unknown as OperationResult<SharePointPermissionSummary[]>;
      }

      return requestCollection<SharePointPermissionSummary>(
        resolution.data.client,
        `/sites/${encodeURIComponent(site.data.id)}/lists/${encodeURIComponent(list.data.id)}/permissions`
      );
    }

    return requestCollection<SharePointPermissionSummary>(
      resolution.data.client,
      `/sites/${encodeURIComponent(site.data.id)}/permissions`
    );
  }
}

export async function resolveSharePointClient(
  environmentAlias: string,
  options: SharePointClientOptions = {}
): Promise<OperationResult<SharePointResolution>> {
  const environment = await getEnvironmentAlias(environmentAlias, options);

  if (!environment.success) {
    return environment as unknown as OperationResult<SharePointResolution>;
  }

  if (!environment.data) {
    return fail(
      createDiagnostic('error', 'SHAREPOINT_ENVIRONMENT_NOT_FOUND', `Environment alias ${environmentAlias} was not found.`, {
        source: '@pp/sharepoint',
        hint: `Create it with \`pp env add ${environmentAlias} --url <dataverse-url> --profile <profile>\` or pass an existing alias with \`--environment\`.`,
      })
    );
  }

  const authProfile = await getAuthProfile(environment.data.authProfile, options);

  if (!authProfile.success) {
    return authProfile as unknown as OperationResult<SharePointResolution>;
  }

  if (!authProfile.data) {
    return fail(
      createDiagnostic(
        'error',
        'SHAREPOINT_AUTH_PROFILE_NOT_FOUND',
        `Auth profile ${environment.data.authProfile} referenced by environment ${environmentAlias} was not found.`,
        {
          source: '@pp/sharepoint',
          hint: `Inspect the alias with \`pp env inspect ${environmentAlias}\` or recreate the missing profile with \`pp auth profile add-user --name ${environment.data.authProfile}\`.`,
        }
      )
    );
  }

  const authResource = resolveGraphResource(options.resource, authProfile.data.defaultResource);

  if (!authResource.success || !authResource.data) {
    return authResource as unknown as OperationResult<SharePointResolution>;
  }

  const tokenProvider = createTokenProvider(authProfile.data, options, options.publicClientLoginOptions);

  if (!tokenProvider.success || !tokenProvider.data) {
    return tokenProvider as unknown as OperationResult<SharePointResolution>;
  }

  return ok(
    {
      environment: environment.data,
      authProfile: authProfile.data,
      authResource: authResource.data,
      client: new HttpClient({
        baseUrl: GRAPH_BASE_URL,
        tokenProvider: tokenProvider.data,
        authResource: authResource.data,
      }),
    },
    {
      supportTier: 'preview',
      diagnostics: [...environment.diagnostics, ...authProfile.diagnostics],
      warnings: [...environment.warnings, ...authProfile.warnings],
    }
  );
}

async function requestCollection<T>(
  client: HttpClient,
  path: string,
  query?: Record<string, string | number | boolean>
): Promise<OperationResult<T[]>> {
  const response = await client.requestJson<GraphCollectionResponse<T>>({
    method: 'GET',
    path,
    query,
  });

  if (!response.success) {
    return response as unknown as OperationResult<T[]>;
  }

  return ok(response.data?.value ?? [], {
    supportTier: response.supportTier,
    diagnostics: response.diagnostics,
    warnings: response.warnings,
    suggestedNextActions: response.suggestedNextActions,
    provenance: response.provenance,
    knownLimitations: response.knownLimitations,
  });
}

async function resolveSite(client: HttpClient, identifier: string): Promise<OperationResult<SharePointSiteSummary>> {
  return client.requestJson<SharePointSiteSummary>({
    method: 'GET',
    path: resolveSitePath(identifier),
  });
}

async function resolveList(client: HttpClient, siteId: string, identifier: string): Promise<OperationResult<SharePointListSummary>> {
  if (looksLikeOpaqueId(identifier)) {
    return client.requestJson<SharePointListSummary>({
      method: 'GET',
      path: `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(identifier)}`,
    });
  }

  const lists = await requestCollection<SharePointListSummary>(client, `/sites/${encodeURIComponent(siteId)}/lists`);

  if (!lists.success) {
    return lists as unknown as OperationResult<SharePointListSummary>;
  }

  const matched = (lists.data ?? []).find(
    (entry) =>
      entry.id === identifier ||
      entry.name?.toLowerCase() === identifier.toLowerCase() ||
      entry.displayName?.toLowerCase() === identifier.toLowerCase()
  );

  if (!matched) {
    return fail(
      createDiagnostic('error', 'SHAREPOINT_LIST_NOT_FOUND', `SharePoint list ${identifier} was not found in site ${siteId}.`, {
        source: '@pp/sharepoint',
        hint: `Run \`pp sharepoint list list --environment <alias> --site ${JSON.stringify(siteId)}\` to inspect available lists.`,
      })
    );
  }

  return ok(matched, { supportTier: 'preview', diagnostics: lists.diagnostics, warnings: lists.warnings });
}

async function resolveDrive(client: HttpClient, siteId: string, identifier?: string): Promise<OperationResult<SharePointDriveSummary>> {
  if (!identifier) {
    return client.requestJson<SharePointDriveSummary>({
      method: 'GET',
      path: `/sites/${encodeURIComponent(siteId)}/drive`,
    });
  }

  if (looksLikeOpaqueId(identifier)) {
    return client.requestJson<SharePointDriveSummary>({
      method: 'GET',
      path: `/drives/${encodeURIComponent(identifier)}`,
    });
  }

  const drives = await requestCollection<SharePointDriveSummary>(client, `/sites/${encodeURIComponent(siteId)}/drives`);

  if (!drives.success) {
    return drives as unknown as OperationResult<SharePointDriveSummary>;
  }

  const matched = (drives.data ?? []).find(
    (entry) => entry.id === identifier || entry.name?.toLowerCase() === identifier.toLowerCase()
  );

  if (!matched) {
    return fail(
      createDiagnostic('error', 'SHAREPOINT_DRIVE_NOT_FOUND', `Drive ${identifier} was not found in site ${siteId}.`, {
        source: '@pp/sharepoint',
        hint: `Run \`pp sharepoint file list --environment <alias> --site ${JSON.stringify(siteId)}\` to inspect the default drive, or provide a valid drive id/name with \`--drive\`.`,
      })
    );
  }

  return ok(matched, { supportTier: 'preview', diagnostics: drives.diagnostics, warnings: drives.warnings });
}

async function resolveDriveItem(client: HttpClient, driveId: string, identifier: string): Promise<OperationResult<SharePointDriveItemSummary>> {
  return client.requestJson<SharePointDriveItemSummary>({
    method: 'GET',
    path: buildDriveItemPath(driveId, identifier),
  });
}

function buildDriveItemPath(driveId: string, identifier: string): string {
  if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
    try {
      const parsed = new URL(identifier);
      return `/drives/${encodeURIComponent(driveId)}/root:${normalizeDrivePath(parsed.pathname)}`;
    } catch {
      return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(identifier)}`;
    }
  }

  if (identifier.startsWith('/')) {
    return `/drives/${encodeURIComponent(driveId)}/root:${normalizeDrivePath(identifier)}`;
  }

  return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(identifier)}`;
}

function resolveSitePath(identifier: string): string {
  if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
    const parsed = new URL(identifier);
    const sitePath = parsed.pathname === '/' ? '' : parsed.pathname;
    return `/sites/${parsed.hostname}:${sitePath}`;
  }

  if (identifier.includes(':/')) {
    return `/sites/${identifier}`;
  }

  return `/sites/${encodeURIComponent(identifier)}`;
}

function normalizeDrivePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }

  return path;
}

function looksLikeOpaqueId(value: string): boolean {
  return value.includes(',') || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveGraphResource(explicitResource: string | undefined, defaultResource: string | undefined): OperationResult<string> {
  const requested = normalizeResource(explicitResource ?? defaultResource ?? GRAPH_RESOURCE);

  if (isGraphResource(requested)) {
    return ok(requested, { supportTier: 'preview' });
  }

  return fail(
    createDiagnostic(
      'error',
      'SHAREPOINT_RESOURCE_MISMATCH',
      `SharePoint commands currently use Microsoft Graph, but the resolved auth resource is ${requested}.`,
      {
        source: '@pp/sharepoint',
        hint: 'Pass `--resource https://graph.microsoft.com` or update the auth profile defaultResource to Microsoft Graph before using `pp sharepoint`.',
      }
    )
  );
}

function normalizeResource(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isGraphResource(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === GRAPH_RESOURCE;
  } catch {
    return value === GRAPH_RESOURCE;
  }
}
