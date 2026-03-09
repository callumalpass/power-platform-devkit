#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { renderMarkdownReport, generateContextPack } from '@pp/analysis';
import { AuthService, summarizeProfile, type AuthProfile, type UserAuthProfile } from '@pp/auth';
import {
  createMutationPreview,
  readMutationFlags,
  renderFailure,
  renderOutput,
  renderWarnings,
  type CliOutputFormat,
} from './contract';
import {
  getEnvironmentAlias,
  listEnvironments,
  removeEnvironmentAlias,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
  type EnvironmentAlias,
} from '@pp/config';
import {
  parseColumnCreateSpec,
  parseCustomerRelationshipCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseOneToManyRelationshipCreateSpec,
  parseTableCreateSpec,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  normalizeGlobalOptionSetDefinition,
  normalizeRelationshipDefinition,
  resolveDataverseClient,
  type AttributeMetadataView,
  type RelationshipMetadataKind,
} from '@pp/dataverse';
import { buildDeployPlan } from '@pp/deploy';
import { fail, ok, createDiagnostic, type OperationResult } from '@pp/diagnostics';
import { discoverProject, summarizeProject, summarizeResolvedParameter } from '@pp/project';
import { SolutionService } from '@pp/solution';
import YAML from 'yaml';

type OutputFormat = CliOutputFormat;
type AttributeListView = Extract<AttributeMetadataView, 'common' | 'raw'>;

const ATTRIBUTE_COMMON_SELECT_FIELDS = [
  'LogicalName',
  'SchemaName',
  'DisplayName',
  'Description',
  'EntityLogicalName',
  'MetadataId',
  'AttributeType',
  'AttributeTypeName',
  'RequiredLevel',
  'IsPrimaryId',
  'IsPrimaryName',
  'IsCustomAttribute',
  'IsManaged',
  'IsLogical',
  'IsValidForCreate',
  'IsValidForRead',
  'IsValidForUpdate',
  'IsFilterable',
  'IsSearchable',
  'IsValidForAdvancedFind',
  'IsSecured',
] as const;

async function main(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;

  if (!group || group === 'help' || group === '--help') {
    printHelp();
    return 0;
  }

  if (group === 'auth') {
    return runAuth(command, rest);
  }

  if (group === 'env') {
    return runEnvironment(command, rest);
  }

  if (group === 'dv') {
    return runDataverse(command, rest);
  }

  if (group === 'solution') {
    return runSolution(command, rest);
  }

  switch (`${group} ${command ?? ''}`.trim()) {
    case 'project inspect':
      return runProjectInspect(rest);
    case 'analysis report':
      return runAnalysisReport(rest);
    case 'analysis context':
      return runAnalysisContext(rest);
    case 'deploy plan':
      return runDeployPlan(rest);
    default:
      printHelp();
      return 1;
  }
}

async function runAuth(command: string | undefined, args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);
  const auth = new AuthService(configOptions);

  if (command === 'profile') {
    const [action, ...rest] = args;

    switch (action) {
      case 'list':
        return runAuthProfileList(auth, rest);
      case 'inspect':
        return runAuthProfileInspect(auth, rest);
      case 'add-user':
        return runAuthProfileSave(auth, rest, 'user');
      case 'add-static':
        return runAuthProfileSave(auth, rest, 'static-token');
      case 'add-env':
        return runAuthProfileSave(auth, rest, 'environment-token');
      case 'add-client-secret':
        return runAuthProfileSave(auth, rest, 'client-secret');
      case 'add-device-code':
        return runAuthProfileSave(auth, rest, 'device-code');
      case 'remove':
        return runAuthProfileRemove(auth, rest);
      default:
        printHelp();
        return 1;
    }
  }

  if (command === 'login') {
    return runAuthLogin(auth, args);
  }

  if (command === 'token') {
    return runAuthToken(auth, args);
  }

  printHelp();
  return 1;
}

async function runEnvironment(command: string | undefined, args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);

  switch (command) {
    case 'list':
      return runEnvironmentList(configOptions, args);
    case 'add':
      return runEnvironmentAdd(configOptions, args);
    case 'inspect':
      return runEnvironmentInspect(configOptions, args);
    case 'remove':
      return runEnvironmentRemove(configOptions, args);
    default:
      printHelp();
      return 1;
  }
}

async function runDataverse(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'whoami':
      return runDataverseWhoAmI(args);
    case 'request':
      return runDataverseRequest(args);
    case 'query':
      return runDataverseQuery(args);
    case 'get':
      return runDataverseGet(args);
    case 'create':
      return runDataverseCreate(args);
    case 'update':
      return runDataverseUpdate(args);
    case 'delete':
      return runDataverseDelete(args);
    case 'metadata':
      return runDataverseMetadata(args);
    default:
      printHelp();
      return 1;
  }
}

async function runSolution(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'list':
      return runSolutionList(args);
    case 'inspect':
      return runSolutionInspect(args);
    default:
      printHelp();
      return 1;
  }
}

async function runProjectInspect(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const payload = {
    summary: summarizeProject(project.data),
    topology: project.data.topology,
    providerBindings: project.data.providerBindings,
    parameters: Object.fromEntries(
      Object.values(project.data.parameters).map((parameter) => [parameter.name, summarizeResolvedParameter(parameter)])
    ),
    assets: project.data.assets,
    templateRegistries: project.data.templateRegistries,
    build: project.data.build,
    docs: project.data.docs,
  };

  printByFormat(payload, format);
  return 0;
}

async function runAnalysisReport(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'markdown');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  if (format === 'markdown') {
    process.stdout.write(renderMarkdownReport(project.data) + '\n');
    return 0;
  }

  const context = generateContextPack(project.data);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  printByFormat(context.data, format);
  return 0;
}

async function runAnalysisContext(args: string[]): Promise<number> {
  const projectPath = readFlag(args, '--project') ?? process.cwd();
  const asset = readFlag(args, '--asset');
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const context = generateContextPack(project.data, asset);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  printByFormat(context.data, format);
  return 0;
}

async function runDeployPlan(args: string[]): Promise<number> {
  const projectPath = readFlag(args, '--project') ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const plan = buildDeployPlan(project.data);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  printByFormat(plan.data, format);
  return 0;
}

async function runAuthProfileList(auth: AuthService, args: string[]): Promise<number> {
  const format = outputFormat(args, 'json');
  const profiles = await auth.listProfiles();

  if (!profiles.success) {
    return printFailure(profiles);
  }

  printByFormat((profiles.data ?? []).map(summarizeProfile), format);
  return 0;
}

async function runAuthProfileInspect(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const format = outputFormat(args, 'json');
  const profile = await auth.getProfile(name);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${name} was not found.`)));
  }

  printByFormat(summarizeProfile(profile.data), format);
  return 0;
}

async function runAuthProfileSave(
  auth: AuthService,
  args: string[],
  type: AuthProfile['type']
): Promise<number> {
  const name = readFlag(args, '--name');
  const description = readFlag(args, '--description');
  const tenantId = readFlag(args, '--tenant-id');
  const clientId = readFlag(args, '--client-id');
  const defaultResource = readFlag(args, '--resource');
  const scopes = readListFlag(args, '--scope');

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  let profile: AuthProfile;

  switch (type) {
    case 'user': {
      profile = buildPublicClientProfile(
        {
          name,
          type,
        },
        args
      );
      break;
    }
    case 'static-token': {
      const token = readFlag(args, '--token');

      if (!token) {
        return printFailure(argumentFailure('AUTH_TOKEN_REQUIRED', '--token is required for add-static.'));
      }

      profile = {
        name,
        type,
        token,
        description,
        tenantId,
        clientId,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'environment-token': {
      const environmentVariable = readFlag(args, '--env-var');

      if (!environmentVariable) {
        return printFailure(argumentFailure('AUTH_ENV_VAR_REQUIRED', '--env-var is required for add-env.'));
      }

      profile = {
        name,
        type,
        environmentVariable,
        description,
        tenantId,
        clientId,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'client-secret': {
      const clientSecretEnv = readFlag(args, '--secret-env');

      if (!tenantId || !clientId || !clientSecretEnv) {
        return printFailure(
          argumentFailure(
            'AUTH_CLIENT_SECRET_FIELDS_REQUIRED',
            '--tenant-id, --client-id, and --secret-env are required for add-client-secret.'
          )
        );
      }

      profile = {
        name,
        type,
        tenantId,
        clientId,
        clientSecretEnv,
        description,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'device-code': {
      profile = buildPublicClientProfile(
        {
          name,
          type,
        },
        args
      );
      break;
    }
  }

  const preview = maybeHandleMutationPreview(args, 'json', `auth.profile.${type === 'user' ? 'add-user' : `add-${type}`}`, { name }, summarizeProfile(profile));

  if (preview !== undefined) {
    return preview;
  }

  const saved = await auth.saveProfile(profile);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(summarizeProfile(saved.data), outputFormat(args, 'json'));
  return 0;
}

async function runAuthLogin(auth: AuthService, args: string[]): Promise<number> {
  const name = readFlag(args, '--name');

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const existing = await auth.getProfile(name);

  if (!existing.success) {
    return printFailure(existing);
  }

  if (existing.data && existing.data.type !== 'user' && existing.data.type !== 'device-code') {
    return printFailure(
      argumentFailure(
        'AUTH_PROFILE_TYPE_CONFLICT',
        `Auth profile ${name} already exists with type ${existing.data.type}. Use a different name for browser login.`
      )
    );
  }

  const requestedType: UserAuthProfile['type'] = hasFlag(args, '--device-code')
    ? 'device-code'
    : hasFlag(args, '--interactive')
      ? 'user'
      : existing.data?.type === 'device-code'
        ? 'device-code'
        : 'user';

  const baseProfile: UserAuthProfile =
    existing.data && (existing.data.type === 'user' || existing.data.type === 'device-code')
      ? existing.data
      : {
          name,
          type: requestedType,
        };

  const profile = buildPublicClientProfile(
    {
      ...baseProfile,
      name,
      type: requestedType,
    },
    args
  );

  const resource = resolveRequestedResource(profile, readFlag(args, '--resource'));

  if (resource === undefined) {
    return printFailure(
      argumentFailure(
        'AUTH_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const login = await auth.loginProfile(profile, resource, {
    forcePrompt: hasFlag(args, '--force-prompt'),
    preferredFlow: profile.type === 'device-code' ? 'device-code' : 'interactive',
  });

  if (!login.success || !login.data) {
    return printFailure(login);
  }

  printByFormat(
    {
      profile: summarizeProfile(login.data.profile),
      resource: resource || undefined,
      authenticated: true,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runAuthProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.profile.remove', { name });

  if (preview !== undefined) {
    return preview;
  }

  const removed = await auth.removeProfile(name);

  if (!removed.success) {
    return printFailure(removed);
  }

  printByFormat({ removed: removed.data ?? false, name }, 'json');
  return 0;
}

async function runAuthToken(auth: AuthService, args: string[]): Promise<number> {
  const profileName = readFlag(args, '--profile');
  const format = outputFormat(args, 'raw');

  if (!profileName) {
    return printFailure(argumentFailure('AUTH_TOKEN_PROFILE_REQUIRED', '--profile is required.'));
  }

  const profile = await auth.getProfile(profileName);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found.`)));
  }

  const resource = resolveRequestedResource(profile.data, readFlag(args, '--resource'));

  if (resource === undefined) {
    return printFailure(
      argumentFailure(
        'AUTH_TOKEN_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const token = await auth.getAccessToken(profileName, resource);

  if (!token.success || !token.data) {
    return printFailure(token);
  }

  if (format === 'raw') {
    process.stdout.write(token.data.token + '\n');
    return 0;
  }

  printByFormat(
    {
      profile: summarizeProfile(token.data.profile),
      resource: resource || undefined,
      token: token.data.token,
    },
    format
  );
  return 0;
}

async function runEnvironmentList(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const environments = await listEnvironments(configOptions);

  if (!environments.success) {
    return printFailure(environments);
  }

  printByFormat(environments.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentAdd(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = readFlag(args, '--name');
  const url = readFlag(args, '--url');
  const authProfile = readFlag(args, '--profile');

  if (!alias || !url || !authProfile) {
    return printFailure(argumentFailure('ENV_ADD_ARGS_REQUIRED', '--name, --url, and --profile are required.'));
  }

  const environment: EnvironmentAlias = {
    alias,
    url,
    authProfile,
    tenantId: readFlag(args, '--tenant-id'),
    displayName: readFlag(args, '--display-name'),
    defaultSolution: readFlag(args, '--default-solution'),
    apiPath: readFlag(args, '--api-path'),
  };

  const preview = maybeHandleMutationPreview(args, 'json', 'env.add', { alias, url, authProfile }, environment);

  if (preview !== undefined) {
    return preview;
  }

  const saved = await saveEnvironmentAlias(environment, configOptions);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(saved.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentInspect(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return printFailure(environment);
  }

  if (!environment.data) {
    return printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  printByFormat(environment.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentRemove(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'env.remove', { alias });

  if (preview !== undefined) {
    return preview;
  }

  const removed = await removeEnvironmentAlias(alias, configOptions);

  if (!removed.success) {
    return printFailure(removed);
  }

  printByFormat({ removed: removed.data ?? false, alias }, 'json');
  return 0;
}

async function runDataverseWhoAmI(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const whoAmI = await resolution.data.client.whoAmI();

  if (!whoAmI.success || !whoAmI.data) {
    return printFailure(whoAmI);
  }

  printByFormat(
    {
      environment: resolution.data.environment.alias,
      url: resolution.data.environment.url,
      authProfile: resolution.data.authProfile.name,
      ...whoAmI.data,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runDataverseRequest(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const path = readFlag(args, '--path');

  if (!path) {
    return printFailure(argumentFailure('DV_REQUEST_PATH_REQUIRED', '--path is required.'));
  }

  const responseType = (readFlag(args, '--response-type') ?? 'json') as 'json' | 'text' | 'void';
  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if ((readFlag(args, '--method') ?? 'GET').toUpperCase() !== 'GET') {
    const preview = maybeHandleMutationPreview(args, 'json', 'dv.request', { path, method: readFlag(args, '--method') ?? 'GET' }, body.data);

    if (preview !== undefined) {
      return preview;
    }
  }

  const response = await resolution.data.client.request<unknown>({
    path,
    method: readFlag(args, '--method') ?? 'GET',
    body: body.data,
    responseType,
    headers: readHeaderFlags(args),
  });

  if (!response.success || !response.data) {
    return printFailure(response);
  }

  printByFormat(
    {
      status: response.data.status,
      headers: response.data.headers,
      body: response.data.data,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runDataverseQuery(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Table logical name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const queryOptions = {
    table,
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
  };

  if (hasFlag(args, '--page-info')) {
    const page = await resolution.data.client.queryPage<Record<string, unknown>>(queryOptions);

    if (!page.success) {
      return printFailure(page);
    }

    printByFormat(page.data ?? { records: [] }, outputFormat(args, 'json'));
    return 0;
  }

  const result = hasFlag(args, '--all')
    ? await resolution.data.client.queryAll<Record<string, unknown>>(queryOptions)
    : await resolution.data.client.query<Record<string, unknown>>(queryOptions);

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runDataverseGet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_GET_ARGS_REQUIRED', 'Usage: dv get <table> <id> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getById<Record<string, unknown>>(table, id, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseCreate(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Table logical name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.create', { table }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.create<Record<string, unknown>, Record<string, unknown>>(table, body.data as Record<string, unknown>, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
    returnRepresentation: hasFlag(args, '--return-representation'),
    ifNoneMatch: readFlag(args, '--if-none-match'),
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseUpdate(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_UPDATE_ARGS_REQUIRED', 'Usage: dv update <table> <id> --env <alias> --body <json>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.update', { table, id }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.update<Record<string, unknown>, Record<string, unknown>>(
    table,
    id,
    body.data as Record<string, unknown>,
    {
      select: readListFlag(args, '--select'),
      expand: readListFlag(args, '--expand'),
      includeAnnotations: readListFlag(args, '--annotations'),
      returnRepresentation: hasFlag(args, '--return-representation'),
      ifMatch: readFlag(args, '--if-match'),
      ifNoneMatch: readFlag(args, '--if-none-match'),
    }
  );

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseDelete(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_DELETE_ARGS_REQUIRED', 'Usage: dv delete <table> <id> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.delete', { table, id });

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.delete(table, id, {
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadata(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_ACTION_REQUIRED',
        'Use `dv metadata tables`, `dv metadata table <logicalName>`, `dv metadata columns <table>`, `dv metadata column <table> <column>`, `dv metadata option-set <name>`, `dv metadata relationship <schemaName>`, `dv metadata create-table`, `dv metadata add-column`, `dv metadata create-option-set`, `dv metadata update-option-set`, `dv metadata create-relationship`, `dv metadata create-many-to-many`, or `dv metadata create-customer-relationship`.'
      )
    );
  }

  if (action === 'tables') {
    return runDataverseMetadataTables(args);
  }

  if (action === 'table') {
    return runDataverseMetadataTable(args);
  }

  if (action === 'columns') {
    return runDataverseMetadataColumns(args);
  }

  if (action === 'column') {
    return runDataverseMetadataColumn(args);
  }

  if (action === 'option-set') {
    return runDataverseMetadataOptionSet(args);
  }

  if (action === 'relationship') {
    return runDataverseMetadataRelationship(args);
  }

  if (action === 'create-table') {
    return runDataverseMetadataCreateTable(args);
  }

  if (action === 'add-column') {
    return runDataverseMetadataAddColumn(args);
  }

  if (action === 'create-option-set') {
    return runDataverseMetadataCreateOptionSet(args);
  }

  if (action === 'update-option-set') {
    return runDataverseMetadataUpdateOptionSet(args);
  }

  if (action === 'create-relationship') {
    return runDataverseMetadataCreateRelationship(args);
  }

  if (action === 'create-many-to-many') {
    return runDataverseMetadataCreateManyToManyRelationship(args);
  }

  if (action === 'create-customer-relationship') {
    return runDataverseMetadataCreateCustomerRelationship(args);
  }

  return printFailure(argumentFailure('DV_METADATA_ACTION_INVALID', `Unsupported metadata action ${action}.`));
}

async function runDataverseMetadataTables(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.listTables({
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataTable(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_TABLE_REQUIRED', 'Usage: dv metadata table <logicalName> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getTable(logicalName, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataColumns(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_COLUMNS_TABLE_REQUIRED', 'Usage: dv metadata columns <tableLogicalName> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeListView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const result = await resolution.data.client.listColumns(logicalName, {
    select: view.data === 'raw' ? readListFlag(args, '--select') : mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select')),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload = view.data === 'raw' ? result.data ?? [] : normalizeAttributeDefinitions(result.data ?? [], 'common');
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];
  const columnLogicalName = positional[2];

  if (!tableLogicalName || !columnLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_COLUMN_REQUIRED', 'Usage: dv metadata column <tableLogicalName> <columnLogicalName> --env <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeDetailView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const result = await resolution.data.client.getColumn(tableLogicalName, columnLogicalName, {
    select:
      view.data === 'raw'
        ? readListFlag(args, '--select')
        : view.data === 'common'
          ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
          : readListFlag(args, '--select')
            ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
            : undefined,
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload = view.data === 'raw' ? result.data : normalizeAttributeDefinition(result.data, view.data);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataOptionSet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const name = positional[1];

  if (!name) {
    return printFailure(argumentFailure('DV_METADATA_OPTION_SET_REQUIRED', 'Usage: dv metadata option-set <name> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getGlobalOptionSet(name, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeGlobalOptionSetDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataRelationship(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const schemaName = positional[1];

  if (!schemaName) {
    return printFailure(argumentFailure('DV_METADATA_RELATIONSHIP_REQUIRED', 'Usage: dv metadata relationship <schemaName> --env <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const kind = readRelationshipKind(args);

  if (!kind.success || !kind.data) {
    return printFailure(kind);
  }

  const result = await resolution.data.client.getRelationship(schemaName, {
    kind: kind.data,
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeRelationshipDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateTable(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(args, '--file', 'DV_METADATA_CREATE_TABLE_FILE_REQUIRED', 'Usage: dv metadata create-table --file FILE --env <alias>');

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseTableCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-table', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createTable(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataAddColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];

  if (!tableLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_ADD_COLUMN_TABLE_REQUIRED', 'Usage: dv metadata add-column <tableLogicalName> --file FILE --env <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(args, '--file', 'DV_METADATA_ADD_COLUMN_FILE_REQUIRED', 'Usage: dv metadata add-column <tableLogicalName> --file FILE --env <alias>');

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseColumnCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.add-column', { tableLogicalName, solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createColumn(tableLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata create-option-set --file FILE --env <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataUpdateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata update-option-set --file FILE --env <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.update-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-relationship --file FILE --env <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseOneToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createOneToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateManyToManyRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_MANY_TO_MANY_FILE_REQUIRED',
    'Usage: dv metadata create-many-to-many --file FILE --env <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseManyToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-many-to-many', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createManyToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateCustomerRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_CUSTOMER_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-customer-relationship --file FILE --env <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseCustomerRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-customer-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createCustomerRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.list();

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runSolutionInspect(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.inspect(uniqueName);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

function buildPublicClientProfile(
  baseProfile: UserAuthProfile,
  args: string[]
): UserAuthProfile {
  const prompt = readFlag(args, '--prompt');
  const scopes = readListFlag(args, '--scope');
  const explicitFallback = hasFlag(args, '--no-device-code-fallback')
    ? false
    : hasFlag(args, '--device-code-fallback')
      ? true
      : undefined;

  if (baseProfile.type === 'device-code') {
    return {
      ...baseProfile,
      description: readFlag(args, '--description') ?? baseProfile.description,
      tenantId: readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
      clientId: readFlag(args, '--client-id') ?? baseProfile.clientId,
      defaultResource: readFlag(args, '--resource') ?? baseProfile.defaultResource,
      scopes: scopes ?? baseProfile.scopes,
      tokenCacheKey: readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
      loginHint: readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    };
  }

  return {
    ...baseProfile,
    description: readFlag(args, '--description') ?? baseProfile.description,
    tenantId: readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
    clientId: readFlag(args, '--client-id') ?? baseProfile.clientId,
    defaultResource: readFlag(args, '--resource') ?? baseProfile.defaultResource,
    scopes: scopes ?? baseProfile.scopes,
    tokenCacheKey: readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
    loginHint: readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    prompt: isPromptValue(prompt) ? prompt : baseProfile.prompt,
    fallbackToDeviceCode: explicitFallback ?? baseProfile.fallbackToDeviceCode,
  };
}

function resolveRequestedResource(profile: AuthProfile, requestedResource: string | undefined): string | undefined {
  if (requestedResource) {
    return requestedResource;
  }

  if (profile.defaultResource) {
    return profile.defaultResource;
  }

  if (profile.scopes?.length) {
    return '';
  }

  return undefined;
}

async function resolveDataverseClientForCli(args: string[]) {
  const environmentAlias = readFlag(args, '--env');

  if (!environmentAlias) {
    return argumentFailure('DV_ENV_REQUIRED', '--env is required.');
  }

  return resolveDataverseClient(environmentAlias, readConfigOptions(args));
}

function printByFormat(value: unknown, format: OutputFormat): void {
  process.stdout.write(renderOutput(value, format));
}

function printFailure(result: OperationResult<unknown>): number {
  process.stderr.write(renderFailure(result, resolveProcessOutputFormat()));

  return 1;
}

function printWarnings(result: OperationResult<unknown>): void {
  if (result.warnings.length > 0) {
    process.stderr.write(renderWarnings(result.warnings));
  }
}

function maybeHandleMutationPreview(
  args: string[],
  fallbackFormat: OutputFormat,
  action: string,
  target: Record<string, unknown>,
  input?: unknown
): number | undefined {
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  if (mutation.data.mode === 'apply') {
    return undefined;
  }

  printByFormat(createMutationPreview(action, mutation.data, target, input), outputFormat(args, fallbackFormat));
  return 0;
}

function outputFormat(args: string[], fallback: OutputFormat): OutputFormat {
  return (readFlag(args, '--format') ?? fallback) as OutputFormat;
}

function resolveProcessOutputFormat(): OutputFormat {
  return outputFormat(process.argv.slice(2), 'json');
}

function readConfigOptions(args: string[]): ConfigStoreOptions {
  const configDir = readFlag(args, '--config-dir');
  return configDir ? { configDir } : {};
}

function readProjectDiscoveryOptions(args: string[]): OperationResult<{ stage?: string; parameterOverrides?: Record<string, string> }> {
  const parameterOverrides = readParameterOverrides(args);

  if (!parameterOverrides.success || !parameterOverrides.data) {
    return parameterOverrides;
  }

  return ok(
    {
      stage: readFlag(args, '--stage'),
      parameterOverrides: Object.keys(parameterOverrides.data).length > 0 ? parameterOverrides.data : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readRepeatedFlags(args: string[], name: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1] as string);
      index += 1;
    }
  }

  return values;
}

function readParameterOverrides(args: string[]): OperationResult<Record<string, string>> {
  const overrides: Record<string, string> = {};

  for (const value of readRepeatedFlags(args, '--param')) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('PROJECT_PARAM_OVERRIDE_INVALID', 'Use `--param NAME=VALUE` for project parameter overrides.');
    }

    overrides[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
  }

  return ok(overrides, {
    supportTier: 'preview',
  });
}

function readListFlag(args: string[], name: string): string[] | undefined {
  const value = readFlag(args, name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

function readNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
}

function readMetadataCreateOptions(
  args: string[]
): OperationResult<{
  solutionUniqueName?: string;
  languageCode?: number;
  publish?: boolean;
  includeAnnotations?: string[];
}> {
  const languageCode = readNumberFlag(args, '--language-code');

  if (languageCode !== undefined && (!Number.isInteger(languageCode) || languageCode <= 0)) {
    return argumentFailure('DV_METADATA_LANGUAGE_CODE_INVALID', '--language-code must be a positive integer.');
  }

  return ok(
    {
      solutionUniqueName: readFlag(args, '--solution'),
      languageCode,
      publish: hasFlag(args, '--no-publish') ? false : true,
      includeAnnotations: readListFlag(args, '--annotations'),
    },
    {
      supportTier: 'preview',
    }
  );
}

function readAttributeListView(args: string[]): OperationResult<AttributeListView> {
  const view = readFlag(args, '--view') ?? 'common';

  if (view === 'common' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMNS_VIEW_INVALID', 'Unsupported --view for `dv metadata columns`. Use `common` or `raw`.');
}

function readAttributeDetailView(args: string[]): OperationResult<AttributeMetadataView> {
  const view = readFlag(args, '--view') ?? 'detailed';

  if (view === 'common' || view === 'detailed' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMN_VIEW_INVALID', 'Unsupported --view for `dv metadata column`. Use `common`, `detailed`, or `raw`.');
}

function readMetadataInspectView(args: string[]): OperationResult<'normalized' | 'raw'> {
  const view = readFlag(args, '--view') ?? 'normalized';

  if (view === 'normalized' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_VIEW_INVALID', 'Unsupported --view. Use `normalized` or `raw`.');
}

function readRelationshipKind(args: string[]): OperationResult<RelationshipMetadataKind> {
  const kind = readFlag(args, '--kind') ?? 'auto';

  if (kind === 'auto' || kind === 'one-to-many' || kind === 'many-to-many') {
    return ok(kind, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_RELATIONSHIP_KIND_INVALID', 'Unsupported --kind. Use `auto`, `one-to-many`, or `many-to-many`.');
}

function mergeUniqueStrings(base: readonly string[], extra: string[] | undefined): string[] {
  return [...new Set([...base, ...(extra ?? [])])];
}

async function readJsonBodyArgument(args: string[]): Promise<OperationResult<unknown | undefined>> {
  try {
    const inlineBody = readFlag(args, '--body');

    if (inlineBody) {
      return {
        success: true,
        data: JSON.parse(inlineBody),
        diagnostics: [],
        warnings: [],
        supportTier: 'preview',
      };
    }

    const bodyFile = readFlag(args, '--body-file');

    if (!bodyFile) {
      return {
        success: true,
        data: undefined,
        diagnostics: [],
        warnings: [],
        supportTier: 'preview',
      };
    }

    const contents = await readFile(bodyFile, 'utf8');
    return {
      success: true,
      data: JSON.parse(contents),
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
    };
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_BODY_INVALID', 'Failed to parse JSON request body.', {
        source: '@pp/cli',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function readStructuredSpecArgument(
  args: string[],
  flagName: string,
  missingCode: string,
  missingMessage: string
): Promise<OperationResult<unknown>> {
  const file = readFlag(args, flagName);

  if (!file) {
    return argumentFailure(missingCode, missingMessage);
  }

  try {
    const contents = await readFile(file, 'utf8');
    const parsed = parseStructuredText(contents, file);

    if (!parsed.success || parsed.data === undefined) {
      return parsed;
    }

    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return fail(
        createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    return parsed;
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_READ_FAILED', 'Failed to read structured spec file.', {
        source: '@pp/cli',
        path: file,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function parseStructuredText(contents: string, sourcePath: string): OperationResult<unknown> {
  try {
    const trimmed = contents.trim();
    const lowerPath = sourcePath.toLowerCase();
    const data =
      lowerPath.endsWith('.json')
        ? JSON.parse(trimmed)
        : lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')
          ? YAML.parse(contents)
          : tryParseJsonOrYaml(contents);

    return ok(data, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_PARSE_FAILED', 'Failed to parse structured spec file as JSON or YAML.', {
        source: '@pp/cli',
        path: sourcePath,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function tryParseJsonOrYaml(contents: string): unknown {
  const trimmed = contents.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(contents);
  }
}

function readHeaderFlags(args: string[]): Record<string, string> | undefined {
  const entries = readRepeatedFlags(args, '--header')
    .map((value) => {
      const separatorIndex = value.indexOf(':');

      if (separatorIndex === -1) {
        return undefined;
      }

      const key = value.slice(0, separatorIndex).trim();
      const headerValue = value.slice(separatorIndex + 1).trim();

      if (!key || !headerValue) {
        return undefined;
      }

      return [key, headerValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function positionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current) {
      continue;
    }

    if (current.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(current)) {
        index += 1;
      }
      continue;
    }

    positional.push(current);
  }

  return positional;
}

const BOOLEAN_FLAGS = new Set([
  '--all',
  '--count',
  '--dry-run',
  '--device-code',
  '--device-code-fallback',
  '--force-prompt',
  '--no-device-code-fallback',
  '--no-publish',
  '--page-info',
  '--plan',
  '--return-representation',
  '--yes',
]);

function argumentFailure(code: string, message: string): OperationResult<never> {
  return fail(
    createDiagnostic('error', code, message, {
      source: '@pp/cli',
    })
  );
}

function isPromptValue(value: string | undefined): value is Extract<UserAuthProfile, { type: 'user' }>['prompt'] {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none';
}

function printHelp(): void {
  process.stdout.write(
    [
      'pp',
      '',
      'Commands:',
      '  auth profile list [--config-dir path]',
      '  auth profile inspect <name> [--config-dir path]',
      '  auth profile add-user --name NAME [--resource URL] [--login-hint user@contoso.com] [--config-dir path]',
      '  auth profile add-static --name NAME --token TOKEN [--resource URL]',
      '  auth profile add-env --name NAME --env-var ENV_VAR [--resource URL]',
      '  auth profile add-client-secret --name NAME --tenant-id TENANT --client-id CLIENT --secret-env ENV_VAR [--resource URL] [--scope s1,s2]',
      '  auth profile add-device-code --name NAME [--resource URL] [--login-hint user@contoso.com] [--config-dir path]',
      '  auth profile remove <name> [--config-dir path]',
      '  auth login --name NAME --resource URL [--login-hint user@contoso.com] [--force-prompt] [--device-code] [--config-dir path]',
      '  auth token --profile NAME [--resource URL] [--format raw|json]',
      '',
      '  env list [--config-dir path]',
      '  env add --name ALIAS --url URL --profile PROFILE [--default-solution NAME] [--config-dir path]',
      '  env inspect <alias> [--config-dir path]',
      '  env remove <alias> [--config-dir path]',
      '',
      '  dv whoami --env ALIAS [--config-dir path]',
      '  dv request --env ALIAS --path PATH [--method GET] [--body JSON|--body-file FILE] [--response-type json|text|void] [--header "Name: value"] [--config-dir path]',
      '  dv query <table> --env ALIAS [--select a,b] [--expand x,y] [--orderby expr] [--top N] [--filter expr] [--count] [--all|--page-info] [--config-dir path]',
      '  dv get <table> <id> --env ALIAS [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv create <table> --env ALIAS --body JSON|--body-file FILE [--return-representation] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv update <table> <id> --env ALIAS --body JSON|--body-file FILE [--return-representation] [--if-match etag] [--config-dir path]',
      '  dv delete <table> <id> --env ALIAS [--if-match etag] [--config-dir path]',
      '  dv metadata tables --env ALIAS [--select a,b] [--filter expr] [--top N] [--all] [--config-dir path]',
      '  dv metadata table <logicalName> --env ALIAS [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata columns <tableLogicalName> --env ALIAS [--view common|raw] [--select a,b] [--filter expr] [--top N] [--all] [--config-dir path]',
      '  dv metadata column <tableLogicalName> <columnLogicalName> --env ALIAS [--view common|detailed|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata option-set <name> --env ALIAS [--view normalized|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata relationship <schemaName> --env ALIAS [--kind auto|one-to-many|many-to-many] [--view normalized|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata create-table --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata add-column <tableLogicalName> --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-option-set --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata update-option-set --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-relationship --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-many-to-many --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-customer-relationship --env ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '',
      '  solution list --env ALIAS [--config-dir path]',
      '  solution inspect <uniqueName> --env ALIAS [--config-dir path]',
      '',
      '  project inspect [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis report [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis context [--project path] [--asset assetRef] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  deploy plan [--project path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
      '',
      'Mutation command options:',
      '  --dry-run  render a mutation preview without side effects',
      '  --plan     render a mutation plan without side effects',
      '  --yes      record non-interactive confirmation for guarded workflows',
    ].join('\n') + '\n'
  );
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
