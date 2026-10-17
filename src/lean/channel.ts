// Method calls across the infoview iframe boundary via postMessage. Both
// sides expose an object of async methods; `remote()` returns a proxy that
// calls the other side's. Arguments and results must be JSON-serialisable.

type Message =
  | { kind: "ready" }
  | { kind: "call"; id: number; method: string; args: unknown[] }
  | { kind: "result"; id: number; result: unknown }
  | { kind: "error"; id: number; error: unknown };

type Methods = Record<string, (...args: any[]) => Promise<unknown>>;

export class Channel {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private methods: Methods = {};
  private served = false;
  private peerReady = false;
  private markReady!: () => void;
  /** Resolves once the other side has registered its methods. */
  readonly ready = new Promise<void>((r) => (this.markReady = r));
  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.peer()) return;
    this.received(JSON.parse(e.data as string) as Message);
  };

  constructor(
    private peer: () => Window | null,
    private self: Window = window,
  ) {
    self.addEventListener("message", this.onMessage);
  }

  /** Expose `methods` to the other side and tell it we're listening. */
  serve(methods: Methods) {
    this.methods = methods;
    this.served = true;
    this.post({ kind: "ready" });
  }

  remote<T>(): T {
    return new Proxy(
      {},
      {
        get: (_, method: string) =>
          // Not thenable, so the proxy can be returned from async functions.
          method === "then"
            ? undefined
            : async (...args: unknown[]) => {
            await this.ready;
            const id = this.nextId++;
            return new Promise((resolve, reject) => {
              this.pending.set(id, { resolve, reject });
              this.post({ kind: "call", id, method, args });
            });
          },
      },
    ) as T;
  }

  dispose() {
    this.self.removeEventListener("message", this.onMessage);
  }

  private post(m: Message) {
    // JSON.stringify drops getters and class prototypes, which postMessage
    // would otherwise reject or mangle.
    this.peer()?.postMessage(JSON.stringify(m), "*");
  }

  private async received(m: Message) {
    switch (m.kind) {
      case "ready":
        if (this.peerReady) return;
        this.peerReady = true;
        this.markReady();
        // Our own announcement may have been sent before the peer listened.
        if (this.served) this.post({ kind: "ready" });
        return;
      case "call": {
        try {
          const fn = this.methods[m.method];
          if (!fn) throw new Error(`unknown method ${m.method}`);
          this.post({ kind: "result", id: m.id, result: await fn(...m.args) });
        } catch (e) {
          this.post({ kind: "error", id: m.id, error: serializable(e) });
        }
        return;
      }
      case "result":
      case "error": {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.kind === "result") p.resolve(m.result);
        else p.reject(m.error);
      }
    }
  }
}

/** Errors' `message`/`code` are non-enumerable or own props; copy them so they survive JSON. */
function serializable(e: unknown): unknown {
  if (e === undefined) return "error";
  if (typeof e !== "object" || e === null || Array.isArray(e)) return e;
  const out: Record<string, unknown> = {};
  for (const p of Object.getOwnPropertyNames(e)) out[p] = (e as Record<string, unknown>)[p];
  return out;
}
