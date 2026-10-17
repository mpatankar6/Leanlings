// Hosts @leanprover/infoview (the goal panel) in an iframe and implements
// the editor side of its API on top of a LeanSession. The iframe keeps the
// infoview's own React and global CSS away from the app.

import * as monaco from "./monaco";
import { defaultInfoviewConfig, type InfoviewApi } from "@leanprover/infoview-api";
import { Channel } from "./channel";
import { LeanSession, toLspPosition, toMonacoRange } from "./session";

/** What the iframe may call; see frame.ts. Arguments are JSON-serialisable. */
export type HostMethods = ReturnType<InfoviewHost["methods"]>;

const KEEP_ALIVE_MS = 10_000;

export class InfoviewHost {
  private iframe: HTMLIFrameElement;
  private channel: Channel;
  private api: InfoviewApi;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private editorSubs: monaco.IDisposable[] = [];
  private serverSubs = new Map<string, number>();
  private clientSubs = new Map<string, number>();
  private requests = new Map<number, AbortController>();
  private rpcSessions = new Map<string, number>();
  private cleanup: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private session: LeanSession,
  ) {
    this.iframe = document.createElement("iframe");
    this.iframe.src = "/infoview.html";
    this.iframe.title = "Lean infoview";
    container.append(this.iframe);
    this.channel = new Channel(() => this.iframe.contentWindow);
    this.api = this.channel.remote<InfoviewApi>();
    this.channel.serve(this.methods());

    const subscribed = (subs: Map<string, number>, method: string) => (subs.get(method) ?? 0) > 0;
    this.cleanup.push(
      session.serverNotification.on(({ method, params }) => {
        if (subscribed(this.serverSubs, method)) void this.api.gotServerNotification(method, params);
      }),
      session.clientNotification.on(({ method, params }) => {
        if (subscribed(this.clientSubs, method)) void this.api.sentClientNotification(method, params);
      }),
      session.stopped.on((reason) => void this.api.serverStopped({ message: "The Lean server stopped.", reason })),
    );
    this.iframe.addEventListener("load", () => this.syncTheme());
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setTimeout(() => this.syncTheme(), 0);
    dark.addEventListener("change", onScheme);
    this.cleanup.push(() => dark.removeEventListener("change", onScheme));

    void this.initialize();
  }

  /** Follow the cursor in `editor` (or nothing). */
  setEditor(editor: monaco.editor.IStandaloneCodeEditor | null) {
    for (const s of this.editorSubs) s.dispose();
    this.editorSubs = [];
    this.editor = editor;
    if (!editor) return;
    this.editorSubs.push(editor.onDidChangeCursorSelection(() => void this.sendCursor()));
    this.gotEditor();
    void this.sendCursor();
    this.syncTheme();
  }

  dispose() {
    for (const c of this.cleanup) c();
    for (const s of this.editorSubs) s.dispose();
    for (const id of this.rpcSessions.values()) clearInterval(id);
    this.channel.dispose();
    this.iframe.remove();
  }

  private location() {
    const ed = this.editor;
    const sel = ed?.getSelection();
    if (!ed || !sel) return undefined;
    return {
      uri: ed.getModel()!.uri.toString(),
      range: { start: toLspPosition(sel.getStartPosition()), end: toLspPosition(sel.getEndPosition()) },
    };
  }

  private initialized = false;
  private gotEditor!: () => void;
  private hasEditor = new Promise<void>((r) => (this.gotEditor = r));

  /** Same order as the VS Code extension: location first, then server state. */
  private async initialize() {
    await this.channel.ready;
    await this.hasEditor;
    await this.api.initialize(this.location()!);
    await this.api.changedInfoviewConfig(defaultInfoviewConfig);
    await this.api.serverRestarted(this.session.initializeResult as any);
    // Replay what the infoview missed while loading.
    for (const [uri, diagnostics] of this.session.diagnostics)
      await this.api.gotServerNotification("textDocument/publishDiagnostics", { uri, diagnostics });
    for (const [uri, processing] of this.session.progress)
      await this.api.gotServerNotification("$/lean/fileProgress", { textDocument: { uri, version: 0 }, processing });
    this.initialized = true;
    await this.sendCursor();
  }

  private async sendCursor() {
    const loc = this.location();
    if (this.initialized && loc) await this.api.changedCursorLocation(loc);
  }

  /** Copy Monaco's theme colours (`--vscode-*` CSS variables) into the iframe. */
  private syncTheme() {
    const doc = this.iframe.contentDocument;
    const source = this.editor?.getDomNode();
    if (!doc?.documentElement || !source) return;
    const style = getComputedStyle(source);
    const root = doc.documentElement;
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        for (const prop of rule.style) {
          if (prop.startsWith("--vscode-")) root.style.setProperty(prop, style.getPropertyValue(prop));
        }
      }
    }
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.className = dark ? "vscode-dark" : "vscode-light";
  }

  private model(uri: string) {
    return this.editor?.getModel()?.uri.toString() === uri ? this.editor : null;
  }

  private methods() {
    const session = this.session;
    const count = (subs: Map<string, number>, method: string, delta: number) =>
      subs.set(method, Math.max(0, (subs.get(method) ?? 0) + delta));
    return {
      // The "save config" button is hidden (see infoview.html); nothing to persist.
      saveConfig: async () => {},
      sendClientRequest: async (key: number, _uri: string, method: string, params: unknown) => {
        const abort = new AbortController();
        this.requests.set(key, abort);
        try {
          return await session.client.request(method, params, abort.signal);
        } finally {
          this.requests.delete(key);
        }
      },
      cancelClientRequest: async (key: number) => this.requests.get(key)?.abort(),
      sendClientNotification: async (_uri: string, method: string, params: unknown) =>
        session.client.notify(method, params),
      subscribeServerNotifications: async (method: string) => void count(this.serverSubs, method, 1),
      unsubscribeServerNotifications: async (method: string) => void count(this.serverSubs, method, -1),
      subscribeClientNotifications: async (method: string) => void count(this.clientSubs, method, 1),
      unsubscribeClientNotifications: async (method: string) => void count(this.clientSubs, method, -1),
      copyToClipboard: async (text: string) => navigator.clipboard.writeText(text),
      insertText: async (text: string, kind: "here" | "above", pos?: { textDocument: { uri: string }; position: any }) => {
        const ed = pos ? this.model(pos.textDocument.uri) : this.editor;
        if (!ed) return;
        const at = pos
          ? { lineNumber: pos.position.line + 1, column: pos.position.character + 1 }
          : ed.getPosition()!;
        if (kind === "above") {
          const line = ed.getModel()!.getLineContent(at.lineNumber);
          const indent = line.slice(0, line.length - line.trimStart().length);
          const range = new monaco.Range(at.lineNumber, 1, at.lineNumber, 1);
          ed.executeEdits("infoview", [{ range, text: `${indent}${text}\n` }]);
        } else {
          const range = new monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column);
          ed.executeEdits("infoview", [{ range, text }]);
        }
        ed.focus();
      },
      applyEdit: async (edit: { changes?: Record<string, { range: any; newText: string }[]> }) => {
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
          this.model(uri)?.executeEdits(
            "infoview",
            edits.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })),
          );
        }
      },
      showDocument: async (show: { uri: string; selection?: any }) => {
        const ed = this.model(show.uri);
        if (!ed) return;
        if (show.selection) {
          const r = toMonacoRange(show.selection);
          ed.setSelection(r);
          ed.revealRangeInCenterIfOutsideViewport(r);
        }
        ed.focus();
      },
      restartFile: async (uri: string) => session.restartFile(uri),
      createRpcSession: async (uri: string) => {
        const { sessionId } = await session.client.request<{ sessionId: string }>("$/lean/rpc/connect", { uri });
        const timer = window.setInterval(
          () => session.client.notify("$/lean/rpc/keepAlive", { uri, sessionId }),
          KEEP_ALIVE_MS,
        );
        this.rpcSessions.set(sessionId, timer);
        return sessionId;
      },
      closeRpcSession: async (sessionId: string) => {
        clearInterval(this.rpcSessions.get(sessionId));
        this.rpcSessions.delete(sessionId);
      },
    };
  }
}
