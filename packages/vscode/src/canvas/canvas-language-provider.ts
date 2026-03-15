import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { findLspBinary } from '../cli';

export class CanvasLanguageProvider {
  private client: LanguageClient | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    const command = await findLspBinary('pp-canvas-lsp');

    const serverOptions: ServerOptions = {
      run: { command, transport: TransportKind.stdio },
      debug: { command, transport: TransportKind.stdio },
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
        'Power Platform: could not start canvas language server. Make sure `pp-canvas-lsp` is on PATH or installed in node_modules/.bin.',
      );
    }
  }
}
