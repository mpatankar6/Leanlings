import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
const host = process.env.TAURI_DEV_HOST;

/**
 * Rolldown port of `@codingame/esbuild-import-meta-url-plugin`.
 *
 * Vite pre-bundles dependencies into `node_modules/.vite/deps`, which breaks
 * `new URL('<asset>', import.meta.url)` in lean4monaco and the monaco-vscode
 * packages. Rewrite those to the asset's original location, served via `/@fs/`.
 * Specifiers are resolved like imports, so both `./file` and bare package
 * paths (e.g. `vscode-oniguruma/release/onig.wasm`) work.
 */
const importMetaUrlPlugin = {
  name: "import-meta-url",
  transform(code: string, id: string) {
    if (!/\.m?js$/.test(id) || !code.includes("import.meta.url")) return null;
    const re = /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`$]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/g;
    let changed = false;
    const out = code.replace(re, (match, quoted: string) => {
      let file: string;
      try {
        file = normalizePath(fileURLToPath(resolveModule(quoted.slice(1, -1), pathToFileURL(id).href)));
      } catch {
        return match; // not resolvable (e.g. a runtime URL); leave as is
      }
      changed = true;
      return `new URL(${JSON.stringify(`/@fs/${file.replace(/^\//, "")}`)}, import.meta.url)`;
    });
    return changed ? { code: out, map: null } : null;
  },
};

const infoviewDist = "node_modules/@leanprover/infoview/dist";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    // lean4monaco bundles the VS Code Lean extension, which expects Node APIs.
    nodePolyfills({ overrides: { fs: "memfs" } }),
    // The infoview runs in an iframe and loads these files at runtime.
    // stripBase drops the leading `node_modules/...` segments so files land at
    // `/infoview/<file>`, which is where the iframe requests them.
    viteStaticCopy({
      targets: [
        { src: `${infoviewDist}/**/*`, dest: "infoview", rename: { stripBase: 4 } },
        { src: "node_modules/lean4monaco/dist/webview/webview.js", dest: "infoview", rename: { stripBase: true } },
        { src: `${infoviewDist}/codicon.ttf`, dest: "assets", rename: { stripBase: true } },
      ],
    }),
  ],
  optimizeDeps: {
    rolldownOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and the exercise sources
      ignored: ["**/src-tauri/**", "**/exercises/**"],
    },
  },
}));
