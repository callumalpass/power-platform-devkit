#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { renderMarkdownReport, generateContextPack } from '@pp/analysis';
import { stableStringify } from '@pp/artifacts';
import { AuthService, summarizeProfile, type AuthProfile, type UserAuthProfile } from '@pp/auth';
import {
  getEnvironmentAlias,
  listEnvironments,
  removeEnvironmentAlias,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
  type EnvironmentAlias,
} from '@pp/config';
import { resolveDataverseClient } from '@pp/dataverse';
import { buildDeployPlan } from '@pp/deploy';
import { fail, createDiagnostic, type OperationResult } from '@pp/diagnostics';
import { discoverProject, summarizeProject } from '@pp/project';
import { SolutionService } from '@pp/solution';

type OutputFormat = 'json' | 'markdown' | 'table' | 'raw';

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
  const format = (readFlag(args, '--format') ?? 'json') as OutputFormat;
  const project = await discoverProject(path);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const payload = {
    summary: summarizeProject(project.data),
    providerBindings: project.data.providerBindings,
    parameters: project.data.parameters,
    assets: project.data.assets,
  };

  printByFormat(payload, format);
  return 0;
}

async function runAnalysisReport(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0] ?? process.cwd();
  const format = (readFlag(args, '--format') ?? 'markdown') as OutputFormat;
  const project = await discoverProject(path);

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
  const format = (readFlag(args, '--format') ?? 'json') as OutputFormat;
  const project = await discoverProject(projectPath);

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
  const format = (readFlag(args, '--format') ?? 'json') as OutputFormat;
  const project = await discoverProject(projectPath);

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
  const format = (readFlag(args, '--format') ?? 'json') as OutputFormat;
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

  const format = (readFlag(args, '--format') ?? 'json') as OutputFormat;
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

  const saved = await auth.saveProfile(profile);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(summarizeProfile(saved.data), (readFlag(args, '--format') ?? 'json') as OutputFormat);
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
    (readFlag(args, '--format') ?? 'json') as OutputFormat
  );
  return 0;
}

async function runAuthProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
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
  const format = (readFlag(args, '--format') ?? 'raw') as OutputFormat;

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

  printByFormat(environments.data ?? [], (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  const saved = await saveEnvironmentAlias(environment, configOptions);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(saved.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(environment.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
  return 0;
}

async function runEnvironmentRemove(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
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
    (readFlag(args, '--format') ?? 'json') as OutputFormat
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
    (readFlag(args, '--format') ?? 'json') as OutputFormat
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

    printByFormat(page.data ?? { records: [] }, (readFlag(args, '--format') ?? 'json') as OutputFormat);
    return 0;
  }

  const result = hasFlag(args, '--all')
    ? await resolution.data.client.queryAll<Record<string, unknown>>(queryOptions)
    : await resolution.data.client.query<Record<string, unknown>>(queryOptions);

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data ?? [], (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  const result = await resolution.data.client.delete(table, id, {
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
  return 0;
}

async function runDataverseMetadata(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(argumentFailure('DV_METADATA_ACTION_REQUIRED', 'Use `dv metadata tables` or `dv metadata table <logicalName>`.'));
  }

  if (action === 'tables') {
    return runDataverseMetadataTables(args);
  }

  if (action === 'table') {
    return runDataverseMetadataTable(args);
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
  printByFormat(result.data ?? [], (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data ?? [], (readFlag(args, '--format') ?? 'json') as OutputFormat);
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

  printByFormat(result.data, (readFlag(args, '--format') ?? 'json') as OutputFormat);
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
  switch (format) {
    case 'raw':
      process.stdout.write(typeof value === 'string' ? value + '\n' : stableStringify(value as never) + '\n');
      break;
    case 'markdown':
      process.stdout.write(typeof value === 'string' ? value + '\n' : stableStringify(value as never) + '\n');
      break;
    case 'table':
      process.stdout.write(stableStringify(value as never) + '\n');
      break;
    case 'json':
    default:
      process.stdout.write(stableStringify(value as never) + '\n');
      break;
  }
}

function printFailure(result: OperationResult<unknown>): number {
  const diagnostics = [...result.diagnostics, ...result.warnings];

  for (const diagnostic of diagnostics) {
    process.stderr.write(`${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}\n`);
  }

  return 1;
}

function printWarnings(result: OperationResult<unknown>): void {
  for (const warning of result.warnings) {
    process.stderr.write(`${warning.level.toUpperCase()} ${warning.code}: ${warning.message}\n`);
  }
}

function readConfigOptions(args: string[]): ConfigStoreOptions {
  const configDir = readFlag(args, '--config-dir');
  return configDir ? { configDir } : {};
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

function readListFlag(args: string[], name: string): string[] | undefined {
  const value = readFlag(args, name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

function readNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
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
      index += 1;
      continue;
    }

    positional.push(current);
  }

  return positional;
}

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
      '',
      '  solution list --env ALIAS [--config-dir path]',
      '  solution inspect <uniqueName> --env ALIAS [--config-dir path]',
      '',
      '  project inspect [path] [--format json|markdown|table]',
      '  analysis report [path] [--format json|markdown]',
      '  analysis context [--project path] [--asset assetRef] [--format json|markdown]',
      '  deploy plan [--project path] [--format json|markdown]',
    ].join('\n') + '\n'
  );
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
