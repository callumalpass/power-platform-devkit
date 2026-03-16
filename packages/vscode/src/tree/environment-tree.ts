import * as vscode from 'vscode';
import { runPpJson } from '../cli';

interface EnvironmentAlias {
  alias: string;
  url: string;
  authProfile: string;
  displayName?: string;
  defaultSolution?: string;
}

interface DiagnosticsBundle {
  defaults: {
    discovered: boolean;
    environment?: string;
    solution?: string;
  };
}

class PpTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly section?: 'Environments',
    description?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
  }
}

export class EnvironmentTreeProvider implements vscode.TreeDataProvider<PpTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<PpTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private environments: EnvironmentAlias[] | undefined;
  private defaultEnv: string | undefined;

  refresh(): void {
    this.environments = undefined;
    this.defaultEnv = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PpTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PpTreeItem): Promise<PpTreeItem[]> {
    if (!element) return this.getRootItems();
    if (element.section === 'Environments') return this.getEnvironmentItems();
    return [];
  }

  private async getRootItems(): Promise<PpTreeItem[]> {
    if (!vscode.workspace.workspaceFolders?.length) return [];

    try {
      const [envs, bundle] = await Promise.all([
        runPpJson<EnvironmentAlias[]>(['env', 'list']),
        runPpJson<DiagnosticsBundle>(['diagnostics', 'bundle']).catch(() => undefined),
      ]);
      this.environments = envs;
      this.defaultEnv = bundle?.defaults.environment;
    } catch {
      return [];
    }

    if (!this.environments?.length) return [];

    return [
      new PpTreeItem('Environments', vscode.TreeItemCollapsibleState.Expanded, 'Environments'),
    ];
  }

  private getEnvironmentItems(): PpTreeItem[] {
    if (!this.environments) return [];
    return this.environments.map((env) => {
      const isDefault = env.alias === this.defaultEnv;
      const item = new PpTreeItem(
        env.alias,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        env.url,
      );
      if (isDefault) {
        item.iconPath = new vscode.ThemeIcon('star-full');
      }
      return item;
    });
  }
}
