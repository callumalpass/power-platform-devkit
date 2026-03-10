import { describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import { SharePointClient } from './index';

describe('SharePointClient', () => {
  it('resolves list inspection by list title after resolving the site URL', async () => {
    const requests: string[] = [];
    const client = new SharePointClient({
      requestJson: async <T>(options: { path: string }): Promise<OperationResult<T>> => {
        requests.push(options.path);

        if (options.path === '/v1.0/sites/example.sharepoint.com:/sites/finance') {
          return ok(
            {
              id: 'site-1',
              displayName: 'Finance',
            } as T,
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            value: [
              {
                id: 'list-1',
                name: 'Campaigns',
                displayName: 'Campaigns',
                columns: [
                  {
                    id: 'col-1',
                    name: 'Title',
                    displayName: 'Title',
                  },
                ],
                drive: {
                  id: 'drive-1',
                },
              },
            ],
          } as T,
          { supportTier: 'preview' }
        );
      },
    } as never);

    const result = await client.inspectList('https://example.sharepoint.com/sites/finance', 'Campaigns');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'list-1',
      name: 'Campaigns',
      displayName: 'Campaigns',
      driveId: 'drive-1',
      columns: [
        {
          id: 'col-1',
          name: 'Title',
          displayName: 'Title',
          columnGroup: undefined,
          required: undefined,
          hidden: undefined,
          readOnly: undefined,
        },
      ],
      webUrl: undefined,
      description: undefined,
      createdDateTime: undefined,
      lastModifiedDateTime: undefined,
    });
    expect(requests).toEqual(['/v1.0/sites/example.sharepoint.com:/sites/finance', '/v1.0/sites/site-1/lists']);
  });

  it('inspects a drive item by path and includes drive metadata', async () => {
    const client = new SharePointClient({
      requestJson: async <T>(options: { path: string }): Promise<OperationResult<T>> => {
        if (options.path === '/v1.0/sites/site-1/drive') {
          return ok(
            {
              id: 'drive-1',
            } as T,
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            id: 'item-1',
            name: 'Budget.xlsx',
            parentReference: {
              driveId: 'drive-1',
              path: '/drives/drive-1/root:/Shared Documents',
            },
            file: {
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              hashes: {
                quickXorHash: '123',
              },
            },
          } as T,
          { supportTier: 'preview' }
        );
      },
    } as never);

    const result = await client.inspectDriveItem('site-1', '/Shared Documents/Budget.xlsx');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'item-1',
      name: 'Budget.xlsx',
      driveId: 'drive-1',
      parentPath: '/drives/drive-1/root:/Shared Documents',
      file: {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        hashCount: 1,
      },
      folder: undefined,
      webUrl: undefined,
      size: undefined,
      createdDateTime: undefined,
      lastModifiedDateTime: undefined,
    });
  });

  it('uploads UTF-8 text content to a SharePoint file target', async () => {
    const requests: Array<{ method: string | undefined; path: string; rawBody?: string | Uint8Array }> = [];
    const client = new SharePointClient({
      requestJson: async <T>(options: {
        method?: string;
        path: string;
        rawBody?: string | Uint8Array;
      }): Promise<OperationResult<T>> => {
        requests.push({
          method: options.method,
          path: options.path,
          rawBody: options.rawBody,
        });

        if (options.path === '/v1.0/sites/site-1/drive') {
          return ok(
            {
              id: 'drive-1',
            } as T,
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            id: 'item-1',
            name: 'release.txt',
            parentReference: {
              driveId: 'drive-1',
              path: '/drives/drive-1/root:/Shared Documents',
            },
            file: {
              mimeType: 'text/plain',
              hashes: {
                quickXorHash: '123',
              },
            },
          } as T,
          { supportTier: 'preview' }
        );
      },
    } as never);

    const result = await client.setDriveItemText('site-1', '/Shared Documents/release.txt', 'release-2026.03.11');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'item-1',
      name: 'release.txt',
      driveId: 'drive-1',
      parentPath: '/drives/drive-1/root:/Shared Documents',
      file: {
        mimeType: 'text/plain',
        hashCount: 1,
      },
      folder: undefined,
      webUrl: undefined,
      size: undefined,
      createdDateTime: undefined,
      lastModifiedDateTime: undefined,
    });
    expect(requests).toEqual([
      {
        method: undefined,
        path: '/v1.0/sites/site-1/drive',
        rawBody: undefined,
      },
      {
        method: 'PUT',
        path: '/v1.0/drives/drive-1/root:/Shared%20Documents/release.txt:/content',
        rawBody: 'release-2026.03.11',
      },
    ]);
  });
});
