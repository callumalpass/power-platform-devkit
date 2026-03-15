import * as vscode from 'vscode';
import { runPp } from '../cli';

export function registerCanvasCommands(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Power Platform');
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand('pp.canvas.lint', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickFolder('Select Canvas App folder'));
      if (!appPath) return;
      channel.show(true);
      channel.appendLine(`$ pp canvas lint ${appPath}`);
      await runToChannel(channel, ['canvas', 'lint', appPath]);
    }),

    vscode.commands.registerCommand('pp.canvas.validate', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickFolder('Select Canvas App folder'));
      if (!appPath) return;
      channel.show(true);
      channel.appendLine(`$ pp canvas validate ${appPath}`);
      await runToChannel(channel, ['canvas', 'validate', appPath]);
    }),

    vscode.commands.registerCommand('pp.canvas.build', async (uri?: vscode.Uri) => {
      const appPath = uri?.fsPath ?? (await pickFolder('Select Canvas App folder'));
      if (!appPath) return;
      const outPath = await vscode.window.showInputBox({
        prompt: 'Output path for the built .msapp file',
        placeHolder: 'e.g. dist/MyApp.msapp',
      });
      if (!outPath) return;
      channel.show(true);
      channel.appendLine(`$ pp canvas build ${appPath} --out ${outPath}`);
      await runToChannel(channel, ['canvas', 'build', appPath, '--out', outPath]);
    }),
  );
}

async function runToChannel(channel: vscode.OutputChannel, args: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await runPp(args);
    if (stdout) channel.append(stdout);
    if (stderr) channel.append(stderr);
  } catch (err) {
    channel.appendLine(`Error: ${String(err)}`);
  }
}

async function pickFolder(title: string): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title,
  });
  return uris?.[0]?.fsPath;
}
