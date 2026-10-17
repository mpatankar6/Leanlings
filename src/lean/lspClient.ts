// Minimal JSON-RPC client for the Lean server, one message per WebSocket
// text frame (the Rust bridge in lsp_bridge.rs does the stdio framing).

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class LspClient {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Set<(method: string, params: any) => void>();
  private closeHandlers = new Set<(reason: string) => void>();

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => this.received(JSON.parse(e.data as string));
    ws.onclose = () => {
      const err = new Error("Connection to the Lean server closed.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      for (const h of this.closeHandlers) h(err.message);
    };
  }

  static connect(url: string): Promise<LspClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new LspClient(ws));
      ws.onerror = () => reject(new Error(`Could not connect to the Lean server at ${url}.`));
    });
  }

  request<T = any>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ id, method, params });
      signal?.addEventListener("abort", () => {
        if (this.pending.delete(id)) {
          this.notify("$/cancelRequest", { id });
          reject(new RpcError(-32800, "Request cancelled"));
        }
      });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ method, params });
  }

  /** Called for every server notification. Returns an unsubscribe function. */
  onNotification(h: (method: string, params: any) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onClose(h: (reason: string) => void): () => void {
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  }

  private received(msg: any) {
    if (msg.method !== undefined && msg.id !== undefined) {
      // A server-to-client request (e.g. client/registerCapability). We
      // advertise no dynamic capabilities, so acknowledging is enough.
      this.send({ id: msg.id, result: null });
    } else if (msg.method !== undefined) {
      for (const h of this.handlers) h(msg.method, msg.params);
    } else {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result);
    }
  }
}
