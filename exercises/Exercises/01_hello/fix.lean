/-
# 1.5 Read the error

This proof is wrong. Read the error message Lean shows on the `exact` line,
then fix the proof.

(Lean will warn about hypotheses that aren't used. That's expected here.)
-/

theorem pick_the_right_one (P Q R : Prop) (hp : P) (hq : Q) (hr : R) : R := by
  exact hq
