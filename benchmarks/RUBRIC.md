# PR-review grading rubric (fixed 2026-10-16, before the scored run)

Ground truth for a bug case is the later fix or revert commit(s) and any linked issue in
`selection.json`. Grading compares Muse's findings to that defect only.

## Bug cases (25)

- **caught**: at least one finding identifies the same defect mechanism the fix addresses
  (same cause, e.g. "hard-coded `sort_keys=False` collides with a caller's option"). The file
  or line may differ if the mechanism is clearly the same.
- **partial**: a finding points at the right code or the right user-visible symptom, but the
  mechanism is wrong, vague, or listed only as a speculative possibility with no concrete
  failing input.
- **missed**: no finding matches.

Severity does not change the grade. Also recorded: whether the verdict was
`request_changes` (the reviewer would have blocked the merge).

## Control cases (6)

Each blocker or major finding is checked against the code and labeled:

- **false alarm**: the claimed failure does not happen.
- **plausible issue**: a real or arguable problem. Controls are "no known follow-up fix", not
  proven bug-free.

Minor and nit findings are counted but not individually adjudicated.

## Attempt failures

An attempt with no valid review JSON (after one repair turn), a timeout, or an infrastructure
error counts as **missed** in the headline catch rate and is listed separately.

## Reporting

Catch rate = caught / 25 with a Wilson 95% interval; partial rate is shown separately and
never added to caught. Grading was done by Claude Code (tool-assisted), comparing each review
to the real fix. It is not a human panel.
