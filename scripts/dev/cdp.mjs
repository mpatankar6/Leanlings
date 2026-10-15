// Drive the running Leanlings app over the Chrome DevTools Protocol, for
// verification without touching the user's desktop. See CLAUDE.md.
//
// Start the app with the debug port first (PowerShell):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'; npm run tauri dev
//
// Usage: node scripts/dev/cdp.mjs <out.png> [step ...]
// Steps run in order; a screenshot is saved to <out.png> at the end.
//   click X Y | dblclick X Y | type TEXT | key End|Backspace|Enter
//   ctrlkey KEY CODE VK (e.g. ctrlkey = Equal 187) | ctrlwheel X Y DY
//   wait MS | reload | shot FILE | shot2x FILE | eval JS
// `eval` prints the (JSON) result; console messages and exceptions are printed at the end.
// Prefer locating elements with `eval` (getBoundingClientRect) over guessing coordinates.
const port = 9333;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:1420"));
if (!page) throw new Error("page not found: " + JSON.stringify(targets.map((t) => t.url)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiters = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) {
    waiters.get(m.id)(m);
    waiters.delete(m.id);
  } else if (m.method === "Runtime.consoleAPICalled")
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Runtime.exceptionThrown")
    logs.push("[exception] " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
const cmd = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    waiters.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("node:fs");
const screenshot = async (file, scale) => {
  let params = { format: "png" };
  if (scale) {
    const size = await cmd("Runtime.evaluate", { expression: "JSON.stringify([innerWidth, innerHeight])", returnByValue: true });
    const [width, height] = JSON.parse(size.result.result.value);
    params = { ...params, clip: { x: 0, y: 0, width, height, scale } };
  }
  const png = await cmd("Page.captureScreenshot", params);
  fs.writeFileSync(file, Buffer.from(png.result.data, "base64"));
};
await cmd("Runtime.enable");

const [out, ...steps] = process.argv.slice(2);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s === "click" || s === "dblclick") {
    const x = +steps[++i],
      y = +steps[++i];
    for (const clickCount of s === "click" ? [1] : [1, 2])
      for (const type of ["mousePressed", "mouseReleased"])
        await cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount });
    await sleep(400);
  } else if (s === "type") {
    await cmd("Input.insertText", { text: steps[++i] });
    await sleep(300);
  } else if (s === "key") {
    const key = steps[++i];
    const codes = { End: 35, Backspace: 8, Enter: 13 };
    for (const type of ["keyDown", "keyUp"])
      await cmd("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key] });
    await sleep(100);
  } else if (s === "ctrlkey") {
    const key = steps[++i],
      code = steps[++i],
      vk = +steps[++i];
    for (const type of ["rawKeyDown", "keyUp"])
      await cmd("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers: 2 });
    await sleep(500);
  } else if (s === "ctrlwheel") {
    const x = +steps[++i],
      y = +steps[++i],
      dy = +steps[++i];
    await cmd("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy, modifiers: 2 });
    await sleep(500);
  } else if (s === "reload") {
    await cmd("Page.reload", { ignoreCache: true });
  } else if (s === "shot" || s === "shot2x") {
    await screenshot(steps[++i], s === "shot2x" ? 2 : undefined);
  } else if (s === "wait") {
    await sleep(+steps[++i]);
  } else if (s === "eval") {
    const r = await cmd("Runtime.evaluate", { expression: steps[++i], returnByValue: true, awaitPromise: true });
    console.log("eval:", JSON.stringify(r.result?.result?.value ?? r.result));
  } else {
    throw new Error(`unknown step: ${s}`);
  }
}
await screenshot(out);
if (logs.length) console.log(logs.join("\n"));
process.exit(0);
