import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import YAML from 'yaml';
import { createDiagnostic, fail, ok } from './diagnostics.js';
const BOOLEAN_FLAGS = new Set([
    '--apply',
    '--allow-interactive-auth',
    '--device-code',
    '--force-prompt',
    '--no-interactive-auth',
    '--read',
]);
export function readFlag(args, name) {
    const aliases = name === '--environment' ? ['--env', '--environment'] : [name];
    for (const alias of aliases) {
        const index = args.indexOf(alias);
        if (index >= 0)
            return args[index + 1];
    }
    return undefined;
}
export function hasFlag(args, name) {
    const aliases = name === '--environment' ? ['--env', '--environment'] : [name];
    return aliases.some((alias) => args.includes(alias));
}
export function readRepeatedFlags(args, name) {
    const values = [];
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === name && args[i + 1]) {
            values.push(args[i + 1]);
            i += 1;
        }
    }
    return values;
}
export function positionalArgs(args) {
    const values = [];
    for (let i = 0; i < args.length; i += 1) {
        const value = args[i];
        if (!value)
            continue;
        if (value.startsWith('--')) {
            if (!BOOLEAN_FLAGS.has(value))
                i += 1;
            continue;
        }
        values.push(value);
    }
    return values;
}
export function readConfigOptions(args) {
    const configDir = readFlag(args, '--config-dir');
    if (!configDir)
        return {};
    return { configDir: isAbsolute(configDir) ? configDir : resolvePath(process.cwd(), configDir) };
}
export function readOutputFormat(args, fallback = 'json') {
    const format = readFlag(args, '--format');
    return format === 'yaml' || format === 'text' || format === 'json' ? format : fallback;
}
export function printOutput(value, format) {
    if (format === 'yaml') {
        process.stdout.write(YAML.stringify(value));
        return;
    }
    if (format === 'text' && typeof value === 'string') {
        process.stdout.write(`${value}\n`);
        return;
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
export function printResult(value, args) {
    printOutput(value, readOutputFormat(args));
}
export function printFailure(result, args = []) {
    printOutput({ success: false, diagnostics: result.diagnostics }, readOutputFormat(args));
    return 1;
}
export async function readBody(args) {
    const rawBody = readFlag(args, '--raw-body');
    const rawBodyFile = readFlag(args, '--raw-body-file');
    if (rawBody !== undefined && rawBodyFile !== undefined) {
        return fail(createDiagnostic('error', 'BODY_FLAGS_CONFLICT', 'Use either --raw-body or --raw-body-file, not both.', { source: 'pp/cli' }));
    }
    if (rawBody !== undefined)
        return ok({ rawBody });
    if (rawBodyFile !== undefined)
        return ok({ rawBody: await readFile(rawBodyFile, 'utf8') });
    const body = readFlag(args, '--body');
    const bodyFile = readFlag(args, '--body-file');
    if (body !== undefined && bodyFile !== undefined) {
        return fail(createDiagnostic('error', 'BODY_FLAGS_CONFLICT', 'Use either --body or --body-file, not both.', { source: 'pp/cli' }));
    }
    try {
        if (body !== undefined)
            return ok({ body: JSON.parse(body) });
        if (bodyFile !== undefined)
            return ok({ body: JSON.parse(await readFile(bodyFile, 'utf8')) });
        return ok({});
    }
    catch (error) {
        return fail(createDiagnostic('error', 'BODY_PARSE_FAILED', 'Failed to parse request body as JSON.', {
            source: 'pp/cli',
            detail: error instanceof Error ? error.message : String(error),
        }));
    }
}
export function readHeaderFlags(args) {
    const entries = readRepeatedFlags(args, '--header')
        .map((value) => {
        const index = value.indexOf(':');
        if (index < 0)
            return undefined;
        const key = value.slice(0, index).trim();
        const headerValue = value.slice(index + 1).trim();
        return key && headerValue ? [key, headerValue] : undefined;
    })
        .filter((entry) => Boolean(entry));
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
export function readQueryFlags(args) {
    const entries = readRepeatedFlags(args, '--query')
        .map((value) => {
        const index = value.indexOf('=');
        if (index < 0)
            return undefined;
        const key = value.slice(0, index).trim();
        const queryValue = value.slice(index + 1).trim();
        return key ? [key, queryValue] : undefined;
    })
        .filter((entry) => Boolean(entry));
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
export function argumentFailure(code, message) {
    return fail(createDiagnostic('error', code, message, { source: 'pp/cli' }));
}
