import * as vscode from 'vscode';
import { runPpJson } from './cli';

interface ProjectInspectOutput {
  success: boolean;
  canonicalProjectRoot: string;
  summary: { defaultEnvironment?: string };
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
      const result = await runPpJson<ProjectInspectOutput>(['project', 'inspect']);
      if (result.success) {
        const env = result.summary.defaultEnvironment ?? 'no env';
        this.item.text = `$(cloud) ${env}`;
        this.item.tooltip = `Power Platform project: ${result.canonicalProjectRoot}`;
        this.item.show();
      } else {
        this.item.hide();
      }
    } catch {
      this.item.hide();
    }
  }
}
