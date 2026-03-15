import * as vscode from 'vscode';
import { lintCanvasApp, buildCanvasApp, type CanvasLintDiagnostic } from '@pp/canvas';

let outputChannel: vscode.OutputChannel | undefined;
let commandDiagnostics: vscode.DiagnosticCollection | undefined;

function getOrCreateOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('Power Platform');
  return outputChannel;
}

function getOrCreateDiagnostics(): vscode.DiagnosticCollection {
  commandDiagnostics ??= vscode.languages.createDiagnosticCollection('pp-canvas-commands');
  return commandDiagnostics;
}

async function pickCanvasApp(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: 'Select Canvas App folder',
  });
  return uris?.[0]?.fsPath;
}

function formatDiagnostic(d: CanvasLintDiagnostic): string {
  const loc = d.location?.file
    ? `${d.location.file}:${d.location.start?.line ?? 0}:${d.location.start?.column ?? 0}`
    : '<unknown>';
  return `  [${d.severity}] ${loc} - ${d.message} (${d.code})`;
}

function pushDiagnosticsToProblems(
  collection: vscode.DiagnosticCollection,
  appPath: string,
  diagnostics: CanvasLintDiagnostic[],
): void {
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const d of diagnostics) {
    if (!d.location?.file) continue;
    const absPath = d.location.file.startsWith('/') ? d.location.file : `${appPath}/${d.location.file}`;
    const key = absPath;
    const existing = byFile.get(key) ?? [];

    const startLine = (d.location.start?.line ?? 1) - 1;
    const startChar = (d.location.start?.column ?? 1) - 1;
    const endLine = (d.location.end?.line ?? d.location.start?.line ?? 1) - 1;
    const endChar = (d.location.end?.column ?? d.location.start?.column ?? 1) - 1;

    const severity =
      d.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : d.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    const diag = new vscode.Diagnostic(
      new vscode.Range(startLine, startChar, endLine, endChar),
      d.message,
      severity,
    );
    diag.code = d.code;
    diag.source = d.source;
    existing.push(diag);
    byFile.set(key, existing);
  }

  collection.clear();
  for (const [file, diags] of byFile) {
    collection.set(vscode.Uri.file(file), diags);
  }
}

export function registerCanvasCommands(context: vscode.ExtensionContext): void {
  const diags = getOrCreateDiagnostics();
  context.subscriptions.push(diags);

  context.subscriptions.push(
    vscode.commands.registerCommand('pp.canvas.lint', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickCanvasApp());
      if (!appPath) return;

      const channel = getOrCreateOutputChannel();
      channel.show(true);
      channel.appendLine(`Linting ${appPath}...`);

      const result = await lintCanvasApp(appPath);

      if (!result.success || !result.data) {
        const msgs = result.diagnostics.map((d) => `  [error] ${d.message}`).join('\n');
        channel.appendLine(`Failed to lint canvas app.\n${msgs}`);
        return;
      }

      const report = result.data;
      channel.appendLine(
        `Result: ${report.valid ? 'valid' : 'invalid'} — ${report.summary.errorCount} errors, ${report.summary.warningCount} warnings, ${report.summary.infoCount} info`,
      );

      for (const d of report.diagnostics) {
        channel.appendLine(formatDiagnostic(d));
      }

      pushDiagnosticsToProblems(diags, appPath, report.diagnostics);
    }),

    vscode.commands.registerCommand('pp.canvas.validate', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickCanvasApp());
      if (!appPath) return;

      const channel = getOrCreateOutputChannel();
      channel.show(true);
      channel.appendLine(`Validating ${appPath}...`);

      const result = await lintCanvasApp(appPath, { mode: 'strict' });

      if (!result.success || !result.data) {
        const msgs = result.diagnostics.map((d) => `  [error] ${d.message}`).join('\n');
        channel.appendLine(`Failed to validate canvas app.\n${msgs}`);
        return;
      }

      const report = result.data;
      channel.appendLine(
        `Result: ${report.valid ? 'valid' : 'invalid'} — ${report.summary.errorCount} errors, ${report.summary.warningCount} warnings, ${report.summary.infoCount} info`,
      );

      for (const d of report.diagnostics) {
        channel.appendLine(formatDiagnostic(d));
      }

      pushDiagnosticsToProblems(diags, appPath, report.diagnostics);
    }),

    vscode.commands.registerCommand('pp.canvas.build', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickCanvasApp());
      if (!appPath) return;

      const outPath = await vscode.window.showInputBox({
        prompt: 'Output path for the built .msapp file',
        placeHolder: 'e.g. dist/MyApp.msapp',
      });
      if (!outPath) return;

      const channel = getOrCreateOutputChannel();
      channel.show(true);
      channel.appendLine(`Building ${appPath} → ${outPath}...`);

      const result = await buildCanvasApp(appPath, { outPath });

      if (!result.success || !result.data) {
        const msgs = result.diagnostics.map((d) => `  [error] ${d.message}`).join('\n');
        channel.appendLine(`Build failed.\n${msgs}`);
        return;
      }

      channel.appendLine(`Build succeeded: ${result.data.outPath}`);
      channel.appendLine(`  SHA-256: ${result.data.outFileSha256}`);
    }),
  );
}
