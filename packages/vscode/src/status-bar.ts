import * as vscode from 'vscode';
import { runPpJson } from './cli';

interface DiagnosticsBundle {
  defaults: {
    discovered: boolean;
    configPath?: string;
    environment?: string;
    solution?: string;
  };
}

export class PpStatusBar {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    this.item.command = 'pp.environments.refresh';
    this.context.subscriptions.push(this.item);
    void this.refresh();

    const watcher = vscode.workspace.createFileSystemWatcher('**/pp.config.*');
    watcher.onDidChange(() => void this.refresh());
    watcher.onDidCreate(() => void this.refresh());
    watcher.onDidDelete(() => void this.refresh());
    this.context.subscriptions.push(watcher);
  }

  async refresh(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      this.item.hide();
      return;
    }

    try {
      const result = await runPpJson<DiagnosticsBundle>(['diagnostics', 'bundle']);
      if (result.defaults.discovered) {
        const env = result.defaults.environment ?? 'no env';
        this.item.text = `$(cloud) ${env}`;
        this.item.tooltip = result.defaults.configPath
          ? `pp config: ${result.defaults.configPath}`
          : 'pp: no config file';
        this.item.show();
      } else {
        this.item.hide();
      }
    } catch {
      this.item.hide();
    }
  }
}
