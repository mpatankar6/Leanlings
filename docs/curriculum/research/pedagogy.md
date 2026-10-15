# Pedagogy notes

Distilled from the research pass (October 2026). Claims are split into
**sourced** and **unsourced hypotheses**; don't present hypotheses as facts.

## Sourced findings

- **Observed beginner errors with Lean** — Bottoni, Cattaneo & Saçıkara (2025),
  *Teaching "Foundations of Mathematics" with the Lean Theorem Prover*,
  arXiv:2501.03352: students proved claims by assuming them, misused
  propositional equality, picked the wrong induction variable, reused names
  from the statement instead of fresh ones, couldn't find lemma names, and
  over-relied on automation.
- **Lean helps proof structure (hypothesis, not causal)** — Thoma & Iannone
  (2022), *Learning about Proof with the Theorem Prover LEAN: the Abundant
  Numbers Task*, IJRUME 8(1), DOI 10.1007/s40753-021-00140-1.
- **Worked examples beat unguided problem solving for novices** — Sweller &
  Cooper (1985), *Cognition and Instruction* 2(1), 59–89.
- **Fading worked examples into problems** — Renkl, Atkinson et al. (2002),
  *J. Experimental Education* (verify volume/pages before citing).
- **Retrieval practice / practice testing** — Roediger & Karpicke (2006),
  *Perspectives on Psychological Science* 1(3), DOI 10.1111/j.1745-6916.2006.00012.x;
  Dunlosky et al. (2013), *Psychological Science in the Public Interest* 14(1).
- **Language facts** — *Theorem Proving in Lean 4*: a proof of `p → q` is a
  function from proofs of `p` to proofs of `q`; `→` is right-associative.
  Lean reference: `Nat` subtraction truncates at 0 (`3 - 4 = 0`).
- **Rust Book style** — deliberately failing examples are shown with the
  compiler error, then the fix; audience and prerequisites stated up front.

## Unsourced hypotheses (verify with testers before relying on them)

Confusing `=` with `↔`; `Prop` vs `Bool`; `Prop` vs `Type`; `intro` vs
`apply` direction; implicit vs explicit arguments; induction hypothesis
naming; reading `∀` as a function type.

## Rules for writing a Leanlings chapter

1. One central idea per chapter. State what the learner will be able to do.
2. Start with a fully worked example showing the goal before and after each step.
3. Exercises fade: complete-but-one-gap → partial → empty `sorry`.
4. Show the goal/hypothesis display (`⊢`) every time a new tactic appears.
5. Pair each new tactic with a deliberately failing attempt + its **exact**
   error message (from `core-lean-facts.md` or verified by the verifier), then the fix.
6. Flag known traps where they occur (`rfl` asymmetry on `Nat`, `Nat`
   subtraction, `→` associativity, `rw` direction).
7. Never require a lemma the learner hasn't been shown; name it in the hint if needed.
8. Quiz after the prose, before exercises. Predict-the-goal, which-tactic,
   spot-the-error. Every wrong option targets a real misconception and has an explanation.
9. Spiral back: later exercises reuse earlier tactics.
10. Ban automation that would skip the lesson (enforced by the checker).
11. Friendly but precise: warm voice, exact terminology, consistent notation.
    Errors are information, not failure.
12. Encourage testing small cases before proving.
