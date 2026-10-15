// Whole-app zoom: Ctrl + scroll wheel, Ctrl+= / Ctrl+-, Ctrl+0 to reset.
//
// Uses the native webview zoom, so everything (editor, infoview, sidebar)
// scales together. Handlers are installed in capture phase so Monaco never
// sees these keys, and also inside same-origin iframes (the infoview), whose
// events don't bubble to this window.

import { getCurrentWebview } from "@tauri-apps/api/webview";

// Capped at 200%: beyond that the three-column layout no longer fits.
const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const STORAGE_KEY = "leanlings.zoom";

let zoom = loadZoom();
let toastTimer: number | undefined;

function loadZoom(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return LEVELS.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

function setZoom(level: number, toast = true) {
  zoom = level;
  void getCurrentWebview().setZoom(level).catch((e) => console.error("setZoom failed", e));
  try {
    localStorage.setItem(STORAGE_KEY, String(level));
  } catch {
    // Zoom still works, it just won't be remembered.
  }
  if (toast) showToast(`${Math.round(level * 100)}%`);
}

function step(direction: 1 | -1) {
  const i = LEVELS.indexOf(zoom);
  const next = LEVELS[Math.min(LEVELS.length - 1, Math.max(0, (i === -1 ? LEVELS.indexOf(1) : i) + direction))];
  if (next !== zoom) setZoom(next);
}

function onKeyDown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  // `code` handles keyboard layouts and the numpad; `key` handles Shift+= ("+").
  const k = e.key;
  const c = e.code;
  let handled = true;
  if (k === "=" || k === "+" || c === "Equal" || c === "NumpadAdd") step(1);
  else if (k === "-" || k === "_" || c === "Minus" || c === "NumpadSubtract") step(-1);
  else if (k === "0" || c === "Digit0" || c === "Numpad0") setZoom(1);
  else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey || e.deltaY === 0) return;
  e.preventDefault();
  e.stopPropagation();
  step(e.deltaY < 0 ? 1 : -1);
}

const attached = new WeakSet<Window>();

function attach(win: Window) {
  if (attached.has(win)) return;
  attached.add(win);
  win.addEventListener("keydown", onKeyDown, { capture: true });
  win.addEventListener("wheel", onWheel, { capture: true, passive: false });
}

function attachIframe(iframe: HTMLIFrameElement) {
  const tryAttach = () => {
    try {
      if (iframe.contentWindow) attach(iframe.contentWindow);
    } catch {
      // Cross-origin iframe: nothing we can do.
    }
  };
  tryAttach();
  // The window object is replaced when the iframe (re)loads.
  iframe.addEventListener("load", () => {
    try {
      if (iframe.contentWindow) attached.delete(iframe.contentWindow);
    } catch {}
    tryAttach();
  });
}

function showToast(text: string) {
  let el = document.getElementById("zoom-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "zoom-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("visible"), 900);
}

export function installZoom() {
  attach(window);
  document.querySelectorAll("iframe").forEach(attachIframe);
  new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLIFrameElement) attachIframe(n);
        else if (n instanceof Element) n.querySelectorAll("iframe").forEach(attachIframe);
      });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Always apply: WebView2 can remember its own zoom across launches, which
  // may differ from ours.
  setZoom(zoom, false);
}
