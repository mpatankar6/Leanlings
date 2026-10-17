// One Lean server connection and the editor features built on it:
// document sync, diagnostics, hover, semantic tokens and the progress gutter.

import * as monaco from "./monaco";
import { LspClient } from "./lspClient";
import { LANGUAGE_ID } from "./highlight";

type Listener<T> = (value: T) => void;
class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(l: Listener<T>): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  fire(v: T) {
    for (const l of this.listeners) l(v);
  }
}

// The few LSP shapes used here (positions are 0-based, UTF-16).
type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };
type Diagnostic = { range: LspRange; message: string; severity?: number; source?: string; tags?: number[] };
export type InitializeResult = { capabilities: Record<string, any>; serverInfo?: { name: string; version?: string } };

/** `$/lean/fileProgress` processing entry; kind 2 is a fatal error. */
type ProgressRange = { range: LspRange; kind?: number };

export const toMonacoRange = (r: LspRange) =>
  new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);

export const toLspPosition = (p: monaco.IPosition) => ({ line: p.lineNumber - 1, character: p.column - 1 });

const SEVERITY: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

export class LeanSession {
  /** Every server notification, for the infoview. */
  readonly serverNotification = new Emitter<{ method: string; params: any }>();
  /** didChange / didClose we send, for the infoview. */
  readonly clientNotification = new Emitter<{ method: string; params: any }>();
  readonly stopped = new Emitter<string>();
  readonly diagnostics = new Map<string, Diagnostic[]>();
  readonly progress = new Map<string, ProgressRange[]>();

  private versions = new Map<string, number>();
  private progressDecorations = new Map<string, monaco.editor.IEditorDecorationsCollection>();
  private disposables: monaco.IDisposable[] = [];

  private constructor(
    readonly client: LspClient,
    readonly initializeResult: InitializeResult,
  ) {
    client.onNotification((method, params) => {
      if (method === "textDocument/publishDiagnostics") this.setDiagnostics(params.uri, params.diagnostics);
      else if (method === "$/lean/fileProgress") this.setProgress(params.textDocument.uri, params.processing);
      this.serverNotification.fire({ method, params });
    });
    client.onClose((reason) => this.stopped.fire(reason));
    this.registerProviders();
  }

  static async start(url: string): Promise<LeanSession> {
    const client = await LspClient.connect(url);
    const result = await client.request<InitializeResult>("initialize", {
      processId: null,
      clientInfo: { name: "Leanlings" },
      rootUri: "file:///",
      workspaceFolders: null,
      // Lets the infoview render user widgets.
      initializationOptions: { hasWidgets: true },
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          semanticTokens: {
            requests: { full: true },
            tokenTypes: [],
            tokenModifiers: [],
            formats: ["relative"],
          },
        },
        window: { showDocument: { support: false } },
      },
    });
    client.notify("initialized", {});
    return new LeanSession(client, result);
  }

  /** Sync `editor`'s model with the server and show diagnostics and progress on it. */
  open(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
    const model = editor.getModel()!;
    const uri = model.uri.toString();
    const send = (method: string, params: object) => {
      this.client.notify(method, params);
      this.clientNotification.fire({ method, params });
    };
    this.versions.set(uri, 1);
    send("textDocument/didOpen", {
      textDocument: { uri, languageId: LANGUAGE_ID, version: 1, text: model.getValue() },
    });
    this.progressDecorations.set(uri, editor.createDecorationsCollection());
    this.renderDiagnostics(uri);

    const sub = model.onDidChangeContent(() => {
      const version = (this.versions.get(uri) ?? 0) + 1;
      this.versions.set(uri, version);
      // Exercise files are small; full-text sync keeps this simple.
      send("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: model.getValue() }] });
    });
    return {
      dispose: () => {
        sub.dispose();
        send("textDocument/didClose", { textDocument: { uri } });
        this.versions.delete(uri);
        this.progressDecorations.get(uri)?.clear();
        this.progressDecorations.delete(uri);
        this.diagnostics.delete(uri);
        this.progress.delete(uri);
        monaco.editor.setModelMarkers(model, "lean", []);
      },
    };
  }

  /** Close and reopen a file so Lean re-elaborates it from scratch. */
  restartFile(uri: string) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model || !this.versions.has(uri)) return;
    this.client.notify("textDocument/didClose", { textDocument: { uri } });
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: LANGUAGE_ID, version, text: model.getValue() },
    });
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.client.close();
  }

  private setDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    this.diagnostics.set(uri, diagnostics);
    this.renderDiagnostics(uri);
  }

  private renderDiagnostics(uri: string) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "lean",
      (this.diagnostics.get(uri) ?? []).map((d) => ({
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        severity: SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        source: d.source,
        tags: d.tags as monaco.MarkerTag[] | undefined,
      })),
    );
  }

  private setProgress(uri: string, processing: ProgressRange[]) {
    this.progress.set(uri, processing);
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    // Like VS Code's task gutter: a bar beside lines Lean is still working on.
    this.progressDecorations.get(uri)?.set(
      processing.map((p) => ({
        range: new monaco.Range(p.range.start.line + 1, 1, p.range.end.line + 1, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: p.kind === 2 ? "lean-progress-error" : "lean-progress",
        },
      })),
    );
  }

  private registerProviders() {
    const caps = this.initializeResult.capabilities;
    this.disposables.push(
      monaco.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover: async (model, position, token) => {
          const r = await this.request(token, "textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: toLspPosition(position),
          });
          if (!r?.contents) return null;
          const contents = Array.isArray(r.contents) ? r.contents : [r.contents];
          return {
            range: r.range ? toMonacoRange(r.range) : undefined,
            contents: contents.map((c: any) => ({ value: typeof c === "string" ? c : c.value })),
          };
        },
      }),
    );
    const legend = caps.semanticTokensProvider?.legend;
    if (legend) {
      const changed = new monaco.Emitter<void>();
      this.disposables.push(
        changed,
        monaco.languages.registerDocumentSemanticTokensProvider(LANGUAGE_ID, {
          onDidChange: changed.event,
          getLegend: () => legend,
          provideDocumentSemanticTokens: async (model, _lastResultId, token) => {
            const r = await this.request(token, "textDocument/semanticTokens/full", {
              textDocument: { uri: model.uri.toString() },
            });
            return r ? { data: Uint32Array.from(r.data), resultId: r.resultId } : null;
          },
          releaseDocumentSemanticTokens: () => {},
        }),
      );
      // Lean only knows the full set of tokens once a file is elaborated.
      this.serverNotification.on(({ method, params }) => {
        if (method === "$/lean/fileProgress" && params.processing.length === 0) changed.fire();
      });
    }
  }

  /** A request that is cancelled when Monaco cancels `token`; failures become `null`. */
  private async request(token: monaco.CancellationToken, method: string, params: object): Promise<any> {
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      return await this.client.request(method, params, abort.signal);
    } catch {
      return null;
    } finally {
      sub.dispose();
    }
  }
}
