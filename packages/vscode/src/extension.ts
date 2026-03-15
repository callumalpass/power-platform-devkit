import * as vscode from 'vscode';
import { CanvasLanguageProvider } from './canvas/canvas-language-provider';
import { registerCanvasCommands } from './canvas/canvas-commands';
import { FlowLanguageProvider } from './flow/flow-language-provider';
import { PpStatusBar } from './status-bar';
import { EnvironmentTreeProvider } from './tree/environment-tree';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const canvasProvider = new CanvasLanguageProvider(context);
  await canvasProvider.activate();
  registerCanvasCommands(context);
  new FlowLanguageProvider(context).activate();
  new PpStatusBar(context).activate();
  const tree = new EnvironmentTreeProvider();
  vscode.window.registerTreeDataProvider('pp.environments', tree);
  context.subscriptions.push(
    vscode.commands.registerCommand('pp.environments.refresh', () => tree.refresh()),
  );
}

export function deactivate(): void {}
