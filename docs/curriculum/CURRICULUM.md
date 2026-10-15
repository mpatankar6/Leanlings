# Leanlings curriculum

A crash course in proving things with **core Lean 4** (no Mathlib), for people
who have never used a proof assistant. This document is the source of truth
for *what* we teach and *how content is structured*. The
[curriculum skill](../../.claude/skills/curriculum/SKILL.md) describes the
workflow for writing and improving it.

Research behind these decisions lives in [research/](research/):
[core-lean-facts.md](research/core-lean-facts.md) (verified tactic
availability, exact error messages), [pedagogy.md](research/pedagogy.md),
[prior-art.md](research/prior-art.md).

## Chapters

| # | Chapter | Core ideas | Tactics & terms introduced | Ex. | Status |
|---|---|---|---|---|---|
| 1 | Hello, Proofs | theorem, proposition, proof, goal `⊢`, hypothesis, `sorry`, reading errors | `rfl`, `exact`, `example`, `#check` | 4 | **POC** |
| 2 | Implication | `→` as a function from proofs to proofs; right-associativity | `intro`, `apply`, `assumption`, `fun` | 5 | planned |
| 3 | Rewriting | using equalities | `rw`, `rw [← h]`, `rw … at h`, `calc` | 5 | planned |
| 4 | And & Iff | building and taking apart pairs | `constructor`, `obtain ⟨⟩`, `.1`/`.2`, `⟨_, _⟩` | 5 | planned |
| 5 | Or | case analysis | `left`, `right`, `rcases h with h \| h` | 5 | planned |
| 6 | Negation & False | `¬p` is `p → False`; classical reasoning | `exfalso`, `contradiction`, `absurd`, `by_cases`, `Classical.byContradiction` | 5 | planned |
| 7 | Quantifiers | ∀ as a function, ∃ as a pair | `intro`, `specialize`, `exists`, `obtain` | 5 | planned |
| 8 | Natural numbers & induction | how `Nat` is defined; why `0 + n = n` isn't `rfl` | `induction … with`, `Nat.*` lemmas | 6 | planned |
| 9 | Lists & recursive functions | proving facts about programs | list induction, `simp [f]`, `unfold` | 5 | planned |
| 10 | Automation, responsibly | when to let the machine finish | `simp`, `omega`, `decide`, `grind`, `exact?` | 4 | planned |
| 11 | Capstone | mixed problems | everything | 3 | planned |

Not in core (never teach as available): `use`, `by_contra`, `push_neg`,
`ring`, `linarith`, `norm_num`, `tauto`, `trans`. See
[core-lean-facts.md](research/core-lean-facts.md) for replacements.

## Appendix

Standalone articles, no quiz or exercises:

| Article | Status |
|---|---|
| The Curry–Howard correspondence | **POC** |
| Where to learn more (curated resources) | **POC** |

Candidates: "Prop vs Bool", "Definitional vs propositional equality",
"Reading Lean error messages", "Classical vs constructive logic",
"Unicode input cheat-sheet".

## What a chapter contains

1. **Prose** — friendly explainer with worked examples and clickable
   `[[glossary]]` terms. Every ```` ```lean ```` block is compiled by the verifier.
2. **Quiz** — 4–8 questions, single-answer or select-all. Optional (score is
   recorded) and shown after the prose.
3. **Exercises** — 3–6 `sorry`-based exercises, fading from "one gap" to
   "blank proof", ending with a boss exercise. Automation that would skip the
   lesson is banned per chapter and enforced by the checker.

The **glossary page** in the app lists every term, alphabetically and with
search, each labelled with the chapter that first mentions it
(`introduced_in`). It is generated from `glossary.toml`; there is nothing to
maintain separately.

## Content layout

All learner-facing content ships inside the `exercises/` Lake project (bundled
as an app resource). Reference solutions are kept out of the bundle.

```
exercises/
  info.toml                       chapters, appendix, exercises (order = curriculum order)
  glossary.toml                   all glossary terms
  Chapters/01_hello/chapter.md    prose
  Chapters/01_hello/quiz.toml     quiz
  Appendix/curry_howard.md        appendix articles
  Exercises/01_hello/*.lean       exercise starters (contain `sorry`)
curriculum/solutions/<id>.lean    reference solutions (not shipped)
```

### info.toml

```toml
[[chapter]]
id = "ch01"
number = 1
title = "Hello, Proofs"
summary = "One sentence shown in the sidebar and chapter header."
doc = "Chapters/01_hello/chapter.md"
quiz = "Chapters/01_hello/quiz.toml"
banned = ["grind", "omega", "simp", "decide"]   # default for its exercises

[[chapter]]                  # not written yet
id = "ch02"
number = 2
title = "Implication"
summary = "…"
placeholder = true

[[appendix]]
id = "curry_howard"
title = "The Curry–Howard correspondence"
doc = "Appendix/curry_howard.md"

[[exercise]]
id = "ch01_rfl"
chapter = "ch01"
title = "Hello, rfl"
path = "Exercises/01_hello/rfl.lean"
theorem = "two_plus_two"
statement = "2 + 2 = 4"             # must match the .lean file; re-checked on submit
description = """Markdown, may use [[glossary]] terms."""
hint = """Markdown."""
banned = ["…"]                      # optional; overrides the chapter default
```

### Prose markup (chapter.md, appendix, glossary explanations)

Standard Markdown plus:

- `[[goal]]` / `[[hypothesis|hypotheses]]` — glossary term (id must exist).
- Inline code whose text matches a glossary entry's `code_tokens` (e.g.
  `` `rfl` ``) links to that entry automatically.
- Code fences:
  - ```` ```lean ```` — must compile with no errors (`sorry` warnings allowed).
  - ```` ```lean error="Type mismatch" ```` — must fail, and the output must
    contain the quoted text. Use this for every "here's what goes wrong" example.
  - ```` ```lean output="declaration uses" ```` — must compile, and
    the output (warnings, `#check` results) must contain the quoted text.
  - Attribute values must not contain backticks (Markdown forbids them in a
    fence's info string), so quote a backtick-free part of the message.
  - ```` ```lean nocheck ```` — not compiled (fragments, pseudo-code). Use sparingly.
  - ```` ```text ```` — goal displays / error output shown verbatim.

### glossary.toml

```toml
[term.goal]
title = "Goal"
kind = "concept"            # concept | tactic | definition | command | notation
introduced_in = "ch01"      # chapter id, or "appendix"
summary = "One or two sentences: shown in the popover."
explanation = """Markdown: shown in the glossary panel. May contain lean blocks."""
see_also = ["hypothesis", "tactic"]
code_tokens = []            # inline-code texts that auto-link here
doc_url = ""                # optional official documentation link
```

### quiz.toml

```toml
[[question]]
id = "q1"
kind = "single"             # single | multi
prompt = """Markdown; may contain lean blocks."""

[[question.option]]
text = "Markdown"
correct = true
explanation = "Why this is right / which misconception it targets."
```

## Verification

`npm run verify:curriculum` (runs the Rust test suite in `src-tauri`, including
tests that call Lean):

- structure: ids unique, references resolve, every `[[term]]` exists, every
  quiz question has a valid number of correct options, files exist;
- every ```` ```lean ```` block in prose, appendix, glossary and quizzes
  compiles (or fails with the expected text for `error=` blocks);
- every exercise starter fails the checker, and its reference solution passes
  it (including banned-tactic and axiom checks).

Automated checks can't catch misleading prose. Every new or changed chapter
also goes through the review steps in the curriculum skill.
