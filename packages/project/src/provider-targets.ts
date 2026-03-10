import type { ProviderBinding } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';

export type SharePointBindingKind = 'sharepoint-site' | 'sharepoint-list' | 'sharepoint-file';
export type PowerBiBindingKind = 'powerbi' | 'powerbi-workspace' | 'powerbi-dataset' | 'powerbi-report';

export interface ProviderBindingResolverContext {
  providerBindings: Record<string, ProviderBinding>;
}

export interface ResolvedSharePointReference {
  bindingName?: string;
  value: string;
  source: 'binding' | 'literal';
  referenceType: 'url' | 'id' | 'title' | 'path' | 'name';
}

export interface ResolvedSharePointTarget {
  kind: SharePointBindingKind;
  bindingName?: string;
  authProfile?: string;
  metadata: Record<string, unknown>;
  site: ResolvedSharePointReference;
  list?: ResolvedSharePointReference;
  drive?: ResolvedSharePointReference;
  file?: ResolvedSharePointReference;
}

export interface ResolvedPowerBiReference {
  bindingName?: string;
  value: string;
  source: 'binding' | 'literal';
  referenceType: 'id' | 'name';
}

export interface ResolvedPowerBiTarget {
  kind: 'powerbi-workspace' | 'powerbi-dataset' | 'powerbi-report';
  bindingName?: string;
  authProfile?: string;
  metadata: Record<string, unknown>;
  workspace: ResolvedPowerBiReference;
  dataset?: ResolvedPowerBiReference;
  report?: ResolvedPowerBiReference;
}

export interface ResolveSharePointTargetOptions {
  expectedKind: 'sharepoint-site' | 'sharepoint-list' | 'sharepoint-file';
  site?: string;
  drive?: string;
}

export interface ResolvePowerBiTargetOptions {
  expectedKind: 'powerbi-workspace' | 'powerbi-dataset' | 'powerbi-report';
  workspace?: string;
}

export function resolveSharePointTarget(
  context: ProviderBindingResolverContext,
  reference: string,
  options: ResolveSharePointTargetOptions
): OperationResult<ResolvedSharePointTarget> {
  return resolveSharePointReference(context, reference, options, new Set());
}

export function resolvePowerBiTarget(
  context: ProviderBindingResolverContext,
  reference: string,
  options: ResolvePowerBiTargetOptions
): OperationResult<ResolvedPowerBiTarget> {
  return resolvePowerBiReference(context, reference, options, new Set());
}

function resolveSharePointReference(
  context: ProviderBindingResolverContext,
  reference: string,
  options: ResolveSharePointTargetOptions,
  stack: Set<string>
): OperationResult<ResolvedSharePointTarget> {
  const binding = context.providerBindings[reference];

  if (binding) {
    return resolveSharePointBinding(context, reference, binding, options, stack);
  }

  switch (options.expectedKind) {
    case 'sharepoint-site':
      return ok(
        {
          kind: 'sharepoint-site',
          metadata: {},
          site: createSharePointSiteReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    case 'sharepoint-list': {
      if (!options.site) {
        return fail(
          createDiagnostic(
            'error',
            'PROJECT_SHAREPOINT_SITE_REQUIRED',
            'SharePoint list resolution requires a site binding or site reference.',
            {
              source: '@pp/project',
              hint: 'Provide `--site <binding-or-url>` or use a `sharepoint-list` binding that declares `metadata.site`.',
            }
          )
        );
      }

      const siteResult = resolveSharePointReference(
        context,
        options.site,
        {
          expectedKind: 'sharepoint-site',
        },
        stack
      );

      if (!siteResult.success || !siteResult.data) {
        return siteResult as unknown as OperationResult<ResolvedSharePointTarget>;
      }

      return ok(
        {
          kind: 'sharepoint-list',
          authProfile: siteResult.data.authProfile,
          metadata: {},
          site: siteResult.data.site,
          list: createSharePointListReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    }
    case 'sharepoint-file': {
      if (!options.site) {
        return fail(
          createDiagnostic(
            'error',
            'PROJECT_SHAREPOINT_SITE_REQUIRED',
            'SharePoint file resolution requires a site binding or site reference.',
            {
              source: '@pp/project',
              hint: 'Provide `--site <binding-or-url>` or use a `sharepoint-file` binding that declares `metadata.site`.',
            }
          )
        );
      }

      const siteResult = resolveSharePointReference(
        context,
        options.site,
        {
          expectedKind: 'sharepoint-site',
        },
        stack
      );

      if (!siteResult.success || !siteResult.data) {
        return siteResult as unknown as OperationResult<ResolvedSharePointTarget>;
      }

      return ok(
        {
          kind: 'sharepoint-file',
          authProfile: siteResult.data.authProfile,
          metadata: {},
          site: siteResult.data.site,
          drive: options.drive ? createSharePointDriveReference(options.drive, 'literal') : undefined,
          file: createSharePointFileReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    }
  }
}

function resolveSharePointBinding(
  context: ProviderBindingResolverContext,
  bindingName: string,
  binding: ProviderBinding,
  options: ResolveSharePointTargetOptions,
  stack: Set<string>
): OperationResult<ResolvedSharePointTarget> {
  if (!isSharePointBindingKind(binding.kind)) {
    return fail(
      createDiagnostic(
        'error',
        'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
        `Provider binding ${bindingName} has kind ${binding.kind}, not a SharePoint binding.`,
        {
          source: '@pp/project',
        }
      )
    );
  }

  if (stack.has(bindingName)) {
    return fail(
      createDiagnostic(
        'error',
        'PROJECT_PROVIDER_BINDING_CYCLE',
        `Provider binding ${bindingName} forms a recursive SharePoint binding cycle.`,
        {
          source: '@pp/project',
        }
      )
    );
  }

  stack.add(bindingName);
  try {
    switch (binding.kind) {
      case 'sharepoint-site': {
        if (options.expectedKind !== 'sharepoint-site') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a SharePoint site, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        return ok(
          {
            kind: 'sharepoint-site',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile'),
            metadata: binding.metadata ?? {},
            site: createSharePointSiteReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
      case 'sharepoint-list': {
        if (options.expectedKind !== 'sharepoint-list') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a SharePoint list, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const siteReference = readMetadataString(binding.metadata, 'site');

        if (!siteReference) {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_INVALID',
              `Provider binding ${bindingName} must declare metadata.site to resolve a SharePoint list target.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const siteResult = resolveSharePointReference(
          context,
          siteReference,
          {
            expectedKind: 'sharepoint-site',
          },
          stack
        );

        if (!siteResult.success || !siteResult.data) {
          return siteResult as unknown as OperationResult<ResolvedSharePointTarget>;
        }

        return ok(
          {
            kind: 'sharepoint-list',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile') ?? siteResult.data.authProfile,
            metadata: binding.metadata ?? {},
            site: siteResult.data.site,
            list: createSharePointListReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
      case 'sharepoint-file': {
        if (options.expectedKind !== 'sharepoint-file') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a SharePoint file, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const siteReference = readMetadataString(binding.metadata, 'site');

        if (!siteReference) {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_INVALID',
              `Provider binding ${bindingName} must declare metadata.site to resolve a SharePoint file target.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const siteResult = resolveSharePointReference(
          context,
          siteReference,
          {
            expectedKind: 'sharepoint-site',
          },
          stack
        );

        if (!siteResult.success || !siteResult.data) {
          return siteResult as unknown as OperationResult<ResolvedSharePointTarget>;
        }

        const driveReference = readMetadataString(binding.metadata, 'drive') ?? options.drive;

        return ok(
          {
            kind: 'sharepoint-file',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile') ?? siteResult.data.authProfile,
            metadata: binding.metadata ?? {},
            site: siteResult.data.site,
            drive: driveReference ? createSharePointDriveReference(driveReference, 'binding') : undefined,
            file: createSharePointFileReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
    }
  } finally {
    stack.delete(bindingName);
  }
}

function resolvePowerBiReference(
  context: ProviderBindingResolverContext,
  reference: string,
  options: ResolvePowerBiTargetOptions,
  stack: Set<string>
): OperationResult<ResolvedPowerBiTarget> {
  const binding = context.providerBindings[reference];

  if (binding) {
    return resolvePowerBiBinding(context, reference, binding, options, stack);
  }

  switch (options.expectedKind) {
    case 'powerbi-workspace':
      return ok(
        {
          kind: 'powerbi-workspace',
          metadata: {},
          workspace: createPowerBiReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    case 'powerbi-dataset': {
      if (!options.workspace) {
        return fail(
          createDiagnostic(
            'error',
            'PROJECT_POWERBI_WORKSPACE_REQUIRED',
            'Power BI dataset resolution requires a workspace binding or workspace reference.',
            {
              source: '@pp/project',
              hint: 'Provide `--workspace <binding-or-name>` or use a `powerbi-dataset` binding that declares `metadata.workspace`.',
            }
          )
        );
      }

      const workspaceResult = resolvePowerBiReference(
        context,
        options.workspace,
        {
          expectedKind: 'powerbi-workspace',
        },
        stack
      );

      if (!workspaceResult.success || !workspaceResult.data) {
        return workspaceResult as unknown as OperationResult<ResolvedPowerBiTarget>;
      }

      return ok(
        {
          kind: 'powerbi-dataset',
          authProfile: workspaceResult.data.authProfile,
          metadata: {},
          workspace: workspaceResult.data.workspace,
          dataset: createPowerBiReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    }
    case 'powerbi-report': {
      if (!options.workspace) {
        return fail(
          createDiagnostic(
            'error',
            'PROJECT_POWERBI_WORKSPACE_REQUIRED',
            'Power BI report resolution requires a workspace binding or workspace reference.',
            {
              source: '@pp/project',
              hint: 'Provide `--workspace <binding-or-name>` or use a `powerbi-report` binding that declares `metadata.workspace`.',
            }
          )
        );
      }

      const workspaceResult = resolvePowerBiReference(
        context,
        options.workspace,
        {
          expectedKind: 'powerbi-workspace',
        },
        stack
      );

      if (!workspaceResult.success || !workspaceResult.data) {
        return workspaceResult as unknown as OperationResult<ResolvedPowerBiTarget>;
      }

      return ok(
        {
          kind: 'powerbi-report',
          authProfile: workspaceResult.data.authProfile,
          metadata: {},
          workspace: workspaceResult.data.workspace,
          report: createPowerBiReference(reference, 'literal'),
        },
        {
          supportTier: 'preview',
        }
      );
    }
  }
}

function resolvePowerBiBinding(
  context: ProviderBindingResolverContext,
  bindingName: string,
  binding: ProviderBinding,
  options: ResolvePowerBiTargetOptions,
  stack: Set<string>
): OperationResult<ResolvedPowerBiTarget> {
  if (!isPowerBiBindingKind(binding.kind)) {
    return fail(
      createDiagnostic(
        'error',
        'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
        `Provider binding ${bindingName} has kind ${binding.kind}, not a Power BI binding.`,
        {
          source: '@pp/project',
        }
      )
    );
  }

  if (stack.has(bindingName)) {
    return fail(
      createDiagnostic(
        'error',
        'PROJECT_PROVIDER_BINDING_CYCLE',
        `Provider binding ${bindingName} forms a recursive Power BI binding cycle.`,
        {
          source: '@pp/project',
        }
      )
    );
  }

  stack.add(bindingName);
  try {
    switch (binding.kind) {
      case 'powerbi':
      case 'powerbi-workspace': {
        if (options.expectedKind !== 'powerbi-workspace') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a Power BI workspace, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        return ok(
          {
            kind: 'powerbi-workspace',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile'),
            metadata: binding.metadata ?? {},
            workspace: createPowerBiReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
      case 'powerbi-dataset': {
        if (options.expectedKind !== 'powerbi-dataset') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a Power BI dataset, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const workspaceReference = readMetadataString(binding.metadata, 'workspace');

        if (!workspaceReference) {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_INVALID',
              `Provider binding ${bindingName} must declare metadata.workspace to resolve a Power BI dataset target.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const workspaceResult = resolvePowerBiReference(
          context,
          workspaceReference,
          {
            expectedKind: 'powerbi-workspace',
          },
          stack
        );

        if (!workspaceResult.success || !workspaceResult.data) {
          return workspaceResult as unknown as OperationResult<ResolvedPowerBiTarget>;
        }

        return ok(
          {
            kind: 'powerbi-dataset',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile') ?? workspaceResult.data.authProfile,
            metadata: binding.metadata ?? {},
            workspace: workspaceResult.data.workspace,
            dataset: createPowerBiReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
      case 'powerbi-report': {
        if (options.expectedKind !== 'powerbi-report') {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_KIND_MISMATCH',
              `Provider binding ${bindingName} resolves to a Power BI report, not ${options.expectedKind}.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const workspaceReference = readMetadataString(binding.metadata, 'workspace');

        if (!workspaceReference) {
          return fail(
            createDiagnostic(
              'error',
              'PROJECT_PROVIDER_BINDING_INVALID',
              `Provider binding ${bindingName} must declare metadata.workspace to resolve a Power BI report target.`,
              {
                source: '@pp/project',
              }
            )
          );
        }

        const workspaceResult = resolvePowerBiReference(
          context,
          workspaceReference,
          {
            expectedKind: 'powerbi-workspace',
          },
          stack
        );

        if (!workspaceResult.success || !workspaceResult.data) {
          return workspaceResult as unknown as OperationResult<ResolvedPowerBiTarget>;
        }

        return ok(
          {
            kind: 'powerbi-report',
            bindingName,
            authProfile: readMetadataString(binding.metadata, 'authProfile') ?? workspaceResult.data.authProfile,
            metadata: binding.metadata ?? {},
            workspace: workspaceResult.data.workspace,
            report: createPowerBiReference(binding.target, 'binding', bindingName),
          },
          {
            supportTier: 'preview',
          }
        );
      }
    }
  } finally {
    stack.delete(bindingName);
  }
}

function readMetadataString(metadata: ProviderBinding['metadata'], key: string): string | undefined {
  return typeof metadata?.[key] === 'string' ? (metadata[key] as string) : undefined;
}

function isSharePointBindingKind(kind: string): kind is SharePointBindingKind {
  return kind === 'sharepoint-site' || kind === 'sharepoint-list' || kind === 'sharepoint-file';
}

function isPowerBiBindingKind(kind: string): kind is PowerBiBindingKind {
  return kind === 'powerbi' || kind === 'powerbi-workspace' || kind === 'powerbi-dataset' || kind === 'powerbi-report';
}

function createSharePointSiteReference(
  value: string,
  source: 'binding' | 'literal',
  bindingName?: string
): ResolvedSharePointReference {
  return {
    bindingName,
    value,
    source,
    referenceType: isUrl(value) ? 'url' : 'id',
  };
}

function createSharePointListReference(
  value: string,
  source: 'binding' | 'literal',
  bindingName?: string
): ResolvedSharePointReference {
  return {
    bindingName,
    value,
    source,
    referenceType: isGuid(value) ? 'id' : 'title',
  };
}

function createSharePointDriveReference(value: string, source: 'binding' | 'literal'): ResolvedSharePointReference {
  return {
    value,
    source,
    referenceType: isGuid(value) ? 'id' : 'name',
  };
}

function createSharePointFileReference(
  value: string,
  source: 'binding' | 'literal',
  bindingName?: string
): ResolvedSharePointReference {
  return {
    bindingName,
    value,
    source,
    referenceType: isLikelyPath(value) ? 'path' : 'id',
  };
}

function createPowerBiReference(value: string, source: 'binding' | 'literal', bindingName?: string): ResolvedPowerBiReference {
  return {
    bindingName,
    value,
    source,
    referenceType: isGuid(value) ? 'id' : 'name',
  };
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLikelyPath(value: string): boolean {
  return value.startsWith('/') || value.includes('/');
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
