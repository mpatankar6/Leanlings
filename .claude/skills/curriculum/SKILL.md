---
name: curriculum
description: Write a new Leanlings chapter, appendix article, quiz, glossary entry or exercise, or improve/fact-check existing ones. Use whenever curriculum content under exercises/ (info.toml, glossary.toml, Chapters/, Appendix/, Exercises/) or curriculum/solutions/ is created or changed.
---

# Leanlings curriculum skill

Leanlings teaches theorem proving in **core Lean 4 (v4.35, no Mathlib)** to
complete beginners. Content must be friendly **and** correct: a misleading
sentence is a bug, and an invented fact is a serious bug.

Read first, every time:
- `docs/curriculum/CURRICULUM.md`: chapter plan, file formats, markup.
- `docs/curriculum/research/core-lean-facts.md`: what exists in core Lean,
  exact error messages, automation strength.
- `docs/curriculum/research/pedagogy.md`: rules for writing a chapter.

## Non-negotiables

1. **Never state a Lean fact from memory.** Verify it by running Lean (put a
   ```` ```lean ```` block in the content so the verifier checks it, or test
   in the scratchpad with `lean file.lean`). This covers which tactics exist,
   what a goal looks like after a tactic, error wording, and lemma names.
2. **Never cite a source you haven't opened.** Appendix links and external
   claims must be fetched and checked. If you can't access something, leave it out.
3. **Core Lean only.** `use`, `by_contra`, `push_neg`, `ring`, `linarith`,
   `norm_num`, `tauto` and `trans` do not exist. Use the replacements in core-lean-facts.md.
4. **Quote real output.** Error messages and goal displays shown in prose come
   from Lean, via `error="…"` blocks that the verifier checks.
5. **The user decides scope.** Propose chapter outlines, exercise lists and
   anything opinionated (tone shifts, reordering, new chapters) before writing
   them. Small fixes inside an agreed outline don't need sign-off.

## Workflow: new chapter

1. **Outline**, and get the user's OK: learning goals, the new terms and
   tactics (check against what earlier chapters introduced), the worked
   examples, the misconceptions to target, the quiz questions (one line each),
   and the exercise list (fading: one gap → partial → blank → boss).
2. **Research** with subagents (`model: "sonnet"` is fine for research and
   review; use "haiku" for mechanical checks). Run them in parallel:
   - *Lean facts agent*: empirically test every tactic behaviour, goal display
     and error message the chapter will rely on. Give it a scratch folder and
     say "do not modify the project".
   - *Sources agent* (if the chapter cites anything): fetch and confirm.
3. **Write** the files:
   - `exercises/Chapters/NN_slug/chapter.md`. Structure: what you'll learn →
     worked example(s) with goal states shown as ```` ```text ```` blocks → a
     deliberately failing attempt with the real error (```` ```lean error="…" ````)
     → the fix → common traps → summary/recap list.
   - `exercises/Chapters/NN_slug/quiz.toml`: 4–8 questions. Every option has an
     explanation. Distractors target real misconceptions, not trivia.
   - `exercises/glossary.toml`: add an entry for every new term, with
     `introduced_in` set to the chapter. Each entry needs a short `summary`
     (the popover) and an `explanation` (the panel). Set `code_tokens` for
     tactics and keywords.
   - `exercises/Exercises/NN_slug/*.lean` starters. Each starts with a `/- … -/`
     header saying what to do, and contains `sorry` (or, for a "fix the
     error" exercise, a broken proof).
   - `curriculum/solutions/<exercise-id>.lean`: a full reference solution,
     same statement.
   - `exercises/info.toml`: the chapter entry (remove `placeholder`), its
     `banned` list, and its exercises in order.
4. **Verify mechanically**: `npm run verify:curriculum`. It must pass. Fix the
   content, not the verifier, unless the verifier is wrong.
5. **Review** with at least two independent subagents, launched in parallel,
   each given the file paths and these instructions:
   - *Technical reviewer*: "Check every claim about Lean in these files for
     correctness against core Lean 4.35 (no Mathlib). Test claims by running
     `lean` in <scratch dir>. Report each issue with file, quote, why it's
     wrong, and a suggested fix. Do not edit files."
   - *Beginner reviewer*: "Read as someone who has never used a proof
     assistant. Report anything confusing, any term used before it's
     explained, gaps between prose and exercises, and quiz questions answerable
     without understanding. Do not edit files."
   - For appendix articles with external facts, add a *citation reviewer*
     that opens every link and checks each claim against it.
6. **Fix** the findings, rerun the verifier, and repeat review if changes were substantial.
7. **Check in the app** (see "Running the app" below): the chapter renders,
   popovers work, the quiz grades, and the exercises check.
8. Update the chapter's **Status** in CURRICULUM.md.

## Workflow: improving existing content

- Read the chapter, its quiz, its glossary entries, and its exercises together.
- For any reported bug, reproduce it first (run the snippet, open the exercise).
- Keep quiz and exercise ids stable. Learner progress is keyed by id.
- After a toolchain bump: run the verifier, then re-check core-lean-facts.md
  claims that the content relies on.

## Writing style

- Second person, warm, concrete. Short paragraphs. One idea at a time.
- Use precise terms (proposition, proof, goal, hypothesis, tactic) and link
  each one to the glossary on first use in a chapter: `[[goal]]`.
- Show, then tell: a worked example comes before the abstraction.
- Present errors as information: "Lean is telling you exactly what it expected."
- No hype, no jokes that obscure meaning, no "simply" or "obviously".
- Use Lean's notation consistently (`→ ∧ ∨ ¬ ↔ ∀ ∃ ⊢`). Explain how to type a
  symbol the first time it appears (`\to`, `\and`, …).

## Exercise design

- The checker appends `example : <statement> := <theorem>` and
  `#print axioms <theorem>`, so the `statement` in info.toml must be the
  theorem's type with all binders made explicit (`∀ (P Q : Prop), P → Q → Q`).
- Ban whatever would skip the lesson. Baseline before chapter 10: `grind`,
  `omega`, `simp`, `simp_all`, `simpa`, `decide`, `native_decide`, `trivial`,
  `exact?`, `apply?`, `rw?`, `simp?`. Add tactics from later chapters too
  (e.g. ban `assumption` in chapter 1).
- Avoid unused-variable linter noise unless it's the point. If a hypothesis
  is deliberately unused, say so in the header comment.
- Hints nudge; they don't hand over the answer, except in the first exercise of a chapter.

## Running the app for checks

`npm run tauri dev`. To inspect it without touching the user's desktop, set
`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'`
before launching, and drive the page over the Chrome DevTools Protocol
(screenshots, `Runtime.evaluate`, synthetic input). Stop the instance when
you're done, because the debug port should not be left open.
