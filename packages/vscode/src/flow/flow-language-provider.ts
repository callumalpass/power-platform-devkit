import * as vscode from 'vscode';
import {
  FlowLspSession,
  type LspPublishDiagnosticsParams,
  type LspDiagnostic,
  type LspHover,
  type LspCompletionItem,
  type LspLocation,
  type LspDocumentSymbol,
} from '@pp/flow-language-server';

const SELECTOR: vscode.DocumentSelector = { pattern: '**/flow.json', language: 'json' };
const FLOW_KIND_MARKER = '"pp.flow.artifact"';

function lspRangeToVscode(r: { start: { line: number; character: number }; end: { line: number; character: number } }): vscode.Range {
  return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
}

function lspSeverityToVscode(s: 1 | 2 | 3 | 4): vscode.DiagnosticSeverity {
  return (s - 1) as vscode.DiagnosticSeverity;
}

function lspCompletionKindToVscode(kind: number | undefined): vscode.CompletionItemKind {
  if (kind === undefined) return vscode.CompletionItemKind.Text;
  return (kind - 1) as vscode.CompletionItemKind;
}

function lspSymbolKindToVscode(kind: number): vscode.SymbolKind {
  return (kind - 1) as vscode.SymbolKind;
}

function isFlowDocument(doc: vscode.TextDocument): boolean {
  return doc.fileName.endsWith('flow.json') && doc.getText().includes(FLOW_KIND_MARKER);
}

function toDocumentSymbols(symbols: LspDocumentSymbol[]): vscode.DocumentSymbol[] {
  return symbols.map((s) => {
    const sym = new vscode.DocumentSymbol(
      s.name,
      '',
      lspSymbolKindToVscode(s.kind),
      lspRangeToVscode(s.range),
      lspRangeToVscode(s.selectionRange),
    );
    if (s.children && s.children.length > 0) {
      sym.children = toDocumentSymbols(s.children);
    }
    return sym;
  });
}

export class FlowLanguageProvider {
  private session!: FlowLspSession;
  private diagnostics!: vscode.DiagnosticCollection;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    this.diagnostics = vscode.languages.createDiagnosticCollection('pp-flow');
    this.context.subscriptions.push(this.diagnostics);

    this.session = new FlowLspSession({
      publishDiagnostics: (params) => this.handlePublishDiagnostics(params),
    });

    this.session.handleRequest('initialize', {});
    this.session.handleNotification('initialized', {});

    this.registerProviders();
    this.registerDocumentTracking();

    // Replay already-open flow.json documents
    for (const doc of vscode.workspace.textDocuments) {
      if (isFlowDocument(doc)) {
        this.session.handleNotification('textDocument/didOpen', {
          textDocument: { uri: doc.uri.toString(), text: doc.getText(), version: doc.version },
        });
      }
    }
  }

  private registerProviders(): void {
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(SELECTOR, {
        provideHover: (document, position) => {
          if (!isFlowDocument(document)) return null;
          const result = this.session.handleRequest('textDocument/hover', {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          }) as LspHover | null;

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
          provideCompletionItems: (document, position) => {
            if (!isFlowDocument(document)) return [];
            const results = this.session.handleRequest('textDocument/completion', {
              textDocument: { uri: document.uri.toString() },
              position: { line: position.line, character: position.character },
            }) as LspCompletionItem[];

            return results.map((item) => {
              const ci = new vscode.CompletionItem(item.label, lspCompletionKindToVscode(item.kind));
              ci.detail = item.detail;
              ci.documentation = item.documentation ? new vscode.MarkdownString(item.documentation) : undefined;
              return ci;
            });
          },
        },
        '"', "'", '.', '/',
      ),

      vscode.languages.registerDefinitionProvider(SELECTOR, {
        provideDefinition: (document, position) => {
          if (!isFlowDocument(document)) return null;
          const result = this.session.handleRequest('textDocument/definition', {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          }) as LspLocation | null;

          if (!result) return null;
          return new vscode.Location(vscode.Uri.parse(result.uri), lspRangeToVscode(result.range));
        },
      }),

      vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
        provideDocumentSymbols: (document) => {
          if (!isFlowDocument(document)) return [];
          const results = this.session.handleRequest('textDocument/documentSymbol', {
            textDocument: { uri: document.uri.toString() },
          }) as LspDocumentSymbol[];

          return toDocumentSymbols(results);
        },
      }),
    );
  }

  private registerDocumentTracking(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (!isFlowDocument(doc)) return;
        this.session.handleNotification('textDocument/didOpen', {
          textDocument: { uri: doc.uri.toString(), text: doc.getText(), version: doc.version },
        });
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isFlowDocument(event.document)) return;
        this.session.handleNotification('textDocument/didChange', {
          textDocument: { uri: event.document.uri.toString(), version: event.document.version },
          contentChanges: [{ text: event.document.getText() }],
        });
      }),

      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (!doc.fileName.endsWith('flow.json')) return;
        this.session.handleNotification('textDocument/didClose', {
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
