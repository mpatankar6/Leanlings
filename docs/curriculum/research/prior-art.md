# Prior art

Summary of the resource survey (October 2026). Sources were read via web
fetch; treat details not marked as checked as approximate.

## Topic order across resources

| Resource | Mathlib? | Opening sequence |
|---|---|---|
| Theorem Proving in Lean 4 | no (core) | dependent types → propositions & proofs → quantifiers & equality → tactics → inductive types → induction & recursion |
| Natural Number Game 4 | own ℕ | Tutorial (`rfl`, `rw`, 2+2=4) → Addition (`induction`) → Multiplication → Power → Implication → … |
| Mathematics in Lean | yes | calculating (`rw`, `calc`, `ring`) → logic (∀/→, ∃, ¬, ∧/↔, ∨) → sets & functions |
| Hitchhiker's Guide to Logical Verification | yes | types & terms → programs & theorems → backward proofs (`intro`, `apply`, `exact`, `rfl`, `rw`, `simp`, `induction`) |
| Mechanics of Proof (Macbeth) | custom tactics | calculation → structured proofs → parity → logic → induction |
| Functional Programming in Lean | core | programming first; tactics/induction in interludes |

**Consensus:** proofs & goals → implication/∀ → rewriting → ∧/↔ → ∨ → ¬ →
∃ → induction → automation. The Hitchhiker's Guide (CS audience) is the
closest match to Leanlings' audience.

## Ideas adopted

- NNG/lean4game **inventory**: one doc per tactic/definition, grouped by kind,
  with "introduced in" tracking → our glossary with `introduced_in`.
- NNG **boss levels** at the end of each chapter.
- Defer automation until the manual version has been done by hand.
- Proof-as-program framing early (TPIL, Hitchhiker's Guide).

## Glossary / definition popovers

- lean4game stores docs as Lean commands (`TacticDoc`, `TheoremDoc`,
  `DefinitionDoc`) with markdown bodies; unlocking is computed from
  "introduced at" data.
- Verso/SubVerso produce accurate hovers but require running Lean at build time
  and use an unstable JSON format.
- Accessibility: popover triggers must be real buttons (keyboard focusable),
  open on hover/focus and toggle on click/tap, dismiss on Esc, stay open while
  hovered (WCAG 1.4.13).
- Leanlings uses `[[id]]` / `[[id|text]]` markup and a `glossary.toml` with
  `summary` (popover) + `explanation` (detail panel). Static text, written for
  beginners, rather than raw Lean hover signatures.
