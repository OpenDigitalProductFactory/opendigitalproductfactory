---
status: active
---

# Dockerfile related-test mapping fix

Owner: BI-AC5E0963, WC-8514F86C. This atomic correction extends the existing
published-correction evidence planner; it introduces no production
classification, authority, receipt, or protection policy.

## Reproduction

At source `047c2fb055d392ee02d9ebc1b007429ad0cda7fd`,
`createEvidencePlan` selected an explicit Dockerfile test globally but its
`kind: other` file disposition discarded it. `buildCorrectionCommands` then
correctly refused the empty per-file mapping.

## Acceptance

- AC-1: A Dockerfile explicitly mapped to an existing test retains that test in
  its file disposition and executes it through the correction command.
- AC-2: Absent and unknown test mappings remain refused.
- AC-3: Existing production/risk classifications and protected integration
  requirements remain intact.

## Design

`createEvidencePlan` already validates and selects explicit related tests. Its
file disposition must retain those tests for any non-risk source kind, rather
than retaining them only for `production`. Risk classifications, global guards,
and the correction verifier are unchanged.

## Ordered fix and verification

This is atomic: one planner condition and its tests ship together. The planner
test covers a Dockerfile mapping; the correction-command test consumes the
planner result and proves the mapped test is invoked while absent and unknown
mappings are refused. Existing production and risk tests remain the regression
boundary.
