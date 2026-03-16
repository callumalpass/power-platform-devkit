import { join } from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';

export class CanvasLanguageProvider {
  private client: LanguageClient | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    const serverModule = join(this.context.extensionPath, 'dist', 'canvas-lsp-server.js');

    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: { module: serverModule, transport: TransportKind.stdio },
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ pattern: '**/*.pa.yaml' }],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.pa.yaml'),
      },
    };

    this.client = new LanguageClient('pp-canvas-lsp', 'Power Apps Canvas', serverOptions, clientOptions);
    this.context.subscriptions.push(this.client);

    try {
      await this.client.start();
    } catch {
      void vscode.window.showErrorMessage(
        'Power Platform: could not start canvas language server.',
      );
    }
  }
}
