import { join } from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';

export class FlowLanguageProvider {
  private client: LanguageClient | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    void this.startClient();
  }

  private async startClient(): Promise<void> {
    const serverModule = join(this.context.extensionPath, 'dist', 'flow-lsp-server.js');

    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: { module: serverModule, transport: TransportKind.stdio },
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ pattern: '**/flow.json' }],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/flow.json'),
      },
    };

    this.client = new LanguageClient('pp-flow-lsp', 'Power Automate Flow', serverOptions, clientOptions);
    this.context.subscriptions.push(this.client);

    try {
      await this.client.start();
    } catch {
      void vscode.window.showErrorMessage(
        'Power Platform: could not start flow language server.',
      );
    }
  }
}
