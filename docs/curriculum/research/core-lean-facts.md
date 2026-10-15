# Core Lean 4.35 facts (verified)

Everything here was checked by **running Lean 4.35.0 with no Mathlib and no
Batteries** (October 2026). When the toolchain is bumped, re-verify anything a
chapter relies on. The curriculum verifier (`npm run verify:curriculum`) does
this automatically for code that appears in chapters, glossary entries and
exercise solutions.

## Tactics that exist in core

`rfl`, `exact`, `intro`/`intros`, `rintro`, `apply`, `refine`, `constructor`,
`cases … with | …`, `rcases` (patterns `⟨h1, h2⟩`, `h1 | h2`, `rfl`),
`obtain`, `induction … with | zero => … | succ n ih => …`, `rw`/`rewrite`
(`←`, `at h`), `simp`, `simp only`, `simp at`, `simp_all`, `simpa`, `dsimp`,
`unfold`, `show`, `have`, `let`, `suffices`, `calc`, `exists`, `left`,
`right`, `exfalso`, `contradiction`, `absurd` (term), `trivial`,
`assumption`, `decide`, `native_decide`, `omega`, `by_cases`, `specialize`,
`generalize`, `revert`, `clear`, `subst`, `injection`, `nofun`, `nomatch`,
`funext`, `ext`, `congr`, `ac_rfl`, `symm`, `change`, `split`, `match`,
`exact_mod_cast`, `and_intros`, `fun_induction`, `grind`, `exact?`, `apply?`,
`rw?`, `simp?`, `sorry`, `admit`, combinators `repeat`, `repeat'`, `first`,
`try`, `all_goals`, `any_goals`, `<;>`, `next`, `case`, `·`, `iterate`.

## Tactics that do NOT exist in core (Mathlib/Batteries only)

`use`, `by_contra`, `by_contra!`, `push_neg`, `ring`, `linarith`,
`nlinarith`, `norm_num`, `positivity`, `tauto`, `trans`, `contrapose`,
`cases'`, `induction'`, `nth_rewrite`/`nth_rw`, `split_ifs`.
All fail with `unknown tactic`. `simp_arith` is a hard deprecation error
(use `simp +arith`).

Core replacements:

| Mathlib habit | Core Lean |
|---|---|
| `use x` | `exists x`, `exact ⟨x, _⟩`, `refine ⟨x, ?_⟩` |
| `by_contra h` | `refine Classical.byContradiction ?_` then `intro h`; or `by_cases` |
| `push_neg` | manual reasoning; `simp only [Classical.not_not]` for `¬¬` |
| `ring`/`linarith`/`norm_num` | `omega` (linear ℕ/ℤ), `decide` (closed goals), `simp`, `ac_rfl`, `grind` |
| `tauto` | manual proof, or `grind` |
| `trans` | `calc`, `Eq.trans`, `h1.trans h2` |

## Automation strength (important for exercise design)

- **`grind` is very strong** and closes most beginner goals instantly:
  propositional tautologies, `a*b = b*a`, `a*(b+c) = a*b+a*c`,
  `∃ x, x+2 = 5`, `(xs ++ []).length = xs.length`, linear arithmetic. It must be
  banned until the automation chapter.
- `omega`: linear ℕ/ℤ arithmetic. Fails on `a * b = b * a`.
- `decide`: only goals with **no free variables** (`Expected type must not contain free variables`).
- `trivial` closes `True` and also `2 + 2 = 4`.
- `2 + 2 = 4` closes with `rfl`, `decide`, `simp`, `omega`, `trivial`, `native_decide`.

## Definitional-equality facts used in teaching

- `n + 0 = n` is closed by `rfl`; **`0 + n = n` is not** (needs induction or
  `Nat.zero_add`). Addition recurses on the second argument.
- `n + 1 = Nat.succ n` is closed by `rfl`.
- Goals after `induction n with | succ k ih` display `k + 1`, but `#check` of
  core lemmas still prints `n.succ` (e.g. `Nat.add_succ`). `rw [Nat.add_succ]`
  still matches `k + 1` goals.

## Exact messages (quote these, don't paraphrase from memory)

`sorry`:
```
warning: declaration uses `sorry`
```

`rfl` failure:
```
error: Tactic `rfl` failed: The left-hand side
  2 + 2
is not definitionally equal to the right-hand side
  5

⊢ 2 + 2 = 5
```

`exact` mismatch (note: capital "Type mismatch"):
```
error: Type mismatch
  hp
has type
  p
but is expected to have type
  q
```

Unsolved goals (reported at `by`):
```
error: unsolved goals
case right
p q : Prop
hp : p
hq : q
⊢ q
```

Others:
- missing induction case: ``Alternative `succ` has not been provided``
- `intro` with nothing to introduce: ``Tactic `introN` failed: There are no additional binders or `let` bindings in the goal to introduce``
- `constructor` on non-inductive goal: ``Tactic `constructor` failed: target is not an inductive datatype``
- unknown name: ``Unknown identifier `h2` ``
- `rw` pattern missing: ``Tactic `rewrite` failed: Did not find an occurrence of the pattern``
- `simp` no progress: `` `simp` made no progress ``
- `decide` on false goal: ``Tactic `decide` proved that the proposition … is false``

## Axioms

| Proof by | `#print axioms` |
|---|---|
| `rfl`, `decide` | no axioms |
| `simp` | `[propext]` (typically) |
| `omega` | `[propext, Quot.sound]` |
| `by_cases`, `Classical.em`, `Classical.byContradiction`, `grind` | `[propext, Classical.choice, Quot.sound]` |
| `native_decide` | an extra `…native_decide.ax_…` axiom (checker rejects it) |
| `sorry` | `[sorryAx]` |

## Gotchas worth teaching or avoiding

- `try tac1; tac2` parses as `try (tac1; tac2)`.
- `iterate 2 constructor` on `p ∧ p ∧ p` fails the second time; prefer `repeat'`/`all_goals`.
- Unused-variable linter warnings are on by default (e.g. `hp` unused). Name
  intentionally unused hypotheses `_hp`, or accept the warning and explain it.
- Bare `not_not` does not exist; use `Classical.not_not`.
- `exact?`/`rw?` work in core but can suggest ugly terms.
