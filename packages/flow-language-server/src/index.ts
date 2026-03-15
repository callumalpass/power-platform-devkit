export { FlowLspSession } from './session.js';
export type {
  FlowLspSessionOptions,
  LspPublishDiagnosticsParams,
  LspDiagnostic,
  LspHover,
  LspCompletionItem,
  LspLocation,
  LspDocumentSymbol,
  LspRange,
} from './session.js';

import process from 'node:process';
import {
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as store from './document-store.js';
import { convertDiagnostics } from './providers/diagnostics.js';
import { provideSymbols } from './providers/symbols.js';
import { provideHover } from './providers/hover.js';
import { provideDefinition } from './providers/definition.js';
import { provideCompletions } from './providers/completion.js';

export async function startFlowLanguageServer(): Promise<void> {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['"', "'", '.', '/'] },
      definitionProvider: true,
      documentSymbolProvider: true,
    },
  }));

  function analyzeAndPublish(uri: string, text: string): void {
    const state = store.analyze(uri, text);
    const diagnostics = convertDiagnostics(state);
    void connection.sendDiagnostics({ uri, diagnostics });
  }

  documents.onDidOpen((event) => {
    analyzeAndPublish(event.document.uri, event.document.getText());
  });

  documents.onDidChangeContent((event) => {
    analyzeAndPublish(event.document.uri, event.document.getText());
  });

  documents.onDidClose((event) => {
    store.remove(event.document.uri);
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const state = store.get(params.textDocument.uri) ?? store.analyze(params.textDocument.uri, doc.getText());
    return provideSymbols(state);
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const state = store.get(params.textDocument.uri) ?? store.analyze(params.textDocument.uri, doc.getText());
    return provideHover(state, params.position);
  });

  connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const state = store.get(params.textDocument.uri) ?? store.analyze(params.textDocument.uri, doc.getText());
    return provideDefinition(state, params.textDocument.uri, params.position);
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const state = store.get(params.textDocument.uri) ?? store.analyze(params.textDocument.uri, doc.getText());
    return provideCompletions(state, params.position);
  });

  documents.listen(connection);
  connection.listen();

  return new Promise<void>((resolve) => {
    connection.onShutdown(() => {
      resolve();
    });
  });
}
