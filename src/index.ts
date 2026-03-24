#!/usr/bin/env node

import process from 'node:process';
import { AuthService, summarizeProfile } from './auth.js';
import { getEnvironment, listEnvironments, removeEnvironment, saveAuthProfile, type AuthProfile } from './config.js';
import { migrateLegacyConfig } from './migrate.js';
import { addEnvironmentWithDiscovery, executeRequest, resourceForApi, type ApiKind } from './request.js';
import {
  argumentFailure,
  hasFlag,
  positionalArgs,
  printFailure,
  printResult,
  readBody,
  readConfigOptions,
  readFlag,
  readHeaderFlags,
  readQueryFlags,
} from './cli-utils.js';
import { startPpMcpServer } from './mcp.js';

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case 'auth':
      return runAuth(rest);
    case 'env':
      return runEnv(rest);
    case 'request':
      return runRequest(rest);
    case 'whoami':
      return runWhoAmI(rest);
    case 'ping':
      return runPing(rest);
    case 'token':
      return runEnvironmentToken(rest);
    case 'dv':
      return runApiAlias('dv', rest);
    case 'flow':
      return runApiAlias('flow', rest);
    case 'graph':
      return runApiAlias('graph', rest);
    case 'mcp':
      await startPpMcpServer({
        configDir: readFlag(rest, '--config-dir'),
        allowInteractiveAuth: hasFlag(rest, '--allow-interactive-auth'),
      });
      return 0;
    case 'migrate-config':
      return runMigrateConfig(rest);
    case 'completion':
      return runCompletion(rest);
    case 'help':
    case '--help':
    case undefined:
      printHelp();
      return 0;
    default:
      printHelp();
      return 1;
  }
}

async function runAuth(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  const configOptions = readConfigOptions(rest);
  const auth = new AuthService(configOptions);

  if (subcommand === 'profile') {
    const [profileCommand, ...profileArgs] = rest;
    if (profileCommand === 'list') {
      const result = await auth.listProfiles();
      if (!result.success) return printFailure(result, profileArgs);
      printResult((result.data ?? []).map(summarizeProfile), profileArgs);
      return 0;
    }
    if (profileCommand === 'inspect') {
      const name = positionalArgs(profileArgs)[0];
      if (!name) return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Usage: pp auth profile inspect <name>'), profileArgs);
      const result = await auth.getProfile(name);
      if (!result.success || !result.data) return printFailure(result.success ? argumentFailure('AUTH_PROFILE_NOT_FOUND', `Profile ${name} was not found.`) : result, profileArgs);
      printResult(summarizeProfile(result.data), profileArgs);
      return 0;
    }
    if (profileCommand === 'remove') {
      const name = positionalArgs(profileArgs)[0];
      if (!name) return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Usage: pp auth profile remove <name>'), profileArgs);
      const result = await auth.removeProfile(name);
      if (!result.success) return printFailure(result, profileArgs);
      printResult({ removed: result.data }, profileArgs);
      return 0;
    }
    if (profileCommand && profileCommand.startsWith('add-')) {
      const name = positionalArgs(profileArgs)[0];
      if (!name) return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', `Usage: pp auth profile ${profileCommand} <name> [flags]`), profileArgs);
      const common = {
        name,
        description: readFlag(profileArgs, '--description'),
        tenantId: readFlag(profileArgs, '--tenant-id'),
        clientId: readFlag(profileArgs, '--client-id'),
        loginHint: readFlag(profileArgs, '--login-hint'),
      };
      let profile: AuthProfile;
      switch (profileCommand) {
        case 'add-user':
          profile = {
            ...common,
            type: 'user',
            prompt: readFlag(profileArgs, '--prompt') as AuthProfile extends { prompt?: infer T } ? T : never,
            fallbackToDeviceCode: hasFlag(profileArgs, '--device-code-fallback'),
          };
          break;
        case 'add-device-code':
          profile = { ...common, type: 'device-code' };
          break;
        case 'add-client-secret': {
          const clientSecretEnv = readFlag(profileArgs, '--client-secret-env');
          if (!common.tenantId || !common.clientId || !clientSecretEnv) {
            return printFailure(argumentFailure('AUTH_CLIENT_SECRET_FLAGS_REQUIRED', 'Usage: pp auth profile add-client-secret <name> --tenant-id TENANT --client-id CLIENT --client-secret-env ENV_VAR'), profileArgs);
          }
          profile = { ...common, type: 'client-secret', tenantId: common.tenantId, clientId: common.clientId, clientSecretEnv };
          break;
        }
        case 'add-env': {
          const environmentVariable = readFlag(profileArgs, '--env-var');
          if (!environmentVariable) {
            return printFailure(argumentFailure('AUTH_ENV_VAR_REQUIRED', 'Usage: pp auth profile add-env <name> --env-var ENV_VAR'), profileArgs);
          }
          profile = { ...common, type: 'environment-token', environmentVariable };
          break;
        }
        case 'add-static': {
          const token = readFlag(profileArgs, '--token');
          if (!token) {
            return printFailure(argumentFailure('AUTH_TOKEN_REQUIRED', 'Usage: pp auth profile add-static <name> --token TOKEN'), profileArgs);
          }
          profile = { ...common, type: 'static-token', token };
          break;
        }
        default:
          return 1;
      }
      const result = await saveAuthProfile(profile, configOptions);
      if (!result.success) return printFailure(result, profileArgs);
      printResult(summarizeProfile(result.data!), profileArgs);
      return 0;
    }
  }

  if (subcommand === 'login') {
    const name = positionalArgs(rest)[0];
    const resource = readFlag(rest, '--resource');
    if (!name || !resource) {
      return printFailure(argumentFailure('AUTH_LOGIN_USAGE', 'Usage: pp auth login <name> --resource URL [--device-code] [--force-prompt] [--no-interactive-auth]'), rest);
    }
    const result = await auth.login(name, resource, {
      preferredFlow: hasFlag(rest, '--device-code') ? 'device-code' : 'interactive',
      forcePrompt: hasFlag(rest, '--force-prompt'),
      allowInteractive: !hasFlag(rest, '--no-interactive-auth'),
    });
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }

  if (subcommand === 'token') {
    const name = positionalArgs(rest)[0];
    const resource = readFlag(rest, '--resource');
    if (!name || !resource) {
      return printFailure(argumentFailure('AUTH_TOKEN_USAGE', 'Usage: pp auth token <name> --resource URL [--device-code] [--no-interactive-auth]'), rest);
    }
    const result = await auth.getToken(name, resource, {
      preferredFlow: hasFlag(rest, '--device-code') ? 'device-code' : 'interactive',
      allowInteractive: !hasFlag(rest, '--no-interactive-auth'),
    });
    if (!result.success || !result.data) return printFailure(result, rest);
    process.stdout.write(`${result.data}\n`);
    return 0;
  }

  printAuthHelp();
  return 1;
}

async function runEnv(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  const configOptions = readConfigOptions(rest);
  if (subcommand === 'list') {
    const result = await listEnvironments(configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult(result.data ?? [], rest);
    return 0;
  }
  if (subcommand === 'inspect') {
    const alias = positionalArgs(rest)[0];
    if (!alias) return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env inspect <alias>'), rest);
    const result = await getEnvironment(alias, configOptions);
    if (!result.success || !result.data) return printFailure(result.success ? argumentFailure('ENV_NOT_FOUND', `Environment ${alias} was not found.`) : result, rest);
    printResult(result.data, rest);
    return 0;
  }
  if (subcommand === 'add') {
    const alias = positionalArgs(rest)[0];
    const dataverseUrl = readFlag(rest, '--url');
    const authProfile = readFlag(rest, '--profile');
    if (!alias || !dataverseUrl || !authProfile) {
      return printFailure(argumentFailure('ENV_ADD_USAGE', 'Usage: pp env add <alias> --url URL --profile PROFILE [--display-name NAME] [--access read-only|read-write]'), rest);
    }
    const result = await addEnvironmentWithDiscovery(
      {
        alias,
        dataverseUrl,
        authProfile,
        displayName: readFlag(rest, '--display-name'),
        accessMode: readFlag(rest, '--access') as 'read-only' | 'read-write' | undefined,
      },
      configOptions,
      { allowInteractive: !hasFlag(rest, '--no-interactive-auth') },
    );
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }
  if (subcommand === 'remove') {
    const alias = positionalArgs(rest)[0];
    if (!alias) return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env remove <alias>'), rest);
    const result = await removeEnvironment(alias, configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult({ removed: result.data }, rest);
    return 0;
  }
  printEnvHelp();
  return 1;
}

async function runRequest(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const positionalApi = positional[0] && isApiKind(positional[0]) ? positional[0] : undefined;
  const path = positionalApi ? positional[1] : positional[0];
  const environmentAlias = readFlag(args, '--environment');
  if (!path || !environmentAlias) {
    return printFailure(argumentFailure('REQUEST_USAGE', 'Usage: pp request [dv|flow|graph|custom] <path|url> --environment ALIAS [--api dv|flow|graph|custom] [--method METHOD] [--query k=v] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--read]'), args);
  }
  const body = await readBody(args);
  if (!body.success) return printFailure(body, args);
  const result = await executeRequest({
    environmentAlias,
    path,
    method: readFlag(args, '--method') ?? 'GET',
    api: positionalApi ?? (readFlag(args, '--api') as ApiKind | undefined),
    query: readQueryFlags(args),
    headers: readHeaderFlags(args),
    body: body.data?.body,
    rawBody: body.data?.rawBody,
    responseType: (readFlag(args, '--response-type') as 'json' | 'text' | 'void' | undefined) ?? 'json',
    timeoutMs: readFlag(args, '--timeout-ms') ? Number(readFlag(args, '--timeout-ms')) : undefined,
    readIntent: hasFlag(args, '--read'),
    configOptions: readConfigOptions(args),
    loginOptions: { allowInteractive: !hasFlag(args, '--no-interactive-auth') },
  });
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runApiAlias(api: Exclude<ApiKind, 'custom'>, args: string[]): Promise<number> {
  return runRequest([...args, '--api', api]);
}

async function runWhoAmI(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  if (!environmentAlias) {
    return printFailure(argumentFailure('WHOAMI_USAGE', 'Usage: pp whoami --environment ALIAS'), args);
  }
  const result = await executeRequest({
    environmentAlias,
    api: 'dv',
    path: '/WhoAmI',
    method: 'POST',
    responseType: 'json',
    readIntent: true,
    configOptions: readConfigOptions(args),
    loginOptions: { allowInteractive: !hasFlag(args, '--no-interactive-auth') },
  });
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runPing(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  const api = (readFlag(args, '--api') as Exclude<ApiKind, 'custom'> | undefined) ?? 'dv';
  if (!environmentAlias) {
    return printFailure(argumentFailure('PING_USAGE', 'Usage: pp ping --environment ALIAS [--api dv|flow|graph]'), args);
  }
  const common = {
    environmentAlias,
    api,
    responseType: 'json' as const,
    configOptions: readConfigOptions(args),
    loginOptions: { allowInteractive: !hasFlag(args, '--no-interactive-auth') },
  };
  const result =
    api === 'dv'
      ? await executeRequest({
          ...common,
          path: '/WhoAmI',
          method: 'POST',
          readIntent: true,
        })
      : api === 'flow'
        ? await executeRequest({
            ...common,
            path: '/flows',
            method: 'GET',
            query: { 'api-version': '2016-11-01', '$top': '1' },
          })
        : await executeRequest({
            ...common,
            path: '/organization',
            method: 'GET',
            query: { '$top': '1' },
          });

  if (!result.success || !result.data) return printFailure(result, args);
  printResult(
    {
      ok: true,
      api,
      environment: environmentAlias,
      status: result.data.status,
      request: result.data.request,
    },
    args,
  );
  return 0;
}

async function runEnvironmentToken(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  const api = (readFlag(args, '--api') as Exclude<ApiKind, 'custom'> | undefined) ?? 'dv';
  const configOptions = readConfigOptions(args);
  if (!environmentAlias) {
    return printFailure(argumentFailure('TOKEN_USAGE', 'Usage: pp token --environment ALIAS [--api dv|flow|graph] [--device-code] [--no-interactive-auth]'), args);
  }

  const environment = await getEnvironment(environmentAlias, configOptions);
  if (!environment.success || !environment.data) {
    return printFailure(
      environment.success ? argumentFailure('ENV_NOT_FOUND', `Environment ${environmentAlias} was not found.`) : environment,
      args,
    );
  }

  const auth = new AuthService(configOptions);
  const result = await auth.getToken(environment.data.authProfile, resourceForApi(environment.data, api), {
    preferredFlow: hasFlag(args, '--device-code') ? 'device-code' : 'interactive',
    allowInteractive: !hasFlag(args, '--no-interactive-auth'),
  });
  if (!result.success || !result.data) return printFailure(result, args);
  process.stdout.write(`${result.data}\n`);
  return 0;
}

function runCompletion(args: string[]): number {
  const shell = positionalArgs(args)[0] ?? 'zsh';
  if (shell === 'bash') {
    process.stdout.write('complete -W "auth env request whoami ping token dv flow graph mcp migrate-config completion help" pp\n');
    return 0;
  }
  process.stdout.write('#compdef pp\n_arguments "1: :((auth env request whoami ping token dv flow graph mcp migrate-config completion help))"\n');
  return 0;
}

async function runMigrateConfig(args: string[]): Promise<number> {
  const result = await migrateLegacyConfig({
    sourceConfigPath: readFlag(args, '--source-config'),
    sourceDir: readFlag(args, '--source-dir'),
    targetConfigOptions: readConfigOptions(args),
    apply: hasFlag(args, '--apply'),
  });
  if (!result.success || !result.data) return printFailure(result, args);

  printResult(
    {
      ...result.data,
      note: hasFlag(args, '--apply')
        ? 'Migration applied. MSAL token cache stays in place.'
        : 'Dry run only. Re-run with --apply to write the migrated config. MSAL token cache stays in place.',
    },
    args,
  );
  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      'pp',
      '',
      'Commands:',
      '  auth',
      '  env',
      '  request',
      '  whoami',
      '  ping',
      '  token',
      '  dv',
      '  flow',
      '  graph',
      '  mcp',
      '  migrate-config',
      '  completion',
    ].join('\n') + '\n',
  );
}

function printAuthHelp(): void {
  process.stdout.write(
    [
      'pp auth',
      '',
      'Commands:',
      '  profile list',
      '  profile inspect <name>',
      '  profile add-user <name>',
      '  profile add-device-code <name>',
      '  profile add-client-secret <name> --tenant-id --client-id --client-secret-env',
      '  profile add-env <name> --env-var',
      '  profile add-static <name> --token',
      '  profile remove <name>',
      '  login <name> --resource URL',
      '  token <name> --resource URL',
    ].join('\n') + '\n',
  );
}

function printEnvHelp(): void {
  process.stdout.write(
    [
      'pp env',
      '',
      'Commands:',
      '  list',
      '  inspect <alias>',
      '  add <alias> --url URL --profile PROFILE [--access read-only|read-write]',
      '  remove <alias>',
    ].join('\n') + '\n',
  );
}

function isApiKind(value: string): value is ApiKind {
  return value === 'dv' || value === 'flow' || value === 'graph' || value === 'custom';
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
