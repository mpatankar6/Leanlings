/-
# 1.4 Reuse a theorem

`hundred` is already proved. Prove `big_square` using `exact` and the name of
that theorem, instead of computing it again.
-/

theorem hundred : 10 * 10 = 100 := by
  rfl

theorem big_square : 10 * 10 = 100 := by
  sorry
