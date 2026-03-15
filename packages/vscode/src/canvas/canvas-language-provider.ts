import * as vscode from 'vscode';
import {
  CanvasLspSession,
  type LspRange,
  type LspDiagnostic,
  type LspPublishDiagnosticsParams,
  type LspHover,
  type LspCompletionItem,
  type LspLocation,
} from '@pp/canvas/lsp';

const SELECTOR: vscode.DocumentSelector = { pattern: '**/*.pa.yaml' };

function lspRangeToVscode(r: LspRange): vscode.Range {
  return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
}

function lspSeverityToVscode(s: 1 | 2 | 3 | 4): vscode.DiagnosticSeverity {
  return (s - 1) as vscode.DiagnosticSeverity;
}

function lspCompletionKindToVscode(kind: number | undefined): vscode.CompletionItemKind {
  if (kind === undefined) return vscode.CompletionItemKind.Text;
  return (kind - 1) as vscode.CompletionItemKind;
}

export class CanvasLanguageProvider {
  private session!: CanvasLspSession;
  private diagnostics!: vscode.DiagnosticCollection;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    this.diagnostics = vscode.languages.createDiagnosticCollection('pp-canvas');
    this.context.subscriptions.push(this.diagnostics);

    this.session = new CanvasLspSession({
      projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      mode: 'strict',
      publishDiagnostics: (params) => this.handlePublishDiagnostics(params),
    });

    await this.session.handleRequest('initialize', {});
    await this.session.handleNotification('initialized', {});

    this.registerProviders();
    this.registerDocumentTracking();

    // Replay already-open .pa.yaml documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.fsPath.endsWith('.pa.yaml')) {
        await this.session.handleNotification('textDocument/didOpen', {
          textDocument: { uri: doc.uri.toString(), text: doc.getText(), version: doc.version },
        });
      }
    }
  }

  private registerProviders(): void {
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(SELECTOR, {
        provideHover: async (document, position) => {
          const result = (await this.session.handleRequest('textDocument/hover', {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          })) as LspHover | null;

          if (!result) return null;
          return new vscode.Hover(
            new vscode.MarkdownString(result.contents.value),
            result.range ? lspRangeToVscode(result.range) : undefined,
          );
        },
      }),

      vscode.languages.registerCompletionItemProvider(
        SELECTOR,
        {
          provideCompletionItems: async (document, position) => {
            const results = (await this.session.handleRequest('textDocument/completion', {
              textDocument: { uri: document.uri.toString() },
              position: { line: position.line, character: position.character },
            })) as LspCompletionItem[];

            return results.map((item) => {
              const ci = new vscode.CompletionItem(item.label, lspCompletionKindToVscode(item.kind));
              ci.detail = item.detail;
              ci.documentation = item.documentation ? new vscode.MarkdownString(item.documentation) : undefined;
              return ci;
            });
          },
        },
        '=',
        '.',
        ':',
      ),

      vscode.languages.registerDefinitionProvider(SELECTOR, {
        provideDefinition: async (document, position) => {
          const results = (await this.session.handleRequest('textDocument/definition', {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          })) as LspLocation[] | null;

          if (!results) return null;
          return results.map(
            (loc) => new vscode.Location(vscode.Uri.parse(loc.uri), lspRangeToVscode(loc.range)),
          );
        },
      }),
    );
  }

  private registerDocumentTracking(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (!doc.uri.fsPath.endsWith('.pa.yaml')) return;
        await this.session.handleNotification('textDocument/didOpen', {
          textDocument: { uri: doc.uri.toString(), text: doc.getText(), version: doc.version },
        });
      }),

      vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (!event.document.uri.fsPath.endsWith('.pa.yaml')) return;
        await this.session.handleNotification('textDocument/didChange', {
          textDocument: { uri: event.document.uri.toString(), version: event.document.version },
          contentChanges: [{ text: event.document.getText() }],
        });
      }),

      vscode.workspace.onDidCloseTextDocument(async (doc) => {
        if (!doc.uri.fsPath.endsWith('.pa.yaml')) return;
        await this.session.handleNotification('textDocument/didClose', {
          textDocument: { uri: doc.uri.toString() },
        });
      }),
    );
  }

  private handlePublishDiagnostics(params: LspPublishDiagnosticsParams): void {
    const uri = vscode.Uri.parse(params.uri);
    const diagnostics = params.diagnostics.map((d: LspDiagnostic) => {
      const diag = new vscode.Diagnostic(
        lspRangeToVscode(d.range),
        d.message,
        lspSeverityToVscode(d.severity),
      );
      diag.code = d.code;
      diag.source = d.source;
      return diag;
    });
    this.diagnostics.set(uri, diagnostics);
  }
}
