# The Curry–Howard correspondence

In Chapter 1 you saw that `hq : Q` can be read two ways: "`hq` has type `Q`"
and "`hq` is a proof of `Q`". That isn't a coincidence or a pun. It's an
instance of the **[[curry_howard|Curry–Howard correspondence]]**, also known
as *propositions as types*: a close match between logic and programming.

> This article uses notation from later chapters (`→`, `∧`, `∨`, `fun`, `⟨_, _⟩`).
> Skim it now and come back as you learn them.

## The idea in one table

| Logic | Programming (types) |
|---|---|
| a proposition `P` | a type `P` |
| a proof of `P` | a value (program) of type `P` |
| `P → Q` (implication) | a function type: turns a `P` into a `Q` |
| `P ∧ Q` (and) | a pair type: a `P` together with a `Q` |
| `P ∨ Q` (or) | a choice type: either a `P` or a `Q`, tagged with which one |
| `True` | a type with exactly one, trivial value |
| `False` | a type with no values at all |
| checking a proof | type-checking a program |

So "is this proof correct?" becomes "does this program have the type it
claims?", and checking types is something computers do very well. That's
the core of how Lean checks your proofs.

## Seeing it in Lean

A proof of an implication *is* a function. This proof of `P → Q → P` takes a
proof of `P`, then a proof of `Q`, and returns the proof of `P`:

```lean
theorem keep_first (P Q : Prop) : P → Q → P :=
  fun hp _ => hp
```

Here is the same shape with ordinary data instead of propositions: a function
that takes two values and returns the first.

```lean
def keepFirst (α β : Type) : α → β → α :=
  fun a _ => a

#eval keepFirst Nat String 3 "hello"   -- 3
```

The two definitions have the same shape. Only the types differ: `Prop` for
the theorem, `Type` for the program.

A proof of `P ∧ Q` is a pair of proofs, built with Lean's anonymous-constructor
notation `⟨_, _⟩` (which also works for ordinary pairs). Swapping the
components proves that "and" is symmetric:

```lean
theorem and_swap (P Q : Prop) (h : P ∧ Q) : Q ∧ P :=
  ⟨h.2, h.1⟩
```

A proof of `P ∨ Q` is tagged with which side holds. `Or.inl` tags a proof of
the left side, `Or.inr` the right. (One difference from programming: since
`Or` is a proposition, Lean only lets you inspect the tag while proving
another proposition, not to compute ordinary data.)

```lean
example (P Q : Prop) (hp : P) : P ∨ Q := Or.inl hp
example (P Q : Prop) (hq : Q) : P ∨ Q := Or.inr hq
```

`False` has no proofs at all, so a function out of it never has to produce
anything. That's why anything follows from `False`:

```lean
example (P : Prop) (h : False) : P := False.elim h
```

## Tactics build terms

When you write a proof in [[tactic_mode|tactic mode]], the tactics are
instructions for *constructing* a proof term step by step. Both of these
produce a proof of the same proposition:

```lean
theorem by_tactics (P Q : Prop) (hp : P) (hq : Q) : Q := by
  exact hq

theorem by_term (P Q : Prop) (hp : P) (hq : Q) : Q := hq
```

## Where it came from

The correspondence is named after two logicians:

- **Haskell Curry** observed, in work on combinatory logic from the 1930s
  onwards, that the types of certain basic combinators look exactly like
  axioms of implicational logic.
- **William Howard** connected proofs in intuitionistic logic with terms of
  the typed lambda calculus in a 1969 manuscript, published in 1980 as *The
  formulae-as-types notion of construction*.

Later work, notably Per Martin-Löf's intuitionistic type theory and Thierry
Coquand's Calculus of Constructions, extended the idea to quantifiers through
*dependent types*. Lean's logic belongs to this family: `∀` corresponds to a
dependent function type and `∃` to a dependent pair.

## A caveat: classical logic

Under the pure correspondence, every proof is a program in the constructive
sense: it shows *how* to obtain what it claims. Lean also lets you use
classical reasoning, for example the law of the excluded middle,
`Classical.em : ∀ (p : Prop), p ∨ ¬p`. It rests on an *axiom*
(`Classical.choice`): a statement Lean takes as given, without a proof or any
computation behind it. The command `#print axioms` lists the axioms a proof
depends on:

```lean output="[propext, Classical.choice, Quot.sound]"
theorem em_example (P : Prop) : P ∨ ¬P := Classical.em P

#print axioms em_example
```

Lean reports that `em_example` depends on `propext`, `Classical.choice` and
`Quot.sound`. Leanlings allows these three standard axioms in solutions, and
rejects any other axiom, including the one behind `sorry`.

## Further reading

- Philip Wadler, *Propositions as Types*, Communications of the ACM, 2015: a
  friendly, historical tour of the idea.
- *Theorem Proving in Lean 4*, chapter "Propositions and Proofs": how Lean
  builds logic on this correspondence.
