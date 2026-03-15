import * as vscode from 'vscode';
import { loadProjectConfig } from '@pp/config';

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

  private async refresh(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.item.hide();
      return;
    }

    const result = await loadProjectConfig(root);
    if (result.success && result.data) {
      const env = result.data.config.defaults?.environment ?? 'no env';
      this.item.text = `$(cloud) ${env}`;
      this.item.tooltip = `Power Platform project: ${result.data.path}`;
      this.item.show();
    } else {
      this.item.hide();
    }
  }
}
