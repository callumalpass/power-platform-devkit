import * as vscode from 'vscode';
import { runPpJson } from '../cli';

interface ResolvedSolutionTarget {
  alias: string;
  uniqueName: string;
  environment?: string;
}

interface ResolvedProjectStage {
  name: string;
  environment?: string;
  solutions: Record<string, ResolvedSolutionTarget>;
}

interface ProjectInspectOutput {
  success: boolean;
  topology: {
    stages: Record<string, ResolvedProjectStage>;
    activeEnvironment?: string;
    defaultStage?: string;
  };
  assets: Array<{ name: string; path: string }>;
}

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

  private inspectCache: ProjectInspectOutput | undefined;

  refresh(): void {
    this.inspectCache = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PpTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PpTreeItem): Promise<PpTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    if (!this.inspectCache) return [];
    return this.getSectionChildren(element, this.inspectCache);
  }

  private async getRootItems(): Promise<PpTreeItem[]> {
    if (!vscode.workspace.workspaceFolders?.length) return [];

    try {
      this.inspectCache = await runPpJson<ProjectInspectOutput>(['project', 'inspect']);
    } catch {
      return [];
    }

    if (!this.inspectCache.success) return [];

    return [
      new PpTreeItem('Environments', vscode.TreeItemCollapsibleState.Expanded, 'Environments'),
      new PpTreeItem('Solutions', vscode.TreeItemCollapsibleState.Collapsed, 'Solutions'),
      new PpTreeItem('Assets', vscode.TreeItemCollapsibleState.Collapsed, 'Assets'),
    ];
  }

  private getSectionChildren(element: PpTreeItem, data: ProjectInspectOutput): PpTreeItem[] {
    if (element.sectionLabel === 'Environments') {
      const entries = Object.entries(data.topology.stages);
      if (entries.length === 0 && data.topology.activeEnvironment) {
        return [new PpTreeItem(data.topology.activeEnvironment, vscode.TreeItemCollapsibleState.None, undefined, 'active')];
      }
      return entries.map(([name, stage]) =>
        new PpTreeItem(name, vscode.TreeItemCollapsibleState.None, undefined, stage.environment),
      );
    }

    if (element.sectionLabel === 'Solutions') {
      const seen = new Map<string, string>();
      for (const stage of Object.values(data.topology.stages)) {
        for (const [alias, target] of Object.entries(stage.solutions)) {
          if (!seen.has(alias)) seen.set(alias, target.uniqueName);
        }
      }
      return [...seen.entries()].map(([alias, uniqueName]) =>
        new PpTreeItem(alias, vscode.TreeItemCollapsibleState.None, undefined, uniqueName),
      );
    }

    if (element.sectionLabel === 'Assets') {
      return data.assets.map((asset) =>
        new PpTreeItem(asset.name, vscode.TreeItemCollapsibleState.None, undefined, asset.path),
      );
    }

    return [];
  }
}
