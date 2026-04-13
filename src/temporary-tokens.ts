import { randomUUID } from 'node:crypto';
import { decodeJwtClaims, type TokenProvider } from './auth.js';
import { buildRequest, normalizeOrigin, type ApiKind } from './request-executor.js';
import type { Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export interface TemporaryTokenSummary {
  id: string;
  name: string;
  audience?: string;
  subject?: string;
  tenantId?: string;
  scopes?: string[];
  roles?: string[];
  expiresAt?: number;
  match: TemporaryTokenMatch;
  createdAt: string;
}

export type TemporaryTokenMatch =
  | { kind: 'origin'; origin: string }
  | { kind: 'api'; api: Exclude<ApiKind, 'custom'> }
  | { kind: 'audience'; audience: string };

interface TemporaryTokenEntry extends TemporaryTokenSummary {
  token: string;
}

export class StaticBearerTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

export class TemporaryTokenStore {
  private readonly entries = new Map<string, TemporaryTokenEntry>();

  add(input: { name?: string; token: string; match?: TemporaryTokenMatch }): OperationResult<TemporaryTokenSummary> {
    const token = normalizeBearerToken(input.token);
    if (!token) {
      return fail(createDiagnostic('error', 'TEMP_TOKEN_REQUIRED', 'A bearer token is required.', { source: 'pp/temp-tokens' }));
    }
    const claims = decodeJwtClaims(token);
    const expiresAt = readNumericClaim(claims, 'exp');
    if (expiresAt !== undefined && expiresAt * 1000 <= Date.now()) {
      return fail(createDiagnostic('error', 'TEMP_TOKEN_EXPIRED', 'The pasted bearer token is already expired.', { source: 'pp/temp-tokens' }));
    }
    const audience = readStringClaim(claims, 'aud');
    const match = input.match ?? inferMatch(audience);
    if (!match) {
      return fail(createDiagnostic('error', 'TEMP_TOKEN_MATCH_REQUIRED', 'Choose an API, origin, or audience for this token.', { source: 'pp/temp-tokens' }));
    }
    const entry: TemporaryTokenEntry = {
      id: randomUUID(),
      name: input.name?.trim() || defaultTokenName(match),
      token,
      audience,
      subject: readStringClaim(claims, 'preferred_username') ?? readStringClaim(claims, 'upn') ?? readStringClaim(claims, 'oid'),
      tenantId: readStringClaim(claims, 'tid'),
      scopes: readStringListClaim(claims, 'scp'),
      roles: readStringListClaim(claims, 'roles'),
      expiresAt,
      match,
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    this.pruneExpired();
    return ok(summarize(entry));
  }

  list(): TemporaryTokenSummary[] {
    this.pruneExpired();
    return [...this.entries.values()].map(summarize);
  }

  remove(idOrName: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.id === idOrName || entry.name === idOrName) {
        this.entries.delete(entry.id);
        return true;
      }
    }
    return false;
  }

  resolve(input: { idOrName?: string; environment: Environment; api: ApiKind; path: string }): OperationResult<{ summary: TemporaryTokenSummary; provider: TokenProvider } | undefined> {
    this.pruneExpired();
    const candidates = input.idOrName
      ? [...this.entries.values()].filter((entry) => entry.id === input.idOrName || entry.name === input.idOrName)
      : [...this.entries.values()];
    for (const entry of candidates) {
      if (matches(entry, input.environment, input.api, input.path)) {
        return ok({ summary: summarize(entry), provider: new StaticBearerTokenProvider(entry.token) });
      }
    }
    return input.idOrName
      ? fail(createDiagnostic('error', 'TEMP_TOKEN_NOT_FOUND', `No matching temporary token named ${input.idOrName} is available for this request.`, { source: 'pp/temp-tokens' }))
      : ok(undefined);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.expiresAt !== undefined && entry.expiresAt * 1000 <= now) {
        this.entries.delete(entry.id);
      }
    }
  }
}

function normalizeBearerToken(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
}

function inferMatch(audience: string | undefined): TemporaryTokenMatch | undefined {
  if (!audience) return undefined;
  if (audience === 'https://graph.microsoft.com') return { kind: 'api', api: 'graph' };
  if (audience === 'https://service.flow.microsoft.com') return { kind: 'api', api: 'flow' };
  if (audience === 'https://service.powerapps.com') return { kind: 'api', api: 'powerapps' };
  if (/^https:\/\/[^/]+/i.test(audience)) return { kind: 'origin', origin: normalizeOrigin(audience) };
  return { kind: 'audience', audience };
}

function matches(entry: TemporaryTokenEntry, environment: Environment, api: ApiKind, path: string): boolean {
  const match = entry.match;
  if (match.kind === 'api') return api === match.api;
  const request = buildRequest(environment, '', path, api);
  if (!request.success || !request.data) return false;
  if (match.kind === 'audience') {
    return audienceMatchesRequest(match.audience, request.data.authResource);
  }
  return normalizeOrigin(request.data.baseUrl ?? request.data.authResource) === normalizeOrigin(match.origin);
}

function audienceMatchesRequest(audience: string, authResource: string): boolean {
  if (audience === authResource) return true;
  try {
    return normalizeOrigin(audience) === normalizeOrigin(authResource);
  } catch {
    return false;
  }
}

function defaultTokenName(match: TemporaryTokenMatch): string {
  if (match.kind === 'api') return match.api;
  if (match.kind === 'origin') return new URL(match.origin).hostname;
  return match.audience;
}

function summarize(entry: TemporaryTokenEntry): TemporaryTokenSummary {
  const { token: _token, ...summary } = entry;
  return summary;
}

function readStringClaim(claims: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = claims?.[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumericClaim(claims: Record<string, unknown> | undefined, name: string): number | undefined {
  const value = claims?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringListClaim(claims: Record<string, unknown> | undefined, name: string): string[] | undefined {
  const value = claims?.[name];
  if (typeof value === 'string') {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length ? parts : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
    return parts.length ? parts : undefined;
  }
  return undefined;
}
