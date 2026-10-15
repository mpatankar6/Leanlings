/-
# 1.1 Hello, `rfl`

The first theorem below is already proved. Put your cursor on its `rfl` line
and look at the goal in the infoview on the right.

Then prove the second theorem: replace `sorry` with a proof.
-/

theorem one_plus_one : 1 + 1 = 2 := by
  rfl

theorem two_plus_two : 2 + 2 = 4 := by
  sorry
