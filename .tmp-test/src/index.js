#!/usr/bin/env node
import process from 'node:process';
import { migrateLegacyConfig } from './migrate.js';
import { argumentFailure, hasFlag, positionalArgs, printFailure, printResult, readBody, readConfigOptions, readFlag, readHeaderFlags, readQueryFlags, } from './cli-utils.js';
import { startPpMcpServer } from './mcp.js';
import { inspectAccountSummary, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { executeApiRequest, getEnvironmentToken, runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, inspectConfiguredEnvironment, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';
import { analyzeFlowFile, explainFlowFileSymbol } from './services/flow-language.js';
import { startPpUi } from './ui.js';
async function main(args) {
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
            return runFlow(rest);
        case 'graph':
            return runApiAlias('graph', rest);
        case 'bap':
            return runApiAlias('bap', rest);
        case 'powerapps':
            return runApiAlias('powerapps', rest);
        case 'mcp':
            if (isHelpToken(rest[0])) {
                printMcpHelp();
                return 0;
            }
            await startPpMcpServer({
                configDir: readFlag(rest, '--config-dir'),
                allowInteractiveAuth: hasFlag(rest, '--allow-interactive-auth'),
            });
            return 0;
        case 'ui':
            return runUi(rest);
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
async function runAuth(args) {
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
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data ?? [], rest);
        return 0;
    }
    if (subcommand === 'inspect') {
        if (wantsHelp(rest)) {
            printAuthInspectHelp();
            return 0;
        }
        const name = positionalArgs(rest)[0];
        if (!name)
            return printFailure(argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth inspect <account>'), rest);
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
        if (!name)
            return printFailure(argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth remove <account>'), rest);
        const result = await removeAccountByName(name, configOptions);
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data, rest);
        return 0;
    }
    if (subcommand === 'login') {
        if (wantsHelp(rest)) {
            printAuthLoginHelp();
            return 0;
        }
        const loginInput = readLoginInput(rest);
        if (!loginInput.success || !loginInput.data)
            return printFailure(loginInput, rest);
        const result = await loginAccount(loginInput.data, {
            preferredFlow: hasFlag(rest, '--device-code') ? 'device-code' : 'interactive',
            forcePrompt: hasFlag(rest, '--force-prompt'),
            allowInteractive: !hasFlag(rest, '--no-interactive-auth'),
        }, configOptions);
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data, rest);
        return 0;
    }
    printAuthHelp();
    return 1;
}
async function runEnv(args) {
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
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data ?? [], rest);
        return 0;
    }
    if (subcommand === 'inspect') {
        if (wantsHelp(rest)) {
            printEnvInspectHelp();
            return 0;
        }
        const alias = positionalArgs(rest)[0];
        if (!alias)
            return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env inspect <alias>'), rest);
        const result = await inspectConfiguredEnvironment(alias, configOptions);
        if (!result.success || !result.data)
            return printFailure(result.success ? argumentFailure('ENV_NOT_FOUND', `Environment ${alias} was not found.`) : result, rest);
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
            return printFailure(argumentFailure('ENV_ADD_USAGE', 'Usage: pp env add <alias> --url URL --account ACCOUNT [--display-name NAME] [--access read-only|read-write] [--no-interactive-auth]'), rest);
        }
        const result = await addConfiguredEnvironment({
            alias,
            url,
            account,
            displayName: readFlag(rest, '--display-name'),
            accessMode: readFlag(rest, '--access'),
        }, configOptions, { allowInteractive: !hasFlag(rest, '--no-interactive-auth') });
        if (!result.success)
            return printFailure(result, rest);
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
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data ?? [], rest);
        return 0;
    }
    if (subcommand === 'remove') {
        if (wantsHelp(rest)) {
            printEnvRemoveHelp();
            return 0;
        }
        const alias = positionalArgs(rest)[0];
        if (!alias)
            return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: pp env remove <alias>'), rest);
        const result = await removeConfiguredEnvironment(alias, configOptions);
        if (!result.success)
            return printFailure(result, rest);
        printResult(result.data, rest);
        return 0;
    }
    printEnvHelp();
    return 1;
}
async function runRequest(args) {
    if (wantsHelp(args)) {
        printRequestHelp();
        return 0;
    }
    const positional = positionalArgs(args);
    const positionalApi = positional[0] && isApiKind(positional[0]) ? positional[0] : undefined;
    const path = positionalApi ? positional[1] : positional[0];
    const environmentAlias = readFlag(args, '--environment');
    if (!path || !environmentAlias) {
        return printFailure(argumentFailure('REQUEST_USAGE', 'Usage: pp request [dv|flow|graph|bap|powerapps|custom] <path|url> --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|custom] [--method METHOD] [--query k=v] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--read]'), args);
    }
    const body = await readBody(args);
    if (!body.success)
        return printFailure(body, args);
    const result = await executeApiRequest({
        environmentAlias,
        accountName: readFlag(args, '--account'),
        path,
        method: readFlag(args, '--method') ?? 'GET',
        api: positionalApi ?? readFlag(args, '--api'),
        query: readQueryFlags(args),
        headers: readHeaderFlags(args),
        body: body.data?.body,
        rawBody: body.data?.rawBody,
        responseType: readFlag(args, '--response-type') ?? 'json',
        timeoutMs: readFlag(args, '--timeout-ms') ? Number(readFlag(args, '--timeout-ms')) : undefined,
        readIntent: hasFlag(args, '--read'),
    }, readConfigOptions(args), { allowInteractive: !hasFlag(args, '--no-interactive-auth') });
    if (!result.success)
        return printFailure(result, args);
    printResult(result.data, args);
    return 0;
}
async function runApiAlias(api, args) {
    if (wantsHelp(args)) {
        printRequestAliasHelp(api);
        return 0;
    }
    return runRequest([...args, '--api', api]);
}
async function runFlow(args) {
    if (args.length === 0 || wantsHelp(args)) {
        printFlowHelp();
        return 0;
    }
    const [subcommand, ...rest] = args;
    if (!isFlowLanguageSubcommand(subcommand)) {
        return runApiAlias('flow', args);
    }
    const filePath = positionalArgs(rest)[0];
    if (!filePath) {
        return printFailure(argumentFailure('FLOW_FILE_REQUIRED', `Usage: pp flow ${subcommand} <file> ${subcommand === 'explain' ? '--symbol NAME' : ''}`.trim()), args);
    }
    if (subcommand === 'validate' || subcommand === 'inspect' || subcommand === 'symbols') {
        const result = await analyzeFlowFile(filePath);
        if (!result.success || !result.data)
            return printFailure(result, args);
        if (subcommand === 'validate') {
            printResult({
                success: !result.data.diagnostics.some((item) => item.level === 'error'),
                summary: result.data.summary,
                diagnostics: result.data.diagnostics,
            }, args);
            return result.data.diagnostics.some((item) => item.level === 'error') ? 1 : 0;
        }
        if (subcommand === 'symbols') {
            printResult({
                summary: result.data.summary,
                symbols: result.data.symbols,
                references: result.data.references,
            }, args);
            return 0;
        }
        printResult({
            summary: result.data.summary,
            outline: result.data.outline,
            symbols: result.data.symbols,
            diagnostics: result.data.diagnostics,
            knowledge: result.data.knowledge,
        }, args);
        return 0;
    }
    if (subcommand === 'explain') {
        const symbolName = readFlag(rest, '--symbol') ?? readFlag(rest, '--action');
        if (!symbolName)
            return printFailure(argumentFailure('FLOW_SYMBOL_REQUIRED', 'Usage: pp flow explain <file> --symbol NAME'), args);
        const result = await explainFlowFileSymbol(filePath, symbolName);
        if (!result.success || !result.data)
            return printFailure(result, args);
        printResult(result.data, args);
        return result.data.symbol ? 0 : 1;
    }
    printFlowHelp();
    return 1;
}
async function runWhoAmI(args) {
    if (wantsHelp(args)) {
        printWhoAmIHelp();
        return 0;
    }
    const environmentAlias = readFlag(args, '--environment');
    if (!environmentAlias)
        return printFailure(argumentFailure('WHOAMI_USAGE', 'Usage: pp whoami --env ALIAS [--account ACCOUNT] [--no-interactive-auth]'), args);
    const result = await runWhoAmICheck({
        environmentAlias,
        accountName: readFlag(args, '--account'),
        allowInteractive: !hasFlag(args, '--no-interactive-auth'),
    }, readConfigOptions(args));
    if (!result.success)
        return printFailure(result, args);
    printResult(result.data, args);
    return 0;
}
async function runPing(args) {
    if (wantsHelp(args)) {
        printPingHelp();
        return 0;
    }
    const environmentAlias = readFlag(args, '--environment');
    const api = readFlag(args, '--api') ?? 'dv';
    if (!environmentAlias)
        return printFailure(argumentFailure('PING_USAGE', 'Usage: pp ping --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps] [--no-interactive-auth]'), args);
    const result = await runConnectivityPing({
        environmentAlias,
        accountName: readFlag(args, '--account'),
        api,
        allowInteractive: !hasFlag(args, '--no-interactive-auth'),
    }, readConfigOptions(args));
    if (!result.success || !result.data)
        return printFailure(result, args);
    printResult(result.data, args);
    return 0;
}
async function runEnvironmentToken(args) {
    if (wantsHelp(args)) {
        printEnvironmentTokenHelp();
        return 0;
    }
    const environmentAlias = readFlag(args, '--environment');
    const api = readFlag(args, '--api') ?? 'dv';
    if (!environmentAlias)
        return printFailure(argumentFailure('TOKEN_USAGE', 'Usage: pp token --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps] [--device-code] [--no-interactive-auth]'), args);
    const result = await getEnvironmentToken({
        environmentAlias,
        accountName: readFlag(args, '--account'),
        api,
        preferredFlow: hasFlag(args, '--device-code') ? 'device-code' : 'interactive',
        allowInteractive: !hasFlag(args, '--no-interactive-auth'),
    }, readConfigOptions(args));
    if (!result.success || !result.data)
        return printFailure(result, args);
    process.stdout.write(`${result.data}\n`);
    return 0;
}
function runCompletion(args) {
    if (wantsHelp(args)) {
        printCompletionHelp();
        return 0;
    }
    const shell = positionalArgs(args)[0] ?? 'zsh';
    if (shell === 'bash') {
        process.stdout.write('complete -W "auth env request whoami ping token ui dv flow graph bap powerapps mcp migrate-config completion help" pp\n');
        return 0;
    }
    process.stdout.write('#compdef pp\n_arguments "1: :((auth env request whoami ping token ui dv flow graph bap powerapps mcp migrate-config completion help))"\n');
    return 0;
}
async function runMigrateConfig(args) {
    if (wantsHelp(args)) {
        printMigrateConfigHelp();
        return 0;
    }
    const result = await migrateLegacyConfig({
        sourceConfigPath: readFlag(args, '--source-config'),
        sourceDir: readFlag(args, '--source-dir'),
        targetConfigOptions: readConfigOptions(args),
        apply: hasFlag(args, '--apply'),
    });
    if (!result.success || !result.data)
        return printFailure(result, args);
    printResult({
        ...result.data,
        note: hasFlag(args, '--apply')
            ? 'Migration applied.'
            : 'Dry run only. Re-run with --apply to write the migrated config.',
    }, args);
    return 0;
}
async function runUi(args) {
    if (wantsHelp(args)) {
        printUiHelp();
        return 0;
    }
    const portValue = readFlag(args, '--port');
    const port = portValue === undefined ? undefined : Number(portValue);
    if (portValue !== undefined && (!Number.isInteger(port) || Number(port) < 0 || Number(port) > 65535)) {
        return printFailure(argumentFailure('UI_PORT_INVALID', 'Usage: pp ui [--port PORT] [--no-open] [--config-dir DIR] [--no-interactive-auth]'), args);
    }
    const ui = await startPpUi({
        configDir: readFlag(args, '--config-dir'),
        port,
        openBrowser: !hasFlag(args, '--no-open'),
        allowInteractiveAuth: !hasFlag(args, '--no-interactive-auth'),
    });
    const shutdown = async () => {
        await ui.close();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    process.stdout.write('Press Ctrl+C to stop.\n');
    await new Promise(() => undefined);
    return 0;
}
function readLoginInput(args) {
    const name = positionalArgs(args)[0];
    if (!name)
        return argumentFailure('ACCOUNT_NAME_REQUIRED', 'Usage: pp auth login <account> [flags]');
    const usesClientSecret = hasFlag(args, '--client-secret');
    const usesEnvToken = hasFlag(args, '--env-token');
    const usesStaticToken = hasFlag(args, '--static-token');
    const usesDeviceCode = hasFlag(args, '--device-code');
    const usesBrowser = hasFlag(args, '--browser');
    const methodFlags = [usesClientSecret, usesEnvToken, usesStaticToken, usesDeviceCode, usesBrowser].filter(Boolean).length;
    if (methodFlags > 1) {
        return argumentFailure('AUTH_METHOD_CONFLICT', 'Choose at most one auth method: --browser, --device-code, --client-secret, --env-token, or --static-token.');
    }
    const input = {
        name,
        kind: usesClientSecret ? 'client-secret' : usesEnvToken ? 'environment-token' : usesStaticToken ? 'static-token' : usesDeviceCode ? 'device-code' : 'user',
        description: readFlag(args, '--description'),
        tenantId: readFlag(args, '--tenant-id'),
        clientId: readFlag(args, '--client-id'),
        loginHint: readFlag(args, '--login-hint'),
        prompt: readFlag(args, '--prompt'),
        fallbackToDeviceCode: hasFlag(args, '--device-code-fallback'),
        clientSecretEnv: readFlag(args, '--client-secret-env'),
        environmentVariable: readFlag(args, '--env-var'),
        token: readFlag(args, '--token'),
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
    return { success: true, data: input, diagnostics: [] };
}
function printHelp() {
    process.stdout.write([
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
        '  ui              Start the localhost auth and environment UI',
        '  dv              Shortcut for "request --api dv"',
        '  graph           Shortcut for "request --api graph"',
        '  bap             Shortcut for "request --api bap"',
        '  powerapps       Shortcut for "request --api powerapps"',
        '  mcp             Start the MCP server',
        '  migrate-config  Migrate legacy config into pp config',
        '  completion      Print shell completion script',
    ].join('\n') + '\n');
}
function printAuthHelp() {
    process.stdout.write([
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
        '  remove <account>   Remove an account',
    ].join('\n') + '\n');
}
function printAuthLoginHelp() {
    process.stdout.write([
        'pp auth login',
        '',
        'Create or update an account and run the appropriate login flow.',
        '',
        'Usage:',
        '  pp auth login <account> [--browser|--device-code|--client-secret|--env-token|--static-token] [--description TEXT] [--tenant-id TENANT] [--client-id CLIENT] [--login-hint USER] [--prompt select_account|login|consent|none] [--device-code-fallback] [--client-secret-env ENV_VAR] [--env-var ENV_VAR] [--token TOKEN] [--force-prompt] [--no-interactive-auth]',
    ].join('\n') + '\n');
}
function printAuthListHelp() {
    process.stdout.write(['pp auth list', '', 'List configured accounts.', '', 'Usage:', '  pp auth list'].join('\n') + '\n');
}
function printAuthInspectHelp() {
    process.stdout.write(['pp auth inspect', '', 'Show one account.', '', 'Usage:', '  pp auth inspect <account>'].join('\n') + '\n');
}
function printAuthRemoveHelp() {
    process.stdout.write(['pp auth remove', '', 'Remove one account.', '', 'Usage:', '  pp auth remove <account>'].join('\n') + '\n');
}
function printEnvHelp() {
    process.stdout.write([
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
        '  remove <alias>   Remove an environment',
    ].join('\n') + '\n');
}
function printEnvListHelp() {
    process.stdout.write(['pp env list', '', 'List environments.', '', 'Usage:', '  pp env list'].join('\n') + '\n');
}
function printEnvInspectHelp() {
    process.stdout.write(['pp env inspect', '', 'Show one environment.', '', 'Usage:', '  pp env inspect <alias>'].join('\n') + '\n');
}
function printEnvAddHelp() {
    process.stdout.write([
        'pp env add',
        '',
        'Add an environment and discover its maker environment id and tenant.',
        '',
        'Usage:',
        '  pp env add <alias> --url URL --account ACCOUNT [--display-name NAME] [--access read-only|read-write] [--no-interactive-auth]',
    ].join('\n') + '\n');
}
function printEnvDiscoverHelp() {
    process.stdout.write([
        'pp env discover',
        '',
        'Discover environments accessible to one account.',
        '',
        'Usage:',
        '  pp env discover <account> [--no-interactive-auth]',
    ].join('\n') + '\n');
}
function printEnvRemoveHelp() {
    process.stdout.write(['pp env remove', '', 'Remove one environment.', '', 'Usage:', '  pp env remove <alias>'].join('\n') + '\n');
}
function printRequestHelp() {
    process.stdout.write([
        'pp request',
        '',
        'Send an authenticated request using an explicit environment and optional account override.',
        '',
        'Usage:',
        '  pp request [dv|flow|graph|bap|powerapps|custom] <path|url> --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps|custom] [--method METHOD] [--query K=V] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--response-type json|text|void] [--timeout-ms MS] [--read] [--no-interactive-auth]',
    ].join('\n') + '\n');
}
function printRequestAliasHelp(api) {
    process.stdout.write([
        `pp ${api}`,
        '',
        `Shortcut for "pp request --api ${api}".`,
        '',
        'Usage:',
        `  pp ${api} <path|url> --env ALIAS [--account ACCOUNT] [--method METHOD] [--query K=V] [--header K:V] [--body JSON|--body-file FILE] [--raw-body TEXT|--raw-body-file FILE] [--response-type json|text|void] [--timeout-ms MS] [--read] [--no-interactive-auth]`,
    ].join('\n') + '\n');
}
function printFlowHelp() {
    process.stdout.write([
        'pp flow',
        '',
        'Power Automate workflow tooling plus a request shortcut fallback.',
        '',
        'Language commands:',
        '  pp flow validate <file>',
        '  pp flow inspect <file>',
        '  pp flow symbols <file>',
        '  pp flow explain <file> --symbol NAME',
        '',
        'Request shortcut:',
        '  pp flow <path> --env ALIAS [same flags as pp request --api flow]',
    ].join('\n') + '\n');
}
function printWhoAmIHelp() {
    process.stdout.write(['pp whoami', '', 'Run Dataverse WhoAmI.', '', 'Usage:', '  pp whoami --env ALIAS [--account ACCOUNT] [--no-interactive-auth]'].join('\n') + '\n');
}
function printPingHelp() {
    process.stdout.write(['pp ping', '', 'Check basic API connectivity.', '', 'Usage:', '  pp ping --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps] [--no-interactive-auth]'].join('\n') + '\n');
}
function printEnvironmentTokenHelp() {
    process.stdout.write(['pp token', '', 'Print a token for an environment.', '', 'Usage:', '  pp token --env ALIAS [--account ACCOUNT] [--api dv|flow|graph|bap|powerapps] [--device-code] [--no-interactive-auth]'].join('\n') + '\n');
}
function printMcpHelp() {
    process.stdout.write(['pp mcp', '', 'Start the pp MCP server.', '', 'Usage:', '  pp mcp [--config-dir DIR] [--allow-interactive-auth]'].join('\n') + '\n');
}
function printUiHelp() {
    process.stdout.write([
        'pp ui',
        '',
        'Start the localhost UI for account, environment, and MCP inspection.',
        '',
        'Usage:',
        '  pp ui [--port PORT] [--no-open] [--config-dir DIR] [--no-interactive-auth]',
    ].join('\n') + '\n');
}
function printCompletionHelp() {
    process.stdout.write(['pp completion', '', 'Print a shell completion script.', '', 'Usage:', '  pp completion [zsh|bash]'].join('\n') + '\n');
}
function printMigrateConfigHelp() {
    process.stdout.write(['pp migrate-config', '', 'Migrate legacy config into the current account/environment layout.', '', 'Usage:', '  pp migrate-config [--source-config PATH] [--source-dir DIR] [--config-dir DIR] [--apply]'].join('\n') + '\n');
}
function isApiKind(value) {
    return value === 'dv' || value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' || value === 'custom';
}
function isFlowLanguageSubcommand(value) {
    return value === 'validate' || value === 'inspect' || value === 'symbols' || value === 'explain';
}
function wantsHelp(args) {
    return args.includes('--help') || args.includes('help');
}
function isHelpToken(value) {
    return value === '--help' || value === 'help';
}
void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
}).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
