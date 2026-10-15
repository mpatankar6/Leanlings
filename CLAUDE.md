# Leanlings — notes for Claude

Rustlings-style Tauri v2 desktop app teaching theorem proving in **core Lean 4
(v4.35, no Mathlib)**. Public repo: https://github.com/mpatankar6/Leanlings.
Read `README.md` for the overview and `docs/curriculum/CURRICULUM.md` for the
curriculum plan and content formats.

## Working with the user

- Ask before editing files or making opinionated choices (design, naming,
  scope, dependency picks). Offer options with a recommendation.
- Anything public (GitHub issues/comments, pushes that change what others
  see): show the exact draft and wait for approval. Write it terse and
  direct — no filler, no restating what the reader already knows.
- Curriculum correctness is non-negotiable: never state Lean facts from
  memory, never cite unopened sources. Use the `curriculum` skill
  (`.claude/skills/curriculum/SKILL.md`) for any content work.

## Commands

```bash
npm install
npm run tauri dev            # run the app (Vite on :1420 + Rust backend)
npm run verify:curriculum    # structure + every Lean snippet + every exercise (calls Lean)
```

In `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test -- --include-ignored --test-threads=1` (ignored tests call Lean).
Frontend: `npx tsc --noEmit`, `npx vite build`. CI (`.github/workflows/ci.yml`)
runs all of these on push/PR.

## Architecture in one breath

- `src-tauri/src/lsp_bridge.rs`: token-protected localhost WebSocket ↔ `lake serve`;
  rewrites `file:///Exercises/...` URIs to the workspace; emits `lean-status` events
  (drives the loading screen).
- `src-tauri/src/exercises.rs`: learner workspace (`%APPDATA%\dev.leanlings.app\workspace`),
  progress JSON, checker (appends `example : <statement> := <theorem>` + `#print axioms`,
  rejects banned tactics via `curriculum::find_banned`).
- `src-tauri/src/curriculum.rs`: loads `exercises/info.toml`, `glossary.toml`, quizzes.
  `src-tauri/src/verify.rs`: the curriculum verifier (tests).
- Frontend: `src/App.tsx` (views, sidebar, editor), `src/content/` (Markdown renderer
  with `[[glossary]]` terms, popovers/glossary page, quiz), `src/zoom.ts`, `src/Loading.tsx`.
- Editor/infoview come from `lean4monaco` (depends on deprecated
  `monaco-editor-wrapper`; we filed hhu-adam/lean4monaco#26 — wait for upstream
  rather than migrating ourselves).

## Gotchas (learned the hard way)

- **Windows / PowerShell 5.1.** A fresh shell may not see Node/git on PATH:
  prefix commands with
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
  `Set-Content -Encoding utf8` writes a BOM — don't use it for content files;
  use the Write tool or `[IO.File]::WriteAllText` with `UTF8Encoding($false)`.
- **Vite 8 + lean4monaco.** `vite.config.ts` has a Rolldown port of the
  import-meta-url plugin; it must resolve *bare* specifiers (e.g.
  `vscode-oniguruma/release/onig.wasm`) or TextMate highlighting silently breaks.
  After changing it, delete `node_modules/.vite` (only when the app isn't running).
  Infoview assets are copied to `/infoview/` with `stripBase`.
- **Starter files reach existing workspaces** only if the learner hasn't edited
  them (`.leanlings_manifest.json` hashes). Workspaces created before the
  manifest keep old starters until reset.
- `src-tauri/target/debug/exercises` (dev resources) never deletes removed files;
  stale extras there are harmless.
- **Markdown fence info strings can't contain backticks** — use backtick-free
  substrings in ```` ```lean error="…" ```` / `output="…"` annotations.
- `grind` in core 4.35 solves most beginner goals; every chapter must ban it
  (and other automation) until Chapter 10. See `docs/curriculum/research/core-lean-facts.md`.
- Unused-variable linter warnings show in exercises with deliberately unused
  hypotheses; starters say so in their header.

## Verifying UI changes in the real app

Launching the app to check things is welcome, but **keep every wait short and
bounded** (the user has killed stuck waits). Before launching, check port 1420
isn't taken — if a `leanlings` process is running without the debug port, it's
the user's; don't start a second one.

1. Launch in the background:
   `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'; npm run tauri dev`
2. Wait (≤120 s) for `http://127.0.0.1:9333/json` to list a `localhost:1420` page.
3. Drive it with `node scripts/dev/cdp.mjs <out.png> eval "…" click X Y …`
   (locate elements via `eval` + `getBoundingClientRect`, don't guess coordinates).
   `window.__TAURI_INTERNALS__.invoke(cmd, args)` calls backend commands directly.
4. Stop the instance when done (the debug port must not stay open) and undo
   test progress in `%APPDATA%\dev.leanlings.app\progress.json` / exercise files.

Screenshots for the README: capture with `shot2x`, then
`scripts/dev/frame-screenshot.ps1 -Transparent` (the user preferred no gradient).

## Status / next steps

- Chapter 1 + appendix (Curry–Howard, learn more) + glossary are done and
  reviewed; chapters 2–11 are placeholders in `info.toml`. Next: Chapter 2
  (Implication), following the curriculum skill's workflow (outline → user OK →
  research agents → write → verifier → review agents → app check).
- No license chosen yet; `public/vite.svg` and `public/tauri.svg` are unused
  template leftovers.
