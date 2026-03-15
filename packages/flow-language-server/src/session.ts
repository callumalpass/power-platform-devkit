import * as store from './document-store.js';
import { convertDiagnostics } from './providers/diagnostics.js';
import { provideSymbols } from './providers/symbols.js';
import { provideHover } from './providers/hover.js';
import { provideDefinition } from './providers/definition.js';
import { provideCompletions } from './providers/completion.js';

export interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspPublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
}

export interface LspHover {
  contents: { kind: 'markdown' | 'plaintext'; value: string };
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface FlowLspSessionOptions {
  publishDiagnostics?: (params: LspPublishDiagnosticsParams) => void;
}

export class FlowLspSession {
  constructor(private readonly options: FlowLspSessionOptions = {}) {}

  handleRequest(method: string, params: unknown): unknown {
    switch (method) {
      case 'initialize':
        return {
          capabilities: {
            textDocumentSync: { openClose: true, change: 1 },
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            completionProvider: { triggerCharacters: ['"', "'", '.', '/'] },
          },
          serverInfo: { name: 'pp-flow-lsp', version: '0.1.0' },
        };

      case 'shutdown':
        return null;

      case 'textDocument/hover':
        return this.handleHover(params);

      case 'textDocument/completion':
        return this.handleCompletion(params);

      case 'textDocument/definition':
        return this.handleDefinition(params);

      case 'textDocument/documentSymbol':
        return this.handleDocumentSymbol(params);

      default:
        return null;
    }
  }

  handleNotification(method: string, params: unknown): void {
    switch (method) {
      case 'textDocument/didOpen':
        this.didOpen(params);
        break;
      case 'textDocument/didChange':
        this.didChange(params);
        break;
      case 'textDocument/didClose':
        this.didClose(params);
        break;
    }
  }

  private didOpen(params: unknown): void {
    const { textDocument } = params as { textDocument: { uri: string; text: string } };
    const state = store.analyze(textDocument.uri, textDocument.text);
    this.publishDiagnostics(textDocument.uri, state);
  }

  private didChange(params: unknown): void {
    const { textDocument, contentChanges } = params as {
      textDocument: { uri: string };
      contentChanges: { text: string }[];
    };
    const text = contentChanges[contentChanges.length - 1]?.text ?? '';
    const state = store.analyze(textDocument.uri, text);
    this.publishDiagnostics(textDocument.uri, state);
  }

  private didClose(params: unknown): void {
    const { textDocument } = params as { textDocument: { uri: string } };
    store.remove(textDocument.uri);
    this.options.publishDiagnostics?.({ uri: textDocument.uri, diagnostics: [] });
  }

  private publishDiagnostics(uri: string, state: store.DocumentState): void {
    const diagnostics = convertDiagnostics(state) as LspDiagnostic[];
    this.options.publishDiagnostics?.({ uri, diagnostics });
  }

  private handleHover(params: unknown): LspHover | null {
    const { textDocument, position } = params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const state = store.get(textDocument.uri);
    if (!state) return null;
    return provideHover(state, position) as LspHover | null;
  }

  private handleCompletion(params: unknown): LspCompletionItem[] {
    const { textDocument, position } = params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const state = store.get(textDocument.uri);
    if (!state) return [];
    return provideCompletions(state, position) as LspCompletionItem[];
  }

  private handleDefinition(params: unknown): LspLocation | null {
    const { textDocument, position } = params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const state = store.get(textDocument.uri);
    if (!state) return null;
    return provideDefinition(state, textDocument.uri, position) as LspLocation | null;
  }

  private handleDocumentSymbol(params: unknown): LspDocumentSymbol[] {
    const { textDocument } = params as { textDocument: { uri: string } };
    const state = store.get(textDocument.uri);
    if (!state) return [];
    return provideSymbols(state) as LspDocumentSymbol[];
  }
}
