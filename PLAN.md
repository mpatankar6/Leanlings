# Leanlings — Plan

A Rustlings-style native app for learning to prove things in Lean 4: ~50 small exercises,
an embedded Monaco editor, and live Lean language server integration with a full infoview.

## Decisions

| Area | Choice |
|---|---|
| App shell | Tauri v2 (Rust backend) |
| Lean UI | Full infoview (live goals/hypotheses at cursor) |
| Library | Core Lean only (no Mathlib) |
| Curriculum | 11 chapters (prose + quiz + exercises), appendix, glossary. See [docs/curriculum/CURRICULUM.md](docs/curriculum/CURRICULUM.md) |

## Architecture

**Backend (Rust / Tauri v2)**
- Bundles a small Lake project containing the exercises; runs `lake env lean --server` in it.
- Bridges LSP to the frontend over a localhost WebSocket (the transport `lean4monaco` expects,
  same model as `lean4web` / `lean4game`).
- Commands for exercise file IO, reset-to-original, and progress persistence (JSON in the app data dir).

**Frontend (Vite + React + TypeScript)**
- [`lean4monaco`](https://github.com/hhu-adam/lean4monaco): Monaco + Lean syntax + LSP client +
  the official `@leanprover/infoview`.
- Layout: exercise list with progress (left), editor (center), infoview + exercise description (right).
  Buttons: Hint, Reset, Next.

**Exercise format**
- `exercises/NN_section/name.lean` files containing `sorry` placeholders.
- `info.toml` defines order, title, description, and hint per exercise.
- **Pass condition:** no errors and no `sorry` warnings, plus a hidden check file that re-states each
  theorem so the statement can't be weakened.

**Risk:** verify `lean4monaco` / infoview compatibility with Lean 4.35 first.

## Curriculum

Moved to [docs/curriculum/CURRICULUM.md](docs/curriculum/CURRICULUM.md) (chapter plan,
content formats, verification). Authoring workflow: the `curriculum` skill
(`.claude/skills/curriculum/SKILL.md`).
