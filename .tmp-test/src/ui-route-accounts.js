import { DEFAULT_LOGIN_RESOURCE } from './auth.js';
import { saveAccount } from './config.js';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { optionalString, readAccountUpdateInput, readLoginInput } from './ui-request-parsing.js';
import { normalizeOrigin } from './request.js';
import { checkAccountTokenStatus, loginAccount, removeAccountByName } from './services/accounts.js';
import { listConfiguredEnvironments } from './services/environments.js';
export async function handleAccountLogin(request, response, context) {
    const body = await readJsonBody(request);
    if (!body.success || !body.data)
        return void sendJson(response, 400, body);
    const input = readLoginInput(body.data);
    if (!input.success || !input.data)
        return void sendJson(response, 400, input);
    const result = await loginAccount(input.data, {
        preferredFlow: body.data.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
        forcePrompt: Boolean(body.data.forcePrompt),
        allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
}
export async function handleAccountLoginJob(request, response, context) {
    const body = await readJsonBody(request);
    if (!body.success || !body.data)
        return void sendJson(response, 400, body);
    const bodyData = body.data;
    const input = readLoginInput(bodyData);
    if (!input.success || !input.data)
        return void sendJson(response, 400, input);
    const environments = await listConfiguredEnvironments(context.configOptions);
    if (!environments.success || !environments.data)
        return void sendJson(response, 400, fail(...environments.diagnostics));
    const excludeApis = Array.isArray(bodyData.excludeApis) ? bodyData.excludeApis.filter((v) => typeof v === 'string') : undefined;
    const loginTargets = buildLoginTargets(input.data.name, environments.data, optionalString(bodyData.environmentAlias), excludeApis);
    const job = context.jobs.createJob('account-login', (update) => loginAccount(input.data, {
        preferredFlow: bodyData.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
        forcePrompt: Boolean(bodyData.forcePrompt),
        allowInteractive: context.allowInteractiveAuth,
        loginTargets,
        onLoginTargetUpdate: async (progress) => update({ activeLoginTarget: { ...progress.target, status: progress.status, url: progress.url } }),
        onDeviceCode: async (info) => update({ deviceCode: { verificationUri: info.verificationUri, userCode: info.userCode, message: info.message } }),
    }, context.configOptions));
    job.metadata = { ...(job.metadata ?? {}), loginTargets: loginTargets.map((target) => ({ ...target, status: 'pending' })) };
    sendJson(response, 202, ok(job));
}
export async function handleJobGet(url, response, context) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
    const job = context.jobs.getJob(jobId);
    if (!job)
        return void sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
    sendJson(response, 200, ok(job));
}
export async function handleJobDelete(url, response, context) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
    const job = context.jobs.cancelJob(jobId);
    if (!job)
        return void sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
    sendJson(response, 200, ok(job));
}
export async function handleAccountDelete(url, response, context) {
    const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
    const result = await removeAccountByName(name, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
}
export async function handleAccountUpdate(request, response, url, context) {
    const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
    const body = await readJsonBody(request);
    if (!body.success || !body.data)
        return void sendJson(response, 400, body);
    const account = readAccountUpdateInput(name, body.data);
    if (!account.success || !account.data)
        return void sendJson(response, 400, account);
    const result = await saveAccount(account.data, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
}
export async function handleAccountTokenStatus(url, response, context) {
    const name = optionalString(url.searchParams.get('account'));
    if (!name)
        return void sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account query parameter is required.', { source: 'pp/ui' })));
    const result = await checkAccountTokenStatus(name, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
}
function buildLoginTargets(accountName, environments, selectedEnvironmentAlias, excludeApis) {
    const excluded = new Set(excludeApis ?? []);
    const targets = [];
    if (!excluded.has('dv')) {
        const relevantEnvironments = [
            ...environments.filter((environment) => environment.alias === selectedEnvironmentAlias),
            ...environments.filter((environment) => environment.account === accountName && environment.alias !== selectedEnvironmentAlias),
        ];
        for (const environment of relevantEnvironments) {
            targets.push({ resource: normalizeOrigin(environment.url), label: `Dataverse (${environment.alias})`, api: 'dv' });
        }
    }
    if (!excluded.has('flow'))
        targets.push({ resource: 'https://service.flow.microsoft.com', label: 'Flow', api: 'flow' });
    if (!excluded.has('powerapps') && !excluded.has('bap'))
        targets.push({ resource: 'https://service.powerapps.com', label: 'Power Apps & BAP', api: 'powerapps' });
    if (!excluded.has('graph'))
        targets.push({ resource: DEFAULT_LOGIN_RESOURCE, label: 'Graph', api: 'graph' });
    return dedupeLoginTargets(targets);
}
function dedupeLoginTargets(targets) {
    const seen = new Set();
    return targets.filter((target) => {
        if (!target.resource || seen.has(target.resource))
            return false;
        seen.add(target.resource);
        return true;
    });
}
