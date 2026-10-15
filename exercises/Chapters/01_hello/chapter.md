# Hello, Proofs

Welcome! In this chapter you'll write your first proofs in Lean and learn to
read what Lean tells you while you work.

**By the end of this chapter you will be able to:**

- read a Lean [[theorem]] and say what it claims;
- find the [[goal]] and the [[hypothesis|hypotheses]] in Lean's goal display;
- prove equations that hold by computation, using `rfl`;
- use a hypothesis to finish a proof, using `exact`;
- read Lean's error messages instead of fearing them.

## What Lean does

Lean is a [[proof_assistant|proof assistant]]: you write a mathematical
statement and a proof of it, and Lean checks every step. If Lean accepts the
proof, the statement is proved. If something is wrong, Lean tells you where and
why.

A statement that can be true or false, like "2 + 2 = 4" or "2 + 2 = 5", is
called a [[proposition]]. A [[proof]] is evidence that a proposition is true.
Lean will let you *write down* `2 + 2 = 5`, but you will never be able to
*prove* it.

## Your first theorem

Here is a complete Lean proof:

```lean
theorem two_plus_two : 2 + 2 = 4 := by
  rfl
```

Reading it piece by piece:

| Part | Meaning |
|---|---|
| `theorem` | "I'm about to state and prove something." |
| `two_plus_two` | The theorem's name, so you can refer to it later. |
| `: 2 + 2 = 4` | The statement being proved: a proposition. |
| `:= by` | "Here comes the proof," written in [[tactic_mode|tactic mode]]. |
| `rfl` | A [[tactic]]: one instruction that moves the proof forward. |

A proof in tactic mode is a sequence of tactics, usually one per line,
indented under the `by`. This one happens to need only one.

## The goal display

While you write a proof, Lean shows its current state in the
[[infoview]], the panel on the right of the editor. The infoview always shows
the state *at your cursor*, so moving the cursor lets you step through a proof.
Put your cursor at the start of the `rfl` line and you'll see:

```text
⊢ 2 + 2 = 4
```

The line starting with [[turnstile|`⊢`]] is the [[goal]]: what you still have
to prove. Read `⊢` as "prove". (You never need to type it; Lean only uses it
for display.) Each tactic changes the goal, or finishes it. Move your cursor
to the end of the `rfl` line, and the infoview says **No goals**: the proof is
complete.

Whenever you're unsure what to do next, look at the goal.

## `rfl`: equal by computation

`rfl` (short for "reflexivity") proves goals of the form `a = b` when both
sides are [[definitional_equality|equal by definition]]: Lean can compute
both sides, or unfold them (replace names by their definitions), and reach the
same thing. Arithmetic on concrete numbers is a typical case:

```lean
theorem compute : (3 + 4) * 2 = 14 := by
  rfl
```

What if the two sides are *not* equal? Let's try to prove something false:

```lean error="is not definitionally equal to the right-hand side"
theorem oops : 2 + 2 = 5 := by
  rfl
```

Lean refuses, with this message:

```text
Tactic `rfl` failed: The left-hand side
  2 + 2
is not definitionally equal to the right-hand side
  5

⊢ 2 + 2 = 5
```

This is Lean doing its job. The message says exactly what went wrong: the
left-hand side `2 + 2` computes to `4`, which is not the same as `5`, so `rfl`
can't close the goal. Error messages are information, not punishment.

`rfl` only proves equations. If the goal isn't of the form `a = b`, `rfl`
fails with a different message.

> **A glimpse ahead.** `rfl` only works when Lean can *compute* its way to an
> answer. Here `(n : Nat)` says that `n` stands for some unknown
> [[nat|natural number]]. Then `n + 0 = n` works by `rfl`, but `0 + n = n`
> does not, even though both are true:
>
> ```lean
> theorem add_zero_example (n : Nat) : n + 0 = n := by
>   rfl
> ```
>
> ```lean error="is not definitionally equal"
> theorem zero_add_example (n : Nat) : 0 + n = n := by
>   rfl
> ```
>
> The reason is how addition is defined: Lean computes `a + b` by looking at
> `b`, the number on the right. In `n + 0` that's `0`, and the definition says
> adding `0` gives back `n`. In `0 + n` it's the unknown `n`, so there's
> nothing to compute. You'll prove `0 + n = n` properly in Chapter 8.

## `sorry`: a placeholder

Sometimes you want to write a statement now and prove it later. The [[sorry]]
keyword fills the hole:

```lean output="declaration uses"
theorem later : 2 + 2 = 4 := by
  sorry
```

Lean accepts the file but warns:

```text
declaration uses `sorry`
```

Every exercise in Leanlings starts with a `sorry` for you to replace. An
exercise only counts as solved once the `sorry` is gone and Lean accepts the
proof.

## Reading `:` as "has type"

Before we get to hypotheses, one piece of notation. In Lean, a colon means
**"has [[type]]"**. Every value has a type that says what kind of thing it is:

- `3 : Nat` says `3` is a natural number.
- `2 + 2 = 4 : Prop` says `2 + 2 = 4` is a proposition. [[prop|`Prop`]] is
  Lean's type of propositions.

Propositions are types too, and their values are proofs. So `hq : Q` says
"`hq` has type `Q`", which means **`hq` is a proof of `Q`**. Just as `3` is
one particular natural number, `hq` is one particular proof of `Q`.

## Hypotheses: things you may assume

Most theorems have assumptions. This one introduces four names:

```lean
theorem use_it (P Q : Prop) (hp : P) (hq : Q) : Q := by
  exact hq
```

Everything between the theorem's name and the final colon is something you're
allowed to use:

- `(P Q : Prop)`: `P` and `Q` are propositions. We don't know which
  statements they are, so the proof has to work for any of them.
- `(hp : P)`: `hp` is a proof of `P`. An assumption like this is called a
  [[hypothesis]]. Starting hypothesis names with `h` is a common convention.
- `(hq : Q)`: `hq` is a proof of `Q`, another hypothesis.

The statement after the last colon, `Q`, is what we have to prove. Put your
cursor at the start of the `exact` line and the infoview shows:

```text
P Q : Prop
hp : P
hq : Q
⊢ Q
```

Everything above the `⊢` is the [[context]]: what you have available.
Below it is the goal.

## `exact`: "this is exactly the proof"

The `exact` tactic finishes the goal with a proof you hand it. Writing
`exact hq` says: "the goal is `Q`, and `hq` is a proof of `Q`, so we're done."
Lean checks this by comparing the type of what you gave it, `Q`, with the
goal, `Q`. They match, and the infoview shows **No goals**.

Here's what happens if you hand `exact` the wrong hypothesis:

```lean error="Type mismatch"
theorem wrong (P Q : Prop) (hp : P) (hq : Q) : Q := by
  exact hp
```

```text
Type mismatch
  hp
has type
  P
but is expected to have type
  Q
```

The message names the term you gave (`hp`), its type (`P`), and the type the
goal needed (`Q`). The fix is to hand `exact` something whose type *is* `Q`:
changing the line to `exact hq` makes the error disappear.

`exact` needs a *proof*. Handing it something that isn't a proof, like a
number, doesn't work even if the number is "the answer":

```lean error="numerals are data"
theorem not_a_proof : 5 * 4 = 20 := by
  exact 20
```

Lean explains: ``numerals are data in Lean, but the expected type is a
proposition``. Here `rfl` is the right tool.

> **About warnings.** In `use_it`, we never used `hp`. Lean notices and shows
> a warning: ``Variable name `hp` is not explicitly referenced.`` That's a
> style hint, not an error, and the proof is still correct. Some exercises
> include a hypothesis you don't need, and you'll see this warning there.
>
> ```lean output="is not explicitly referenced"
> theorem unused (P Q : Prop) (hp : P) (hq : Q) : Q := by
>   exact hq
> ```

## Theorems are proofs you can reuse

Once a theorem is proved, its name *is* a proof of its statement. So you can
hand it to `exact` later:

```lean
theorem two_plus_two : 2 + 2 = 4 := by
  rfl

theorem again : 2 + 2 = 4 := by
  exact two_plus_two
```

Here `two_plus_two` has type `2 + 2 = 4`, exactly the goal of `again`.

`rfl` works the same way: besides being a tactic, it is also the name of a
proof, the proof that anything equals itself. So `exact rfl` proves
`4 = 4` too.

## Extras: good to know

These come up all the time, but you won't need them for this chapter's
exercises.

**[[example|`example`]]** works like `theorem` without a name. It's handy for
trying out a small case before tackling the general statement:

```lean
example : 3 * 3 = 9 := by
  rfl
```

**[[check|`#check`]]** asks Lean for the type of something. For a theorem,
that's the statement it proves:

```lean output="two_plus_two : 2 + 2 = 4"
theorem two_plus_two : 2 + 2 = 4 := by
  rfl

#check two_plus_two
```

Lean answers `two_plus_two : 2 + 2 = 4`.

**[[term_mode|Term mode]].** You can skip `by` and write the proof itself
after `:=`:

```lean
theorem two_plus_two : 2 + 2 = 4 := rfl
```

Leanlings sticks to tactic mode, because the infoview shows you the goal at
every step. That proofs are values you can pass around is the start of a deep
idea, the [[curry_howard|Curry–Howard correspondence]], described in the
appendix.

## Recap

- A **proposition** is a statement; a **proof** is evidence for it. Lean checks proofs.
- `theorem name : statement := by tactics` states and proves something.
- `x : T` means "`x` has type `T`". For a proposition `P`, `hp : P` means
  `hp` is a proof of `P`.
- The **goal** (after `⊢`) is what's left to prove. The **hypotheses** above
  it are what you may use. The infoview shows them at your cursor.
- `rfl` proves `a = b` when both sides compute to the same thing.
- `exact h` finishes the goal when `h` is a proof of exactly the goal. A
  hypothesis or a theorem's name both work.
- `sorry` is a placeholder; Lean warns about it, and exercises don't accept it.
- Error messages tell you what Lean expected. Read them.

Next up: a short quiz, then exercises.
