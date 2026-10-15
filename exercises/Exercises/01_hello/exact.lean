/-
# 1.3 Using a hypothesis

Replace `sorry` with a proof. Start by reading the goal and the hypotheses in
the infoview.

(Lean will warn that one hypothesis is never used. That's expected here.)
-/

theorem use_hypothesis (P Q : Prop) (hp : P) (hq : Q) : Q := by
  sorry
