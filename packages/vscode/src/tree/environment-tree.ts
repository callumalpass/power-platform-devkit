import * as vscode from 'vscode';
import { loadProjectConfig, type ProjectConfig } from '@pp/config';

type SectionLabel = 'Environments' | 'Solutions' | 'Assets';

class PpTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly sectionLabel?: SectionLabel,
    description?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
  }
}

export class EnvironmentTreeProvider implements vscode.TreeDataProvider<PpTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<PpTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private config: ProjectConfig | undefined;

  refresh(): void {
    this.config = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PpTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PpTreeItem): Promise<PpTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    if (!this.config) return [];
    return this.getSectionChildren(element);
  }

  private async getRootItems(): Promise<PpTreeItem[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];

    const result = await loadProjectConfig(root);
    if (!result.success || !result.data) return [];

    this.config = result.data.config;
    return [
      new PpTreeItem('Environments', vscode.TreeItemCollapsibleState.Expanded, 'Environments'),
      new PpTreeItem('Solutions', vscode.TreeItemCollapsibleState.Collapsed, 'Solutions'),
      new PpTreeItem('Assets', vscode.TreeItemCollapsibleState.Collapsed, 'Assets'),
    ];
  }

  private getSectionChildren(element: PpTreeItem): PpTreeItem[] {
    const config = this.config;
    if (!config) return [];

    if (element.sectionLabel === 'Environments') {
      const stages = config.topology?.stages ?? {};
      const entries = Object.entries(stages);

      if (entries.length > 0) {
        return entries.map(([name, stage]) =>
          new PpTreeItem(name, vscode.TreeItemCollapsibleState.None, undefined, stage.environment ?? stage.description),
        );
      }

      const defaultEnv = config.defaults?.environment;
      if (defaultEnv) {
        return [new PpTreeItem(defaultEnv, vscode.TreeItemCollapsibleState.None, undefined, 'default')];
      }

      return [];
    }

    if (element.sectionLabel === 'Solutions') {
      return Object.entries(config.solutions ?? {}).map(([name, target]) =>
        new PpTreeItem(name, vscode.TreeItemCollapsibleState.None, undefined, target.uniqueName),
      );
    }

    if (element.sectionLabel === 'Assets') {
      return Object.entries(config.assets ?? {}).map(([name, path]) =>
        new PpTreeItem(name, vscode.TreeItemCollapsibleState.None, undefined, path),
      );
    }

    return [];
  }
}
