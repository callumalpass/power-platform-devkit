import { HttpClient } from '@pp/http';

export interface SharePointSiteReference {
  id: string;
  displayName: string;
  webUrl?: string;
}

export class SharePointClient {
  constructor(private readonly httpClient: HttpClient) {}

  async inspectSite(path: string) {
    return this.httpClient.requestJson<SharePointSiteReference>({
      path,
    });
  }
}
