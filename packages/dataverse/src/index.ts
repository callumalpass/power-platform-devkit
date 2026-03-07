import { createTokenProvider, type AuthProfile } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient } from '@pp/http';

export interface DataverseEnvironment {
  url: string;
  apiPath?: string;
}

export interface QueryOptions {
  table: string;
  select?: string[];
  top?: number;
  filter?: string;
}

export interface DataverseResolution {
  environment: EnvironmentAlias;
  authProfile: AuthProfile;
  client: DataverseClient;
}

export interface WhoAmIResult {
  BusinessUnitId: string;
  OrganizationId: string;
  UserId: string;
}

export class DataverseClient {
  private readonly httpClient: HttpClient;

  constructor(private readonly environment: DataverseEnvironment, httpClient?: HttpClient) {
    this.httpClient =
      httpClient ??
      new HttpClient({
        baseUrl: new URL(environment.apiPath ?? '/api/data/v9.2/', environment.url).toString(),
        defaultHeaders: {
          accept: 'application/json',
        },
      });
  }

  async query<T>(options: QueryOptions): Promise<OperationResult<T[]>> {
    const result = await this.httpClient.requestJson<{ value: T[] }>({
      path: buildQueryPath(options),
    });

    if (!result.success) {
      return result as unknown as OperationResult<T[]>;
    }

    return ok(result.data?.value ?? [], {
      supportTier: 'preview',
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    });
  }

  async getById<T>(table: string, id: string, select?: string[]): Promise<OperationResult<T>> {
    const params = new URLSearchParams();

    if (select?.length) {
      params.set('$select', select.join(','));
    }

    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.httpClient.requestJson<T>({
      path: `${table}(${id})${suffix}`,
    });
  }

  async whoAmI(): Promise<OperationResult<WhoAmIResult>> {
    return this.httpClient.requestJson<WhoAmIResult>({
      path: 'WhoAmI()',
    });
  }
}

export async function resolveDataverseClient(
  environmentAlias: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<DataverseResolution>> {
  const environmentResult = await getEnvironmentAlias(environmentAlias, options);

  if (!environmentResult.success) {
    return environmentResult as unknown as OperationResult<DataverseResolution>;
  }

  if (!environmentResult.data) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_ENV_NOT_FOUND', `Environment alias ${environmentAlias} was not found`, {
        source: '@pp/dataverse',
      })
    );
  }

  const authProfileResult = await getAuthProfile(environmentResult.data.authProfile, options);

  if (!authProfileResult.success) {
    return authProfileResult as unknown as OperationResult<DataverseResolution>;
  }

  if (!authProfileResult.data) {
    return fail(
      createDiagnostic(
        'error',
        'DATAVERSE_AUTH_PROFILE_NOT_FOUND',
        `Auth profile ${environmentResult.data.authProfile} referenced by ${environmentAlias} was not found`,
        {
          source: '@pp/dataverse',
        }
      )
    );
  }

  const tokenProvider = createTokenProvider(authProfileResult.data, options);

  if (!tokenProvider.success || !tokenProvider.data) {
    return tokenProvider as unknown as OperationResult<DataverseResolution>;
  }

  const client = new DataverseClient(
    {
      url: environmentResult.data.url,
      apiPath: environmentResult.data.apiPath,
    },
    new HttpClient({
      baseUrl: new URL(environmentResult.data.apiPath ?? '/api/data/v9.2/', environmentResult.data.url).toString(),
      defaultHeaders: {
        accept: 'application/json',
      },
      tokenProvider: tokenProvider.data,
    })
  );

  return ok(
    {
      environment: environmentResult.data,
      authProfile: authProfileResult.data,
      client,
    },
    {
      supportTier: 'preview',
      provenance: [
        {
          kind: 'official-api',
          source: environmentResult.data.url,
        },
      ],
    }
  );
}

export function buildQueryPath(options: QueryOptions): string {
  const params = new URLSearchParams();

  if (options.select?.length) {
    params.set('$select', options.select.join(','));
  }

  if (options.top !== undefined) {
    params.set('$top', String(options.top));
  }

  if (options.filter) {
    params.set('$filter', options.filter);
  }

  const suffix = params.toString();
  return suffix ? `${options.table}?${suffix}` : options.table;
}
