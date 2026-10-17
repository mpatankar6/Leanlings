import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readdirSync, readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/**
 * Serves @leanprover/infoview's prebuilt files at `/infoview/` (dev) and
 * copies them into the build. The infoview iframe (src/lean/frame.ts) loads
 * them at runtime through an import map, so they must not be bundled.
 */
function infoviewDist(): Plugin {
  const dir = new URL("./node_modules/@leanprover/infoview/dist/", import.meta.url);
  const files = (readdirSync(dir) as string[]).filter((f) => /\.(js|css|ttf)$/.test(f));
  const types: Record<string, string> = { js: "text/javascript", css: "text/css", ttf: "font/ttf" };
  return {
    name: "infoview-dist",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/infoview\/([^?]+)/)?.[1];
        if (!name || !files.includes(name)) return next();
        res.setHeader("Content-Type", types[name.split(".").pop()!]);
        res.end(readFileSync(new URL(name, dir)));
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: "asset", fileName: `infoview/${f}`, source: readFileSync(new URL(f, dir)) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), infoviewDist()],
  build: {
    rolldownOptions: {
      input: { main: "index.html", infoview: "infoview.html" },
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
