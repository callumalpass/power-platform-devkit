import { HttpClient } from '@pp/http';

export interface PowerBiWorkspace {
  id: string;
  name: string;
}

export class PowerBiClient {
  constructor(private readonly httpClient: HttpClient) {}

  async listWorkspaces() {
    return this.httpClient.requestJson<{ value: PowerBiWorkspace[] }>({
      path: '/v1.0/myorg/groups',
    });
  }
}
