import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';

export interface SharePointSiteReference {
  id: string;
  displayName: string;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

export interface SharePointListReference {
  id: string;
  name: string;
  displayName?: string;
  webUrl?: string;
  description?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  driveId?: string;
  columns: Array<{
    id: string;
    name: string;
    displayName?: string;
    columnGroup?: string;
    required?: boolean;
    hidden?: boolean;
    readOnly?: boolean;
  }>;
}

export interface SharePointDriveItemReference {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  driveId?: string;
  parentPath?: string;
  file?: {
    mimeType?: string;
    hashCount: number;
  };
  folder?: {
    childCount?: number;
  };
}

export interface SharePointPermissionReference {
  id: string;
  roles: string[];
  grantedTo: string[];
  inheritedFrom?: string;
  linkScope?: string;
  linkType?: string;
}

export interface SharePointFileMutationOptions {
  drive?: string;
  contentType?: string;
}

interface GraphCollectionResponse<T> {
  value: T[];
}

interface GraphSite {
  id: string;
  displayName: string;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

interface GraphColumn {
  id: string;
  name: string;
  displayName?: string;
  columnGroup?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
}

interface GraphList {
  id: string;
  name: string;
  displayName?: string;
  webUrl?: string;
  description?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  columns?: GraphColumn[];
  drive?: {
    id?: string;
  };
}

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  parentReference?: {
    driveId?: string;
    path?: string;
  };
  file?: {
    mimeType?: string;
    hashes?: Record<string, string>;
  };
  folder?: {
    childCount?: number;
  };
}

interface GraphPermissionIdentitySet {
  user?: {
    displayName?: string;
    email?: string;
  };
  group?: {
    displayName?: string;
    email?: string;
  };
  siteGroup?: {
    displayName?: string;
  };
}

interface GraphPermission {
  id: string;
  roles?: string[];
  inheritedFrom?: {
    path?: string;
  };
  link?: {
    scope?: string;
    type?: string;
  };
  grantedTo?: GraphPermissionIdentitySet;
  grantedToIdentitiesV2?: GraphPermissionIdentitySet[];
}

export class SharePointClient {
  constructor(private readonly httpClient: HttpClient) {}

  async inspectSite(reference: string): Promise<OperationResult<SharePointSiteReference>> {
    const siteResult = await this.httpClient.requestJson<GraphSite>({
      path: buildSitePath(reference),
    });

    if (!siteResult.success || !siteResult.data) {
      return siteResult as unknown as OperationResult<SharePointSiteReference>;
    }

    return ok(normalizeSite(siteResult.data), {
      supportTier: siteResult.supportTier,
      diagnostics: siteResult.diagnostics,
      warnings: siteResult.warnings,
    });
  }

  async inspectList(siteReference: string, listReference: string): Promise<OperationResult<SharePointListReference>> {
    const siteIdResult = await this.resolveSiteId(siteReference);

    if (!siteIdResult.success || !siteIdResult.data) {
      return siteIdResult as unknown as OperationResult<SharePointListReference>;
    }

    const listResult = isGuid(listReference)
      ? await this.httpClient.requestJson<GraphList>({
          path: `/v1.0/sites/${encodeURIComponent(siteIdResult.data)}/lists/${encodeURIComponent(listReference)}`,
          query: {
            $expand: 'columns,drive',
          },
        })
      : await this.matchNamedList(siteIdResult.data, listReference);

    if (!listResult.success || !listResult.data) {
      return listResult as unknown as OperationResult<SharePointListReference>;
    }

    return ok(normalizeList(listResult.data), {
      supportTier: listResult.supportTier,
      diagnostics: listResult.diagnostics,
      warnings: listResult.warnings,
    });
  }

  async inspectDriveItem(
    siteReference: string,
    itemReference: string,
    options: {
      drive?: string;
    } = {}
  ): Promise<OperationResult<SharePointDriveItemReference>> {
    const siteIdResult = await this.resolveSiteId(siteReference);

    if (!siteIdResult.success || !siteIdResult.data) {
      return siteIdResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    const driveIdResult = await this.resolveDriveId(siteIdResult.data, options.drive);

    if (!driveIdResult.success || !driveIdResult.data) {
      return driveIdResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    const driveItemResult = isLikelyPath(itemReference)
      ? await this.httpClient.requestJson<GraphDriveItem>({
          path: `/v1.0/drives/${encodeURIComponent(driveIdResult.data)}/root:${normalizeDrivePath(itemReference)}`,
        })
      : await this.httpClient.requestJson<GraphDriveItem>({
          path: `/v1.0/drives/${encodeURIComponent(driveIdResult.data)}/items/${encodeURIComponent(itemReference)}`,
        });

    if (!driveItemResult.success || !driveItemResult.data) {
      return driveItemResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    return ok(normalizeDriveItem(driveItemResult.data), {
      supportTier: driveItemResult.supportTier,
      diagnostics: driveItemResult.diagnostics,
      warnings: driveItemResult.warnings,
    });
  }

  async inspectPermissions(
    siteReference: string,
    options: {
      list?: string;
      drive?: string;
      item?: string;
    } = {}
  ): Promise<OperationResult<SharePointPermissionReference[]>> {
    const siteIdResult = await this.resolveSiteId(siteReference);

    if (!siteIdResult.success || !siteIdResult.data) {
      return siteIdResult as unknown as OperationResult<SharePointPermissionReference[]>;
    }

    let path = `/v1.0/sites/${encodeURIComponent(siteIdResult.data)}/permissions`;

    if (options.list) {
      const listResult = await this.inspectList(siteIdResult.data, options.list);

      if (!listResult.success || !listResult.data) {
        return listResult as unknown as OperationResult<SharePointPermissionReference[]>;
      }

      path = `/v1.0/sites/${encodeURIComponent(siteIdResult.data)}/lists/${encodeURIComponent(listResult.data.id)}/permissions`;
    } else if (options.item) {
      const itemResult = await this.inspectDriveItem(siteIdResult.data, options.item, {
        drive: options.drive,
      });

      if (!itemResult.success || !itemResult.data?.driveId) {
        return itemResult as unknown as OperationResult<SharePointPermissionReference[]>;
      }

      path = `/v1.0/drives/${encodeURIComponent(itemResult.data.driveId)}/items/${encodeURIComponent(itemResult.data.id)}/permissions`;
    }

    const permissionsResult = await this.httpClient.requestJson<GraphCollectionResponse<GraphPermission>>({
      path,
    });

    if (!permissionsResult.success || !permissionsResult.data) {
      return permissionsResult as unknown as OperationResult<SharePointPermissionReference[]>;
    }

    return ok(permissionsResult.data.value.map(normalizePermission), {
      supportTier: permissionsResult.supportTier,
      diagnostics: permissionsResult.diagnostics,
      warnings: permissionsResult.warnings,
    });
  }

  async setDriveItemText(
    siteReference: string,
    itemReference: string,
    content: string,
    options: SharePointFileMutationOptions = {}
  ): Promise<OperationResult<SharePointDriveItemReference>> {
    const siteIdResult = await this.resolveSiteId(siteReference);

    if (!siteIdResult.success || !siteIdResult.data) {
      return siteIdResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    const driveIdResult = await this.resolveDriveId(siteIdResult.data, options.drive);

    if (!driveIdResult.success || !driveIdResult.data) {
      return driveIdResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    const uploadResult = await this.httpClient.requestJson<GraphDriveItem>({
      method: 'PUT',
      path: isLikelyPath(itemReference)
        ? `/v1.0/drives/${encodeURIComponent(driveIdResult.data)}/root:${normalizeDrivePath(itemReference)}:/content`
        : `/v1.0/drives/${encodeURIComponent(driveIdResult.data)}/items/${encodeURIComponent(itemReference)}/content`,
      rawBody: content,
      headers: {
        'content-type': options.contentType ?? 'text/plain; charset=utf-8',
      },
    });

    if (!uploadResult.success || !uploadResult.data) {
      return uploadResult as unknown as OperationResult<SharePointDriveItemReference>;
    }

    return ok(normalizeDriveItem(uploadResult.data), {
      supportTier: uploadResult.supportTier,
      diagnostics: uploadResult.diagnostics,
      warnings: uploadResult.warnings,
    });
  }

  private async resolveSiteId(reference: string): Promise<OperationResult<string>> {
    if (!isUrl(reference)) {
      return ok(reference, {
        supportTier: 'preview',
      });
    }

    const siteResult = await this.inspectSite(reference);

    if (!siteResult.success || !siteResult.data?.id) {
      return siteResult as unknown as OperationResult<string>;
    }

    return ok(siteResult.data.id, {
      supportTier: siteResult.supportTier,
      diagnostics: siteResult.diagnostics,
      warnings: siteResult.warnings,
    });
  }

  private async matchNamedList(siteId: string, listName: string): Promise<OperationResult<GraphList>> {
    const listsResult = await this.httpClient.requestJson<GraphCollectionResponse<GraphList>>({
      path: `/v1.0/sites/${encodeURIComponent(siteId)}/lists`,
      query: {
        $expand: 'columns,drive',
      },
    });

    if (!listsResult.success || !listsResult.data) {
      return listsResult as unknown as OperationResult<GraphList>;
    }

    const match = listsResult.data.value.find(
      (candidate) => candidate.name === listName || candidate.displayName === listName || candidate.id === listName
    );

    if (!match) {
      return fail(
        createDiagnostic('error', 'SHAREPOINT_LIST_NOT_FOUND', `SharePoint list ${listName} was not found.`, {
          source: '@pp/sharepoint',
        })
      );
    }

    return ok(match, {
      supportTier: listsResult.supportTier,
      diagnostics: listsResult.diagnostics,
      warnings: listsResult.warnings,
    });
  }

  private async resolveDriveId(siteId: string, reference: string | undefined): Promise<OperationResult<string>> {
    if (!reference) {
      const defaultDrive = await this.httpClient.requestJson<{ id: string }>({
        path: `/v1.0/sites/${encodeURIComponent(siteId)}/drive`,
      });

      if (!defaultDrive.success || !defaultDrive.data?.id) {
        return defaultDrive as unknown as OperationResult<string>;
      }

      return ok(defaultDrive.data.id, {
        supportTier: defaultDrive.supportTier,
        diagnostics: defaultDrive.diagnostics,
        warnings: defaultDrive.warnings,
      });
    }

    if (isGuid(reference)) {
      return ok(reference, {
        supportTier: 'preview',
      });
    }

    const drivesResult = await this.httpClient.requestJson<GraphCollectionResponse<{ id: string; name: string }>>({
      path: `/v1.0/sites/${encodeURIComponent(siteId)}/drives`,
    });

    if (!drivesResult.success || !drivesResult.data) {
      return drivesResult as unknown as OperationResult<string>;
    }

    const match = drivesResult.data.value.find((drive) => drive.name === reference || drive.id === reference);

    if (!match) {
      return fail(
        createDiagnostic('error', 'SHAREPOINT_DRIVE_NOT_FOUND', `SharePoint drive ${reference} was not found.`, {
          source: '@pp/sharepoint',
        })
      );
    }

    return ok(match.id, {
      supportTier: drivesResult.supportTier,
      diagnostics: drivesResult.diagnostics,
      warnings: drivesResult.warnings,
    });
  }
}

function buildSitePath(reference: string): string {
  if (!isUrl(reference)) {
    return `/v1.0/sites/${encodeURIComponent(reference)}`;
  }

  const parsed = new URL(reference);
  const relativePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');

  return relativePath ? `/v1.0/sites/${parsed.hostname}:${relativePath}` : `/v1.0/sites/${parsed.hostname}`;
}

function normalizeDrivePath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return encodeURI(normalized);
}

function normalizeSite(site: GraphSite): SharePointSiteReference {
  return {
    id: site.id,
    displayName: site.displayName,
    webUrl: site.webUrl,
    createdDateTime: site.createdDateTime,
    lastModifiedDateTime: site.lastModifiedDateTime,
  };
}

function normalizeList(list: GraphList): SharePointListReference {
  return {
    id: list.id,
    name: list.name,
    displayName: list.displayName,
    webUrl: list.webUrl,
    description: list.description,
    createdDateTime: list.createdDateTime,
    lastModifiedDateTime: list.lastModifiedDateTime,
    driveId: list.drive?.id,
    columns: (list.columns ?? []).map((column) => ({
      id: column.id,
      name: column.name,
      displayName: column.displayName,
      columnGroup: column.columnGroup,
      required: column.required,
      hidden: column.hidden,
      readOnly: column.readOnly,
    })),
  };
}

function normalizeDriveItem(item: GraphDriveItem): SharePointDriveItemReference {
  return {
    id: item.id,
    name: item.name,
    webUrl: item.webUrl,
    size: item.size,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    driveId: item.parentReference?.driveId,
    parentPath: item.parentReference?.path,
    file: item.file
      ? {
          mimeType: item.file.mimeType,
          hashCount: Object.keys(item.file.hashes ?? {}).length,
        }
      : undefined,
    folder: item.folder
      ? {
          childCount: item.folder.childCount,
        }
      : undefined,
  };
}

function normalizePermission(permission: GraphPermission): SharePointPermissionReference {
  return {
    id: permission.id,
    roles: permission.roles ?? [],
    grantedTo: [
      ...normalizePermissionIdentity(permission.grantedTo),
      ...(permission.grantedToIdentitiesV2 ?? []).flatMap((identity) => normalizePermissionIdentity(identity)),
    ],
    inheritedFrom: permission.inheritedFrom?.path,
    linkScope: permission.link?.scope,
    linkType: permission.link?.type,
  };
}

function normalizePermissionIdentity(identity: GraphPermissionIdentitySet | undefined): string[] {
  if (!identity) {
    return [];
  }

  const values = [identity.user?.email, identity.user?.displayName, identity.group?.email, identity.group?.displayName, identity.siteGroup?.displayName]
    .filter((value): value is string => Boolean(value));

  return [...new Set(values)];
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLikelyPath(value: string): boolean {
  return value.startsWith('/') || value.includes('/');
}
