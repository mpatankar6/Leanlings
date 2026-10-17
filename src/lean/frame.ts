// Runs inside the infoview iframe (infoview.html): loads @leanprover/infoview
// with its own React and forwards its editor calls to InfoviewHost.

import { loadRenderInfoview } from "@leanprover/infoview/loader";
import type { EditorApi } from "@leanprover/infoview-api";
import { Channel } from "./channel";
import "./fonts.css";
import type { HostMethods } from "./infoview";

const channel = new Channel(() => window.parent);
const host = channel.remote<HostMethods>();

let nextRequest = 0;
const editorApi: EditorApi = {
  sendClientRequest(uri, method, params, options) {
    // AbortSignals can't cross postMessage; cancel by key instead.
    const key = nextRequest++;
    options?.abortSignal?.addEventListener("abort", () => void host.cancelClientRequest(key));
    return host.sendClientRequest(key, uri, method, params);
  },
  saveConfig: () => host.saveConfig(),
  sendClientNotification: (uri, method, params) => host.sendClientNotification(uri, method, params),
  subscribeServerNotifications: (method) => host.subscribeServerNotifications(method),
  unsubscribeServerNotifications: (method) => host.unsubscribeServerNotifications(method),
  subscribeClientNotifications: (method) => host.subscribeClientNotifications(method),
  unsubscribeClientNotifications: (method) => host.unsubscribeClientNotifications(method),
  copyToClipboard: (text) => host.copyToClipboard(text),
  insertText: (text, kind, pos) => host.insertText(text, kind, pos),
  applyEdit: (edit) => host.applyEdit(edit as Parameters<HostMethods["applyEdit"]>[0]),
  showDocument: (show) => host.showDocument(show),
  restartFile: (uri) => host.restartFile(uri),
  createRpcSession: (uri) => host.createRpcSession(uri),
  closeRpcSession: (sessionId) => host.closeRpcSession(sessionId),
};

// Served from node_modules/@leanprover/infoview/dist by the `infoview-dist`
// plugin in vite.config.ts. User widgets import these by name too.
const imports = {
  "@leanprover/infoview": "/infoview/index.production.min.js",
  react: "/infoview/react.production.min.js",
  "react/jsx-runtime": "/infoview/react-jsx-runtime.production.min.js",
  "react-dom": "/infoview/react-dom.production.min.js",
};

loadRenderInfoview(imports, [editorApi, document.getElementById("react_root")!], (api) =>
  channel.serve(api as unknown as Parameters<Channel["serve"]>[0]),
);
