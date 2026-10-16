# Grading rubric

Written before the reviews ran. Ground truth for a bug PR is the later fix or revert commit(s) and
any linked issue in `selection.json`. Grading compares Muse's findings to that defect only.

## Bug cases (25)

- **caught**: at least one finding identifies the same defect mechanism the fix addresses
  (same cause, e.g. "hard-coded `sort_keys=False` collides with a caller's option"). The file
  or line may differ if the mechanism is clearly the same.
- **partial**: a finding points at the right code or the right user-visible symptom, but the
  mechanism is wrong, vague, or listed only as a speculative possibility with no concrete
  failing input.
- **missed**: no finding matches.

Severity does not change the grade. A **strict** count additionally requires the matching finding
to be blocker or major and the verdict to be `request_changes`.

## Clean PRs (25)

Each blocker or major finding is checked against the code and labeled:

- **false alarm**: the claimed failure does not happen.
- **plausible**: a real or arguable problem that was not verified.
- **confirmed**: verified by running code, or by a later upstream fix to the same line.

Clean PRs are "no known follow-up fix", not proven bug-free.

Minor and nit findings are counted but not individually adjudicated.

## Reviews without a valid answer

A review with no valid JSON after one repair turn counts as **missed**.

## Reporting

Catch rate = caught / 25 with a Wilson 95% interval; partial rate is shown separately and
never added to caught. Grading was tool-assisted, comparing each review to the real fix, and
is not a human panel. Catches that can run outside a full app build are also checked by running
code (see `benchmarks/repro/`).
