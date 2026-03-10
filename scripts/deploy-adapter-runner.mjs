import { spawnSync } from 'node:child_process';
import { stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function formatResult(result) {
  return {
    success: result.success,
    data: result.data,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    suggestedNextActions: result.suggestedNextActions ?? [],
    supportTier: result.supportTier,
    provenance: result.provenance ?? [],
    knownLimitations: result.knownLimitations ?? [],
  };
}

function importWithFreshCache(moduleUrl) {
  return import(`${moduleUrl}?t=${Date.now()}`);
}

function tryBuildWorkspace(parentUrl) {
  const workspaceRoot = fileURLToPath(new URL('..', parentUrl));
  const build = spawnSync('pnpm', ['build'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });

  return {
    success: build.status === 0,
    detail: [build.stdout, build.stderr].filter(Boolean).join('\n').trim(),
  };
}

export async function runDeployAdapterScript({ adapterModulePath, exportName, parentUrl }) {
  try {
    const adapterUrl = pathToFileURL(fileURLToPath(new URL(adapterModulePath, parentUrl))).href;
    let attemptedBuild = false;

    for (;;) {
      let module;

      try {
        module = await importWithFreshCache(adapterUrl);
      } catch (error) {
        if (attemptedBuild) {
          throw error;
        }

        const build = tryBuildWorkspace(parentUrl);

        if (!build.success) {
          throw new Error(build.detail || (error instanceof Error ? error.message : String(error)));
        }

        attemptedBuild = true;
        continue;
      }

      const run = module[exportName];

      if (typeof run !== 'function') {
        if (attemptedBuild) {
          throw new TypeError(`Adapter export "${exportName}" was not found in ${adapterModulePath}.`);
        }

        const build = tryBuildWorkspace(parentUrl);

        if (!build.success) {
          throw new Error(build.detail || `Adapter export "${exportName}" was not found in ${adapterModulePath}.`);
        }

        attemptedBuild = true;
        continue;
      }

      const result = await run();
      stdout.write(`${JSON.stringify(formatResult(result), null, 2)}\n`);
      return result.success ? 0 : 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stdout.write(
      `${JSON.stringify(
        {
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'DEPLOY_ADAPTER_SCRIPT_FAILED',
              message: 'Could not load or execute the deploy adapter script.',
              detail: message,
              source: '@pp/scripts',
            },
          ],
          warnings: [],
          suggestedNextActions: ['Ensure workspace dependencies are installed and the workspace build can complete before invoking the CI deploy wrapper.'],
          supportTier: 'preview',
          provenance: [],
          knownLimitations: [],
        },
        null,
        2
      )}\n`
    );
    return 1;
  }
}
