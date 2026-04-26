#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import type { LoginAccountInput } from './auth.js';
import { readCanvasYamlDirectory, readCanvasYamlFetchFiles, writeCanvasYamlFiles } from './canvas-yaml-files.js';
import { migrateLegacyConfig } from './migrate.js';
import { detectApi, isAccountScopedApi, isApiKind, isEnvironmentTokenApi, type ApiKind, type EnvironmentTokenApi } from './request.js';
import { argumentFailure, hasFlag, positionalArgs, printFailure, printResult, readBody, readConfigOptions, readFlag, readHeaderFlags, readQueryFlags } from './cli-utils.js';
import { startPpMcpServer } from './mcp.js';
import { inspectAccountSummary, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { executeApiRequest, getEnvironmentToken, runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { invokeCanvasAuthoring, probeAndCleanCanvasSessions, requestCanvasAuthoringSession, rpcCanvasAuthoring, saveCanvasSession, startCanvasAuthoringSession } from './services/canvas-authoring.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, inspectConfiguredEnvironment, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';
import { VERSION } from './version.js';
import { getCachedUpdateCheck, formatUpdateNotice, runBackgroundUpdateCheck, runUpdateCommand, shouldRunBackgroundUpdateCheck, shouldShowUpdateNotice } from './update.js';
import { runSetupCli } from './setup-cli.js';

const TOP_LEVEL_COMMANDS = [
  'auth',
  'env',
  'request',
  'whoami',
  'ping',
  'token',
  'dv',
  'flow',
  'graph',
  'sharepoint',
  'sp',
  'bap',
  'powerapps',
  'canvas-authoring',
  'mcp',
  'setup',
  'migrate-config',
  'update',
  'version',
  'completion',
  'help'
];

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const checkPassiveUpdates = shouldShowUpdateNotice(command);
  const updateNoticePromise = checkPassiveUpdates ? getCachedUpdateCheck() : Promise.resolve(null);

  const exitCode = await runCommand(command, rest);

  const cached = await updateNoticePromise;
  if (cached?.updateAvailable) {
    process.stderr.write(`${formatUpdateNotice(cached)}\n`);
  }
  if (shouldRunBackgroundUpdateCheck(command, cached)) {
    runBackgroundUpdateCheck();
  }

  return exitCode;
}

async function runCommand(command: string | undefined, rest: string[]): Promise<number> {
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
      return runFlow(rest);
    case 'graph':
      return runApiAlias('graph', rest);
    case 'sharepoint':
    case 'sp':
      return runApiAlias('sharepoint', rest);
    case 'bap':
      return runApiAlias('bap', rest);
    case 'powerapps':
      return runApiAlias('powerapps', rest);
    case 'canvas-authoring':
      return runCanvasAuthoring(rest);
    case 'mcp':
      if (isHelpToken(rest[0])) {
        printMcpHelp();
        return 0;
      }
      await startPpMcpServer({
        ...readConfigOptions(rest),
        allowInteractiveAuth: hasFlag(rest, '--allow-interactive-auth')
      });
      return 0;
    case 'setup':
      return runSetupCli(rest);
    case 'migrate-config':
      return runMigrateConfig(rest);
    case 'update':
      return runUpdateCommand(rest);
    case 'version':
    case '--version':
      process.stdout.write(`pp ${VERSION}\n`);
      return 0;
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
  if (args.length === 0 || isHelpToken(args[0])) {
    printAuthHelp();
    return 0;
  }

  const [subcommand, ...rest] = args;
  const configOptions = readConfigOptions(rest);

  if (subcommand === 'list') {
    if (wantsHelp(rest)) {
      printAuthListHelp();
      return 0;
    }
    const result = await listAccountSummaries(configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult(result.data ?? [], rest);
    return 0;
  }

  if (subcommand === 'inspect') {
    if (wantsHelp(rest)) {
      printAuthInspectHelp();
      return 0;
    }
    const name = positionalArgs(rest)[0];
    if (!name) return printFailure(argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth inspect <account>'), rest);
    const result = await inspectAccountSummary(name, configOptions);
    if (!result.success || !result.data) {
      return printFailure(result.success ? argumentFailure('ACCOUNT_NOT_FOUND', `Account ${name} was not found.`) : result, rest);
    }
    printResult(result.data, rest);
    return 0;
  }

  if (subcommand === 'remove') {
    if (wantsHelp(rest)) {
      printAuthRemoveHelp();
      return 0;
    }
    const name = positionalArgs(rest)[0];
    if (!name) return printFailure(argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth remove <account>'), rest);
    const result = await removeAccountByName(name, configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }

  if (subcommand === 'login') {
    if (wantsHelp(rest)) {
      printAuthLoginHelp();
      return 0;
    }
    const loginInput = readLoginInput(rest);
    if (!loginInput.success || !loginInput.data) return printFailure(loginInput, rest);
    const result = await loginAccount(
      loginInput.data,
      {
        preferredFlow: hasFlag(rest, '--device-code') ? 'device-code' : 'interactive',
        forcePrompt: hasFlag(rest, '--force-prompt'),
        allowInteractive: !hasFlag(rest, '--no-interactive-auth')
      },
      configOptions
    );
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }

  printAuthHelp();
  return 1;
}

async function runEnv(args: string[]): Promise<number> {
  if (args.length === 0 || isHelpToken(args[0])) {
    printEnvHelp();
    return 0;
  }

  const [subcommand, ...rest] = args;
  const configOptions = readConfigOptions(rest);
  if (subcommand === 'list') {
    if (wantsHelp(rest)) {
      printEnvListHelp();
      return 0;
    }
    const result = await listConfiguredEnvironments(configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult(result.data ?? [], rest);
    return 0;
  }
  if (subcommand === 'inspect') {
    if (wantsHelp(rest)) {
      printEnvInspectHelp();
      return 0;
    }
    const alias = positionalArgs(rest)[0];
    if (!alias) return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env inspect <alias>'), rest);
    const result = await inspectConfiguredEnvironment(alias, configOptions);
    if (!result.success || !result.data) return printFailure(result.success ? argumentFailure('ENV_NOT_FOUND', `Environment ${alias} was not found.`) : result, rest);
    printResult(result.data, rest);
    return 0;
  }
  if (subcommand === 'add') {
    if (wantsHelp(rest)) {
      printEnvAddHelp();
      return 0;
    }
    const alias = positionalArgs(rest)[0];
    const url = readFlag(rest, '--url');
    const account = readFlag(rest, '--account');
    if (!alias || !url || !account) {
      return printFailure(
        argumentFailure('ENV_ADD_USAGE', 'Usage: pp env add <alias> --url URL --account ACCOUNT [--display-name NAME] [--access read-only|read-write] [--no-interactive-auth]'),
        rest
      );
    }
    const result = await addConfiguredEnvironment(
      {
        alias,
        url,
        account,
        displayName: readFlag(rest, '--display-name'),
        accessMode: readFlag(rest, '--access') as 'read-only' | 'read-write' | undefined
      },
      configOptions,
      { allowInteractive: !hasFlag(rest, '--no-interactive-auth') }
    );
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }
  if (subcommand === 'discover') {
    if (wantsHelp(rest)) {
      printEnvDiscoverHelp();
      return 0;
    }
    const account = positionalArgs(rest)[0] ?? readFlag(rest, '--account');
    if (!account) {
      return printFailure(argumentFailure('ENV_DISCOVER_USAGE', 'Usage: pp env discover <account> [--no-interactive-auth]'), rest);
    }
    const result = await discoverAccessibleEnvironments(account, configOptions, { allowInteractive: !hasFlag(rest, '--no-interactive-auth') });
    if (!result.success) return printFailure(result, rest);
    printResult(result.data ?? [], rest);
    return 0;
  }
  if (subcommand === 'remove') {
    if (wantsHelp(rest)) {
      printEnvRemoveHelp();
      return 0;
    }
    const alias = positionalArgs(rest)[0];
    if (!alias) return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env remove <alias>'), rest);
    const result = await removeConfiguredEnvironment(alias, configOptions);
    if (!result.success) return printFailure(result, rest);
    printResult(result.data, rest);
    return 0;
  }
  printEnvHelp();
  return 1;
}

async function runRequest(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printRequestHelp();
    return 0;
  }

  const positional = positionalArgs(args);
  const positionalApi = positional[0] && isApiKind(positional[0]) ? positional[0] : undefined;
  const apiFlag = readFlag(args, '--api');
  if (apiFlag && !isApiKind(apiFlag)) {
    return printFailure(
      argumentFailure(
        'REQUEST_USAGE',
        'Usage: pp request [dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] <path|url> [--env ALIAS|--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] [--method METHOD] [--query k=v] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--jq EXPR] [--read]'
      ),
      args
    );
  }
  const validatedApiFlag: ApiKind | undefined = apiFlag && isApiKind(apiFlag) ? apiFlag : undefined;
  const api = positionalApi ?? validatedApiFlag;
  const path = positionalApi ? positional[1] : positional[0];
  const effectiveApi = api ?? (path ? detectApi(path) : undefined);
  const environmentAlias = readFlag(args, '--environment');
  const accountName = readFlag(args, '--account');
  if (!path || (!environmentAlias && !(effectiveApi && isAccountScopedApi(effectiveApi) && accountName))) {
    return printFailure(
      argumentFailure(
        'REQUEST_USAGE',
        'Usage: pp request [dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] <path|url> [--env ALIAS|--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] [--method METHOD] [--query k=v] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--jq EXPR] [--read]'
      ),
      args
    );
  }
  const body = await readBody(args);
  if (!body.success) return printFailure(body, args);
  const requestInput = {
    environmentAlias,
    accountName,
    path,
    method: readFlag(args, '--method') ?? 'GET',
    api: effectiveApi,
    query: readQueryFlags(args),
    headers: readHeaderFlags(args),
    body: body.data?.body,
    rawBody: body.data?.rawBody,
    responseType: (readFlag(args, '--response-type') as 'json' | 'text' | 'void' | undefined) ?? 'json',
    timeoutMs: readFlag(args, '--timeout-ms') ? Number(readFlag(args, '--timeout-ms')) : undefined,
    jq: readFlag(args, '--jq'),
    readIntent: hasFlag(args, '--read')
  };
  const result = await executeApiRequest(requestInput, readConfigOptions(args), { allowInteractive: !hasFlag(args, '--no-interactive-auth') });
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runApiAlias(api: Exclude<ApiKind, 'custom'>, args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printRequestAliasHelp(api);
    return 0;
  }
  return runRequest([...args, '--api', api]);
}

async function runCanvasAuthoring(args: string[]): Promise<number> {
  if (args.length === 0 || isHelpToken(args[0])) {
    printCanvasAuthoringHelp();
    return 0;
  }

  const [subcommand, ...rest] = args;
  if (subcommand === 'invoke') {
    if (wantsHelp(rest)) {
      printCanvasAuthoringInvokeHelp();
      return 0;
    }
    return runCanvasAuthoringInvoke(rest);
  }
  if (subcommand === 'rpc') {
    if (wantsHelp(rest)) {
      printCanvasAuthoringRpcHelp();
      return 0;
    }
    return runCanvasAuthoringRpc(rest);
  }
  if (subcommand === 'yaml') {
    return runCanvasAuthoringYaml(rest);
  }
  if (subcommand === 'controls') {
    return runCanvasAuthoringNamedEndpoint(rest, 'controls');
  }
  if (subcommand === 'apis') {
    return runCanvasAuthoringNamedEndpoint(rest, 'apis');
  }
  if (subcommand === 'datasources') {
    return runCanvasAuthoringNamedEndpoint(rest, 'datasources');
  }
  if (subcommand === 'accessibility') {
    if (wantsHelp(rest)) {
      printCanvasAuthoringAccessibilityHelp();
      return 0;
    }
    return runCanvasAuthoringSessionRequest([...rest, '--path', '/api/yaml/accessibility-errors', '--read']);
  }
  if (subcommand !== 'session') {
    return runApiAlias('canvas-authoring', args);
  }
  if (rest.length === 0 || isHelpToken(rest[0])) {
    printCanvasAuthoringSessionHelp();
    return 0;
  }

  const [sessionCommand, ...sessionArgs] = rest;
  if (sessionCommand === 'request') {
    if (wantsHelp(sessionArgs)) {
      printCanvasAuthoringSessionRequestHelp();
      return 0;
    }
    return runCanvasAuthoringSessionRequest(sessionArgs);
  }
  if (sessionCommand === 'list') {
    return runCanvasAuthoringSessionList(sessionArgs);
  }
  if (sessionCommand !== 'start') {
    printCanvasAuthoringSessionHelp();
    return 1;
  }
  if (wantsHelp(sessionArgs)) {
    printCanvasAuthoringSessionStartHelp();
    return 0;
  }

  const environmentAlias = readFlag(sessionArgs, '--environment');
  const appId = readFlag(sessionArgs, '--app') ?? positionalArgs(sessionArgs)[0];
  if (!environmentAlias || !appId) {
    return printFailure(
      argumentFailure(
        'CANVAS_AUTHORING_SESSION_START_USAGE',
        'Usage: pp canvas-authoring session start --env ALIAS --app APP_ID [--account ACCOUNT] [--cadence Frequent] [--cluster-category prod] [--raw] [--no-interactive-auth]'
      ),
      sessionArgs
    );
  }

  const configOptions = readConfigOptions(sessionArgs);
  const result = await startCanvasAuthoringSession(
    {
      environmentAlias,
      accountName: readFlag(sessionArgs, '--account'),
      appId,
      cadence: readFlag(sessionArgs, '--cadence'),
      clusterCategory: readFlag(sessionArgs, '--cluster-category'),
      raw: hasFlag(sessionArgs, '--raw'),
      allowInteractive: !hasFlag(sessionArgs, '--no-interactive-auth')
    },
    configOptions
  );
  if (!result.success || !result.data) return printFailure(result, sessionArgs);
  await saveCanvasSession(result.data, environmentAlias, configOptions);
  printResult(result.data, sessionArgs);
  return 0;
}

async function runCanvasAuthoringSessionList(args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);
  const sessions = await probeAndCleanCanvasSessions(configOptions);
  printResult(sessions, args);
  return 0;
}

async function runCanvasAuthoringInvoke(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  const appId = readFlag(args, '--app');
  const className = readFlag(args, '--class') ?? readFlag(args, '--classname');
  const oid = readFlag(args, '--oid');
  const methodName = readFlag(args, '--method-name') ?? readFlag(args, '--method');
  if (!environmentAlias || !appId || !className || !oid || !methodName) {
    return printFailure(
      argumentFailure(
        'CANVAS_AUTHORING_INVOKE_USAGE',
        'Usage: pp canvas-authoring invoke --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--sequence N --confirmation N] [--session-id ID --session-state STATE --authoring-base-url URL --web-authoring-version VERSION] [--account ACCOUNT] [--no-interactive-auth]'
      ),
      args
    );
  }

  const payload = await readJsonPayload(args);
  if (!payload.success) return printFailure(payload, args);

  const result = await invokeCanvasAuthoring(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      appId,
      className,
      oid,
      methodName,
      payload: payload.data,
      sessionId: readFlag(args, '--session-id'),
      sessionState: readFlag(args, '--session-state'),
      authoringBaseUrl: readFlag(args, '--authoring-base-url'),
      webAuthoringVersion: readFlag(args, '--web-authoring-version'),
      sequence: readFlag(args, '--sequence') ? Number(readFlag(args, '--sequence')) : undefined,
      confirmation: readFlag(args, '--confirmation') ? Number(readFlag(args, '--confirmation')) : undefined,
      cadence: readFlag(args, '--cadence'),
      clusterCategory: readFlag(args, '--cluster-category'),
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runCanvasAuthoringRpc(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  const appId = readFlag(args, '--app');
  const className = readFlag(args, '--class') ?? readFlag(args, '--classname');
  const oid = readFlag(args, '--oid');
  const methodName = readFlag(args, '--method-name') ?? readFlag(args, '--method');
  if (!environmentAlias || !appId || !className || !oid || !methodName) {
    return printFailure(
      argumentFailure(
        'CANVAS_AUTHORING_RPC_USAGE',
        'Usage: pp canvas-authoring rpc --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--timeout-ms MS] [--sequence N --confirmation N] [--session-id ID --session-state STATE --authoring-base-url URL --web-authoring-version VERSION] [--account ACCOUNT] [--no-interactive-auth]'
      ),
      args
    );
  }

  const payload = await readJsonPayload(args);
  if (!payload.success) return printFailure(payload, args);

  const result = await rpcCanvasAuthoring(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      appId,
      className,
      oid,
      methodName,
      payload: payload.data,
      sessionId: readFlag(args, '--session-id'),
      sessionState: readFlag(args, '--session-state'),
      authoringBaseUrl: readFlag(args, '--authoring-base-url'),
      webAuthoringVersion: readFlag(args, '--web-authoring-version'),
      sequence: readFlag(args, '--sequence') ? Number(readFlag(args, '--sequence')) : undefined,
      confirmation: readFlag(args, '--confirmation') ? Number(readFlag(args, '--confirmation')) : undefined,
      cadence: readFlag(args, '--cadence'),
      clusterCategory: readFlag(args, '--cluster-category'),
      timeoutMs: readFlag(args, '--timeout-ms') ? Number(readFlag(args, '--timeout-ms')) : undefined,
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runCanvasAuthoringSessionRequest(args: string[]): Promise<number> {
  const environmentAlias = readFlag(args, '--environment');
  const appId = readFlag(args, '--app');
  const path = readFlag(args, '--path') ?? positionalArgs(args)[0];
  if (!environmentAlias || !appId || !path) {
    return printFailure(
      argumentFailure(
        'CANVAS_AUTHORING_SESSION_REQUEST_USAGE',
        'Usage: pp canvas-authoring session request --env ALIAS --app APP_ID --path PATH [--method METHOD] [--body JSON|--body-file FILE] [--response-type json|text|void] [--read]'
      ),
      args
    );
  }
  const body = await readBody(args);
  if (!body.success) return printFailure(body, args);
  const result = await requestCanvasAuthoringSession(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      appId,
      path,
      method: readFlag(args, '--method'),
      body: body.data?.body,
      rawBody: body.data?.rawBody,
      responseType: readFlag(args, '--response-type') as 'json' | 'text' | 'void' | undefined,
      sessionId: readFlag(args, '--session-id'),
      sessionState: readFlag(args, '--session-state'),
      authoringBaseUrl: readFlag(args, '--authoring-base-url'),
      webAuthoringVersion: readFlag(args, '--web-authoring-version'),
      cadence: readFlag(args, '--cadence'),
      clusterCategory: readFlag(args, '--cluster-category'),
      readIntent: hasFlag(args, '--read'),
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runCanvasAuthoringYaml(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || isHelpToken(command)) {
    printCanvasAuthoringYamlHelp();
    return 0;
  }
  if (command === 'fetch') return runCanvasAuthoringYamlFetch(rest);
  if (command === 'validate') return runCanvasAuthoringYamlValidate(rest);
  printCanvasAuthoringYamlHelp();
  return 1;
}

async function runCanvasAuthoringYamlFetch(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printCanvasAuthoringYamlFetchHelp();
    return 0;
  }
  const result = await requestKnownCanvasAuthoringEndpoint(args, '/api/yaml/fetch', 'GET', undefined, true);
  if (!result.success) return printFailure(result, args);
  const outDir = readFlag(args, '--out');
  if (outDir) {
    const writeResult = await writeYamlFetchFiles(result.data?.response, outDir);
    if (!writeResult.success) return printFailure(writeResult, args);
    printResult({ ...result.data, written: writeResult.data }, args);
    return 0;
  }
  printResult(result.data, args);
  return 0;
}

async function runCanvasAuthoringYamlValidate(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printCanvasAuthoringYamlValidateHelp();
    return 0;
  }
  const dir = readFlag(args, '--dir');
  let body: unknown;
  if (dir) {
    const files = await readYamlDirectoryFiles(dir);
    if (!files.success) return printFailure(files, args);
    body = { files: files.data };
  } else {
    const parsed = await readBody(args);
    if (!parsed.success) return printFailure(parsed, args);
    body = parsed.data?.body ?? {};
  }
  const result = await requestKnownCanvasAuthoringEndpoint(args, '/api/yaml/validate-directory', 'POST', body, false, {
    keepSignalRAlive: hasFlag(args, '--with-signalr'),
    signalRTimeoutMs: readOptionalInt(args, '--signalr-timeout-ms')
  });
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runCanvasAuthoringNamedEndpoint(args: string[], endpoint: 'controls' | 'apis' | 'datasources'): Promise<number> {
  const [command, ...rest] = args;
  if (!command || isHelpToken(command)) {
    printCanvasAuthoringNamedEndpointHelp(endpoint);
    return 0;
  }
  if (command !== 'list' && command !== 'describe') {
    printCanvasAuthoringNamedEndpointHelp(endpoint);
    return 1;
  }
  const name = readFlag(rest, '--name') ?? positionalArgs(rest)[0];
  if (command === 'describe' && !name) {
    return printFailure(argumentFailure('CANVAS_AUTHORING_DESCRIBE_NAME_REQUIRED', `Usage: pp canvas-authoring ${endpoint} describe --env ALIAS --app APP_ID NAME`), rest);
  }
  const path = command === 'list' ? `/api/yaml/${endpoint}` : `/api/yaml/${endpoint}/${encodeURIComponent(name ?? '')}`;
  const result = await requestKnownCanvasAuthoringEndpoint(rest, path, 'GET', undefined, true);
  if (!result.success) return printFailure(result, rest);
  printResult(result.data, rest);
  return 0;
}

async function requestKnownCanvasAuthoringEndpoint(
  args: string[],
  path: string,
  method: string,
  body: unknown,
  readIntent: boolean,
  options: { keepSignalRAlive?: boolean; signalRTimeoutMs?: number } = {}
) {
  const environmentAlias = readFlag(args, '--environment');
  const appId = readFlag(args, '--app');
  if (!environmentAlias || !appId) {
    return argumentFailure('CANVAS_AUTHORING_ENDPOINT_USAGE', 'Usage requires --env ALIAS --app APP_ID.');
  }
  return requestCanvasAuthoringSession(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      appId,
      path,
      method,
      body,
      sessionId: readFlag(args, '--session-id'),
      sessionState: readFlag(args, '--session-state'),
      authoringBaseUrl: readFlag(args, '--authoring-base-url'),
      webAuthoringVersion: readFlag(args, '--web-authoring-version'),
      cadence: readFlag(args, '--cadence'),
      clusterCategory: readFlag(args, '--cluster-category'),
      readIntent,
      keepSignalRAlive: options.keepSignalRAlive,
      signalRTimeoutMs: options.signalRTimeoutMs,
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
}

async function readYamlDirectoryFiles(root: string) {
  try {
    const files = await readCanvasYamlDirectory(root);
    return { success: true as const, data: files, diagnostics: [] };
  } catch (error) {
    return argumentFailure('CANVAS_AUTHORING_YAML_DIR_READ_FAILED', `Failed to read YAML directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeYamlFetchFiles(response: unknown, outDir: string) {
  const files = readCanvasYamlFetchFiles(response);
  if (!files) return argumentFailure('CANVAS_AUTHORING_YAML_FETCH_SHAPE', 'YAML fetch response did not contain a files array.');
  try {
    const written = await writeCanvasYamlFiles(outDir, files);
    return { success: true as const, data: written, diagnostics: [] };
  } catch (error) {
    return argumentFailure('CANVAS_AUTHORING_YAML_WRITE_FAILED', `Failed to write YAML files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runFlow(args: string[]): Promise<number> {
  if (args.length === 0 || wantsHelp(args)) {
    printFlowHelp();
    return 0;
  }
  return runApiAlias('flow', args);
}

async function readJsonPayload(args: string[]) {
  const inline = readFlag(args, '--payload');
  const file = readFlag(args, '--payload-file');
  if (inline !== undefined && file !== undefined) {
    return argumentFailure('PAYLOAD_FLAGS_CONFLICT', 'Use either --payload or --payload-file, not both.');
  }
  try {
    if (inline !== undefined) return { success: true as const, data: JSON.parse(inline), diagnostics: [] };
    if (file !== undefined) return { success: true as const, data: JSON.parse(await readFile(file, 'utf8')), diagnostics: [] };
    return { success: true as const, data: {}, diagnostics: [] };
  } catch (error) {
    return argumentFailure('PAYLOAD_PARSE_FAILED', `Failed to parse payload JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runWhoAmI(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printWhoAmIHelp();
    return 0;
  }
  const environmentAlias = readFlag(args, '--environment');
  if (!environmentAlias) return printFailure(argumentFailure('WHOAMI_USAGE', 'Usage: pp whoami --env ALIAS [--account ACCOUNT] [--no-interactive-auth]'), args);
  const result = await runWhoAmICheck(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
  if (!result.success) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runPing(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printPingHelp();
    return 0;
  }
  const environmentAlias = readFlag(args, '--environment');
  const apiFlag = readFlag(args, '--api');
  if (apiFlag && !isEnvironmentTokenApi(apiFlag)) {
    return printFailure(argumentFailure('PING_USAGE', 'Usage: pp ping --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--no-interactive-auth]'), args);
  }
  const api: EnvironmentTokenApi = apiFlag && isEnvironmentTokenApi(apiFlag) ? apiFlag : 'dv';
  if (!environmentAlias)
    return printFailure(argumentFailure('PING_USAGE', 'Usage: pp ping --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--no-interactive-auth]'), args);
  const result = await runConnectivityPing(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      api,
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );

  if (!result.success || !result.data) return printFailure(result, args);
  printResult(result.data, args);
  return 0;
}

async function runEnvironmentToken(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printEnvironmentTokenHelp();
    return 0;
  }
  const environmentAlias = readFlag(args, '--environment');
  const apiFlag = readFlag(args, '--api');
  if (apiFlag && !isEnvironmentTokenApi(apiFlag)) {
    return printFailure(
      argumentFailure('TOKEN_USAGE', 'Usage: pp token --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--device-code] [--no-interactive-auth]'),
      args
    );
  }
  const api: EnvironmentTokenApi = apiFlag && isEnvironmentTokenApi(apiFlag) ? apiFlag : 'dv';
  if (!environmentAlias)
    return printFailure(
      argumentFailure('TOKEN_USAGE', 'Usage: pp token --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--device-code] [--no-interactive-auth]'),
      args
    );
  const result = await getEnvironmentToken(
    {
      environmentAlias,
      accountName: readFlag(args, '--account'),
      api,
      preferredFlow: hasFlag(args, '--device-code') ? 'device-code' : 'interactive',
      allowInteractive: !hasFlag(args, '--no-interactive-auth')
    },
    readConfigOptions(args)
  );
  if (!result.success || !result.data) return printFailure(result, args);
  process.stdout.write(`${result.data}\n`);
  return 0;
}

function runCompletion(args: string[]): number {
  if (wantsHelp(args)) {
    printCompletionHelp();
    return 0;
  }
  const shell = positionalArgs(args)[0] ?? 'zsh';
  const words = TOP_LEVEL_COMMANDS.join(' ');
  if (shell === 'powershell') {
    process.stdout.write(
      [
        '@(',
        `  ${TOP_LEVEL_COMMANDS.map((command) => `'${command}'`).join(',')}`,
        ') | ForEach-Object {',
        '  Register-ArgumentCompleter -CommandName pp -ScriptBlock { param($wordToComplete) $_ | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, \'ParameterValue\', $_) } }',
        '}'
      ].join('\n') + '\n'
    );
    return 0;
  }
  if (shell === 'bash') {
    process.stdout.write(`complete -W "${words}" pp\n`);
    return 0;
  }
  process.stdout.write(`#compdef pp\n_arguments "1: :((${words}))"\n`);
  return 0;
}

async function runMigrateConfig(args: string[]): Promise<number> {
  if (wantsHelp(args)) {
    printMigrateConfigHelp();
    return 0;
  }
  const result = await migrateLegacyConfig({
    sourceConfigPath: readFlag(args, '--source-config'),
    sourceDir: readFlag(args, '--source-dir'),
    targetConfigOptions: readConfigOptions(args),
    apply: hasFlag(args, '--apply')
  });
  if (!result.success || !result.data) return printFailure(result, args);
  printResult(
    {
      ...result.data,
      note: hasFlag(args, '--apply') ? 'Migration applied.' : 'Dry run only. Re-run with --apply to write the migrated config.'
    },
    args
  );
  return 0;
}

function readLoginInput(args: string[]) {
  const name = positionalArgs(args)[0];
  if (!name) return argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth login <account> [flags]');

  const usesClientSecret = hasFlag(args, '--client-secret');
  const usesEnvToken = hasFlag(args, '--env-token');
  const usesStaticToken = hasFlag(args, '--static-token');
  const usesDeviceCode = hasFlag(args, '--device-code');
  const usesBrowser = hasFlag(args, '--browser');
  const methodFlags = [usesClientSecret, usesEnvToken, usesStaticToken, usesDeviceCode, usesBrowser].filter(Boolean).length;
  if (methodFlags > 1) {
    return argumentFailure('AUTH_METHOD_CONFLICT', 'Choose at most one auth method: --browser, --device-code, --client-secret, --env-token, or --static-token.');
  }

  const input: LoginAccountInput = {
    name,
    kind: usesClientSecret ? 'client-secret' : usesEnvToken ? 'environment-token' : usesStaticToken ? 'static-token' : usesDeviceCode ? 'device-code' : 'user',
    description: readFlag(args, '--description'),
    tenantId: readFlag(args, '--tenant-id'),
    clientId: readFlag(args, '--client-id'),
    loginHint: readFlag(args, '--login-hint'),
    prompt: readFlag(args, '--prompt') as LoginAccountInput['prompt'],
    fallbackToDeviceCode: hasFlag(args, '--device-code-fallback'),
    clientSecretEnv: readFlag(args, '--client-secret-env'),
    environmentVariable: readFlag(args, '--env-var'),
    token: readFlag(args, '--token')
  };

  if (input.kind === 'client-secret' && (!input.tenantId || !input.clientId || !input.clientSecretEnv)) {
    return argumentFailure('AUTH_CLIENT_SECRET_FLAGS_REQUIRED', 'Usage: pp auth login <account> --client-secret --tenant-id TENANT --client-id CLIENT --client-secret-env ENV_VAR');
  }
  if (input.kind === 'environment-token' && !input.environmentVariable) {
    return argumentFailure('AUTH_ENV_VAR_REQUIRED', 'Usage: pp auth login <account> --env-token --env-var ENV_VAR');
  }
  if (input.kind === 'static-token' && !input.token) {
    return argumentFailure('AUTH_TOKEN_REQUIRED', 'Usage: pp auth login <account> --static-token --token TOKEN');
  }

  return { success: true as const, data: input, diagnostics: [] };
}

function printHelp(): void {
  process.stdout.write(
    [
      'pp',
      '',
      'CLI for Power Platform auth, environments, requests, and MCP access.',
      '',
      'Usage:',
      '  pp <command> [args]',
      '',
      'Commands:',
      '  auth            Manage accounts',
      '  env             Manage named environments',
      '  request         Send an authenticated request',
      '  flow            Validate, inspect, or request against Power Automate',
      '  whoami          Dataverse WhoAmI for an environment',
      '  ping            Basic connectivity check',
      '  token           Print a token for an environment',
      '  dv              Shortcut for "request --api dv"',
      '  graph           Shortcut for "request --api graph"',
      '  sharepoint      Shortcut for "request --api sharepoint"',
      '  sp              Alias for "sharepoint"',
      '  bap             Shortcut for "request --api bap"',
      '  powerapps       Shortcut for "request --api powerapps"',
      '  canvas-authoring  Canvas authoring helper commands and request shortcut',
      '  mcp             Start the MCP server',
      '  setup           Open the browser-based Setup Manager',
      '  migrate-config  Migrate legacy config into pp config',
      '  update          Check GitHub releases for updates',
      '  version         Print the current version',
      '  completion      Print shell completion script'
    ].join('\n') + '\n'
  );
}

function printAuthHelp(): void {
  process.stdout.write(
    [
      'pp auth',
      '',
      'Manage accounts.',
      '',
      'Usage:',
      '  pp auth <command> [args]',
      '',
      'Commands:',
      '  login <account>    Create or update an account and run login',
      '  list               List accounts',
      '  inspect <account>  Show one account',
      '  remove <account>   Remove an account'
    ].join('\n') + '\n'
  );
}

function printAuthLoginHelp(): void {
  process.stdout.write(
    [
      'pp auth login',
      '',
      'Create or update an account and run the appropriate login flow.',
      '',
      'Usage:',
      '  pp auth login <account> [--browser|--device-code|--client-secret|--env-token|--static-token] [--description TEXT] [--tenant-id TENANT] [--client-id CLIENT] [--login-hint USER] [--prompt select_account|login|consent|none] [--device-code-fallback] [--client-secret-env ENV_VAR] [--env-var ENV_VAR] [--token TOKEN] [--force-prompt] [--credential-store auto|os|file] [--no-interactive-auth]'
    ].join('\n') + '\n'
  );
}

function printAuthListHelp(): void {
  process.stdout.write(['pp auth list', '', 'List configured accounts.', '', 'Usage:', '  pp auth list'].join('\n') + '\n');
}

function printAuthInspectHelp(): void {
  process.stdout.write(['pp auth inspect', '', 'Show one account.', '', 'Usage:', '  pp auth inspect <account>'].join('\n') + '\n');
}

function printAuthRemoveHelp(): void {
  process.stdout.write(['pp auth remove', '', 'Remove one account.', '', 'Usage:', '  pp auth remove <account>'].join('\n') + '\n');
}

function printEnvHelp(): void {
  process.stdout.write(
    [
      'pp env',
      '',
      'Manage named environments.',
      '',
      'Usage:',
      '  pp env <command> [args]',
      '',
      'Commands:',
      '  list             List environments',
      '  inspect <alias>  Show one environment',
      '  discover <acct>  Discover environments accessible to one account',
      '  add <alias>      Add an environment and discover metadata',
      '  remove <alias>   Remove an environment'
    ].join('\n') + '\n'
  );
}

function printEnvListHelp(): void {
  process.stdout.write(['pp env list', '', 'List environments.', '', 'Usage:', '  pp env list'].join('\n') + '\n');
}

function printEnvInspectHelp(): void {
  process.stdout.write(['pp env inspect', '', 'Show one environment.', '', 'Usage:', '  pp env inspect <alias>'].join('\n') + '\n');
}

function printEnvAddHelp(): void {
  process.stdout.write(
    [
      'pp env add',
      '',
      'Add an environment and discover its maker environment id and tenant.',
      '',
      'Usage:',
      '  pp env add <alias> --url URL --account ACCOUNT [--display-name NAME] [--access read-only|read-write] [--no-interactive-auth]'
    ].join('\n') + '\n'
  );
}

function printEnvDiscoverHelp(): void {
  process.stdout.write(['pp env discover', '', 'Discover environments accessible to one account.', '', 'Usage:', '  pp env discover <account> [--no-interactive-auth]'].join('\n') + '\n');
}

function printEnvRemoveHelp(): void {
  process.stdout.write(['pp env remove', '', 'Remove one environment.', '', 'Usage:', '  pp env remove <alias>'].join('\n') + '\n');
}

function printRequestHelp(): void {
  process.stdout.write(
    [
      'pp request',
      '',
      'Send an authenticated request. Environment-scoped APIs require --env; Graph and SharePoint may use --account.',
      '',
      'Usage:',
      '  pp request [dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] <path|url> [--env ALIAS|--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|powerautomate|canvas-authoring|sharepoint|custom] [--method METHOD] [--query K=V] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--response-type json|text|void] [--timeout-ms MS] [--jq EXPR] [--read] [--no-interactive-auth]'
    ].join('\n') + '\n'
  );
}

function printRequestAliasHelp(api: Exclude<ApiKind, 'custom'>): void {
  process.stdout.write(
    [
      `pp ${api}`,
      '',
      `Shortcut for "pp request --api ${api}".`,
      '',
      'Usage:',
      `  pp ${api} <path|url> ${api === 'graph' || api === 'sharepoint' ? '[--account ACCOUNT|--env ALIAS]' : '--env ALIAS [--account ACCOUNT]'} [--method METHOD] [--query K=V] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--response-type json|text|void] [--timeout-ms MS] [--jq EXPR] [--read] [--no-interactive-auth]`
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring',
      '',
      'Canvas authoring helper commands plus a request shortcut fallback.',
      '',
      'Use this surface for the internal Power Apps Studio canvas authoring service. Most',
      'work starts with a session, which gives pp the authoring host, version, session id,',
      'and opaque session state required by the YAML and document-server APIs.',
      '',
      'Session commands:',
      '  pp canvas-authoring session start --env ALIAS --app APP_ID [--account ACCOUNT] [--cadence Frequent] [--cluster-category prod] [--raw] [--no-interactive-auth]',
      '  pp canvas-authoring session list [--config-dir DIR]',
      '  pp canvas-authoring session request --env ALIAS --app APP_ID --path /api/yaml/fetch [--read]',
      '  pp canvas-authoring invoke --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--account ACCOUNT] [--no-interactive-auth]',
      '  pp canvas-authoring rpc --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--account ACCOUNT] [--no-interactive-auth]',
      '',
      'Lightweight REST helpers:',
      '  pp canvas-authoring yaml fetch --env ALIAS --app APP_ID [--out DIR]',
      '  pp canvas-authoring yaml validate --env ALIAS --app APP_ID --dir DIR',
      '  pp canvas-authoring controls list|describe --env ALIAS --app APP_ID [NAME]',
      '  pp canvas-authoring apis list|describe --env ALIAS --app APP_ID [NAME]',
      '  pp canvas-authoring datasources list|describe --env ALIAS --app APP_ID [NAME]',
      '  pp canvas-authoring accessibility --env ALIAS --app APP_ID',
      '',
      'REST helper notes:',
      '  These helpers call the session-backed /api/yaml/... endpoints used by the MCP server.',
      '  yaml fetch reads the current live authoring document as .pa.yaml files.',
      '  yaml validate sends local .pa.yaml files to validate-directory; in an active coauthoring',
      '  session, valid YAML can also update the dirty draft visible in Maker/Studio.',
      '  Validation diagnostics are returned in response.diagnostics.',
      '',
      'Transport choices:',
      '  invoke  POSTs to /<version>/api/v2/invoke. Use it for fire-and-forget or mutation calls where HTTP 200 is enough.',
      '  rpc     Uses the authoring SignalR channel and waits for the matching method result. Use it for query-style calls such as document/2/geterrorsasync.',
      '',
      'Request shortcut:',
      '  pp canvas-authoring <path|url> --env ALIAS [same flags as pp request --api canvas-authoring]',
      '',
      'Common raw endpoints:',
      '  /gateway/cluster',
      '  https://authoring.<geo>-il<cluster>.gateway.prod.island.powerapps.com/<version>/api/yaml/fetch',
      '  https://authoring.<geo>-il<cluster>.gateway.prod.island.powerapps.com/<version>/api/yaml/validate-directory',
      '',
      'Examples:',
      '  pp canvas-authoring /gateway/cluster --env dev --read',
      '  pp canvas-authoring session start --env dev --app <app-id>',
      '  pp canvas-authoring yaml fetch --env dev --app <app-id> --out ./canvas-src',
      '  pp canvas-authoring rpc --env dev --app <app-id> --class document --oid 2 --method geterrorsasync',
      '',
      'These APIs are internal and stateful. Object ids such as document/2 come from the live',
      'authoring session, and some methods can mutate the open draft app.'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringInvokeHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring invoke',
      '',
      'Invoke a low-level canvas document-server RPC method through /api/v2/invoke.',
      '',
      'Usage:',
      '  pp canvas-authoring invoke --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--sequence N --confirmation N] [--session-id ID --session-state STATE --authoring-base-url URL --web-authoring-version VERSION] [--account ACCOUNT] [--no-interactive-auth]',
      '',
      'Examples:',
      '  pp canvas-authoring invoke --env dev --app <app-id> --class documentservicev2 --oid 1 --method keepalive',
      '  pp canvas-authoring invoke --env dev --app <app-id> --class document --oid 2 --method setsaveappcontext --payload \'{"saveAppContext":{...}}\'',
      '',
      'This is an internal stateful RPC surface. Methods can mutate the open app document.'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringRpcHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring rpc',
      '',
      'Invoke a low-level canvas document-server RPC method over the authoring SignalR channel.',
      '',
      'Usage:',
      '  pp canvas-authoring rpc --env ALIAS --app APP_ID --class CLASS --oid OID --method METHOD [--payload JSON|--payload-file FILE] [--timeout-ms MS] [--sequence N --confirmation N] [--session-id ID --session-state STATE --authoring-base-url URL --web-authoring-version VERSION] [--account ACCOUNT] [--no-interactive-auth]',
      '',
      'Examples:',
      '  pp canvas-authoring rpc --env dev --app <app-id> --class document --oid 2 --method geterrorsasync',
      '  pp canvas-authoring rpc --env dev --app <app-id> --class document --oid 2 --method getappcheckerperformanceresponsesasync',
      '',
      'This is experimental and uses the internal authoring SignalR protocol.'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringSessionRequestHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring session request',
      '',
      'Send a request to the versioned authoring host with session headers.',
      '',
      'Usage:',
      '  pp canvas-authoring session request --env ALIAS --app APP_ID --path PATH [--method METHOD] [--body JSON|--body-file FILE] [--response-type json|text|void] [--read]',
      '',
      'Examples:',
      '  pp canvas-authoring session request --env dev --app <app-id> --path /api/yaml/fetch --read',
      '  pp canvas-authoring session request --env dev --app <app-id> --path /api/yaml/validate-directory --method POST --body-file payload.json'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringYamlHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring yaml',
      '',
      'Thin helpers for the MCP-style YAML REST endpoints.',
      '',
      'These endpoints operate against a live authoring session. fetch reads the current',
      'session document. validate sends files to validate-directory; when the YAML is valid',
      'and the session is active, the service can update the dirty draft in Maker/Studio.',
      '',
      'Usage:',
      '  pp canvas-authoring yaml fetch --env ALIAS --app APP_ID [--out DIR]',
      '  pp canvas-authoring yaml validate --env ALIAS --app APP_ID --dir DIR',
      '  pp canvas-authoring yaml validate --env ALIAS --app APP_ID --body-file payload.json'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringYamlFetchHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring yaml fetch',
      '',
      'Fetch source-control YAML files from the live authoring session.',
      '',
      'Usage:',
      '  pp canvas-authoring yaml fetch --env ALIAS --app APP_ID [--out DIR]'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringYamlValidateHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring yaml validate',
      '',
      'Validate a set of .pa.yaml files through /api/yaml/validate-directory.',
      '',
      'This is session-backed. In an active coauthoring session, valid YAML can also update',
      'the live dirty draft visible in Maker/Studio. Invalid YAML returns diagnostics and',
      'should not cleanly apply.',
      '',
      'Usage:',
      '  pp canvas-authoring yaml validate --env ALIAS --app APP_ID --dir DIR [--with-signalr]',
      '  pp canvas-authoring yaml validate --env ALIAS --app APP_ID --body-file payload.json [--with-signalr]',
      '',
      'Options:',
      '  --with-signalr       Also hold a SignalR diagnostics hub connection and send keepalive before validate.',
      '  --signalr-timeout-ms Timeout for the SignalR connection/RPC when --with-signalr is used.'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringNamedEndpointHelp(endpoint: 'controls' | 'apis' | 'datasources'): void {
  process.stdout.write(
    [
      `pp canvas-authoring ${endpoint}`,
      '',
      `Thin helpers for /api/yaml/${endpoint}.`,
      '',
      'Usage:',
      `  pp canvas-authoring ${endpoint} list --env ALIAS --app APP_ID`,
      `  pp canvas-authoring ${endpoint} describe --env ALIAS --app APP_ID NAME`
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringAccessibilityHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring accessibility',
      '',
      'Fetch /api/yaml/accessibility-errors for authoring hosts that support it.',
      '',
      'Usage:',
      '  pp canvas-authoring accessibility --env ALIAS --app APP_ID',
      '',
      'This endpoint is version-gated by Microsoft; older authoring hosts may return 404.'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringSessionHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring session',
      '',
      'Manage canvas authoring sessions.',
      '',
      'Usage:',
      '  pp canvas-authoring session start --env ALIAS --app APP_ID [--account ACCOUNT] [--cadence Frequent] [--cluster-category prod] [--raw] [--no-interactive-auth]',
      '  pp canvas-authoring session list [--config-dir DIR]',
      '  pp canvas-authoring session request --env ALIAS --app APP_ID --path PATH [--method METHOD] [--body JSON|--body-file FILE] [--read]'
    ].join('\n') + '\n'
  );
}

function printCanvasAuthoringSessionStartHelp(): void {
  process.stdout.write(
    [
      'pp canvas-authoring session start',
      '',
      'Discover the canvas authoring cluster and start an authoring session.',
      '',
      'Usage:',
      '  pp canvas-authoring session start --env ALIAS --app APP_ID [--account ACCOUNT] [--cadence Frequent] [--cluster-category prod] [--raw] [--no-interactive-auth]',
      '',
      'By default, sessionState and accessToken are redacted from the output. Pass --raw to print the service response unchanged.'
    ].join('\n') + '\n'
  );
}

function printFlowHelp(): void {
  process.stdout.write(['pp flow', '', 'Power Automate request shortcut.', '', 'Usage:', '  pp flow <path> --env ALIAS [same flags as pp request --api flow]'].join('\n') + '\n');
}

function printWhoAmIHelp(): void {
  process.stdout.write(['pp whoami', '', 'Run Dataverse WhoAmI.', '', 'Usage:', '  pp whoami --env ALIAS [--account ACCOUNT] [--no-interactive-auth]'].join('\n') + '\n');
}

function printPingHelp(): void {
  process.stdout.write(
    ['pp ping', '', 'Check basic API connectivity.', '', 'Usage:', '  pp ping --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--no-interactive-auth]'].join(
      '\n'
    ) + '\n'
  );
}

function printEnvironmentTokenHelp(): void {
  process.stdout.write(
    [
      'pp token',
      '',
      'Print a token for an environment.',
      '',
      'Usage:',
      '  pp token --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|canvas-authoring] [--device-code] [--no-interactive-auth]'
    ].join('\n') + '\n'
  );
}

function printMcpHelp(): void {
  process.stdout.write(['pp mcp', '', 'Start the pp MCP server.', '', 'Usage:', '  pp mcp [--config-dir DIR] [--allow-interactive-auth]'].join('\n') + '\n');
}

function printCompletionHelp(): void {
  process.stdout.write(['pp completion', '', 'Print a shell completion script.', '', 'Usage:', '  pp completion [zsh|bash|powershell]'].join('\n') + '\n');
}

function printMigrateConfigHelp(): void {
  process.stdout.write(
    [
      'pp migrate-config',
      '',
      'Migrate legacy config into the current account/environment layout.',
      '',
      'Usage:',
      '  pp migrate-config [--source-config PATH] [--source-dir DIR] [--config-dir DIR] [--apply]'
    ].join('\n') + '\n'
  );
}

function wantsHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('help');
}

function isHelpToken(value: string | undefined): boolean {
  return value === '--help' || value === 'help';
}

function readOptionalInt(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
