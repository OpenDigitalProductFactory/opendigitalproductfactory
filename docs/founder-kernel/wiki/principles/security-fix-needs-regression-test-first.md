---
title: Security findings get a regression test before a fix
pageKind: principle
status: draft
abstract: Every security finding ships with a test that fails without the fix and passes with it — the test is written and demonstrated red before the fix lands.
principleTier: core
principleDirection: Prefer test-first remediation over fix-then-test, for any defect that escaped review.
principleDimensionVector: {"long_term_maintainability": 0.9, "governance_compliance": 0.7, "blast_radius": -0.7, "speed_to_value": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
principlePublic: true
principlePublicRationale: Operators adopting DPF should know how the platform handles its own defects. Test-first remediation is a public commitment that every shipped security fix carries proof it cannot regress silently — that promise is part of what the platform sells.
sources: []
---

## Rule

When fixing a security finding — CodeQL alert, Dependabot advisory, manually-discovered vulnerability — write the regression test **before** the fix. The test must fail against the unfixed code (demonstrably red) and pass after the fix. The fix and the test land in the same PR.

## Why

A security finding represents a defect that escaped review. Fixing it without a test means the same defect can re-enter through any of: a refactor, a copy-paste, a dependency upgrade that rolls back a sanitizer, a maintainer who doesn't know the historical context. The test is the durable record of the constraint.

The "fix is mechanical, no test needed" framing is the canonical anti-pattern. Most security findings ARE mechanical at the line level (add a sanitizer, replace a regex, escape an env var). The mechanical-ness is exactly what makes them easy to undo. The test prevents the undo.

Test-first matters more than test-eventually because the order proves the test is real. A test written after the fix can pass trivially if it tests the wrong path — and the author doesn't notice because the fix is already in place. Writing the test first means the author sees it fail, sees their understanding of the defect confirmed, and then drives the fix to green. The red-to-green transition is the evidence.

## Applies To

Every PR that addresses a security finding, regardless of provenance: internal Build Studio work, external contributor PR, autonomous coworker fix, maintainer hotfix. The principle does NOT apply to security-adjacent governance work that does not address a specific defect (e.g., adding a new auditor, updating CODEOWNERS, drafting a kernel principle). It applies to the *defect class*, not to all security work.

The principle is also OPT-IN-able for false-positive dismissals: if a finding is marked as a false positive with written justification, no regression test is needed — the dismissal itself is the audit trail.

## How To Apply

1. **Reproduce the finding as a test.** Construct the minimal input that triggers the vulnerability. Run the test; confirm it fails for the exact reason the finding describes (not for some incidental reason).
2. **Land the test first** as the first commit of the working branch. The red CI run is the evidence. Do not use a GitHub draft PR for this; DPF PRs are regular ready-for-review PRs only once the branch is ready for merge review.
3. **Implement the fix.** Drive the test green.
4. **Sweep for siblings.** Most CWEs cluster — if you fixed SSRF in one file, search the codebase for the same pattern in others. Each sibling gets the same test-first treatment.
5. **Document the suppression** if you'd like CodeQL to learn the sanitizer pattern: add a `.github/codeql/config.yml` entry or an inline `// codeql[rule-id]: justification` comment. The suppression is part of the regression evidence — without it, CodeQL re-flags the fixed code on next scan.

## Decision Dimensions

- `long_term_maintainability: 0.9` — the test is the durable artifact. Years later, when a refactor would have undone the fix, CI fails and points at the test. The lesson outlives the maintainer who wrote it.
- `governance_compliance: 0.7` — regulated industries (SOC 2, ISO 27001, HIPAA) require evidence of remediation, not just the patch. A red-to-green test commit is exactly that evidence.
- `blast_radius: -0.7` — strongly reduces blast radius of regression. A future PR cannot reintroduce the same defect without breaking the test; the cost of regression is paid in CI, not in a customer breach.
- `speed_to_value: -0.4` — slower than fix-only on the first pass. Writing the test takes time. The cost is paid once; the protection is permanent.

## Examples

- **Positive:** BI-5E53A265 (SSRF cluster fix). Plan requires `safe-fetch.test.ts` to land first with cases covering 169.254.169.254 (cloud metadata), localhost, file://, and DNS rebinding. Each case fails against the current code, passes after the helper lands. Six CodeQL alerts close as the helper is adopted across the four true-positive sites.
- **Counterexample:** BI-D094AF1D auto-promoted as "small mechanical fix — env-var passthrough on two workflow_dispatch lines." If shipped without a CI assertion that those lines no longer interpolate `${{ github.event.* }}` into shell, the next maintainer who edits those workflows can reintroduce the pattern. The auditor catches it, but only because that auditor exists — the audit IS the regression test for this class. Without the auditor, the fix is undoable in one careless edit.

## Related principles

- [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md) — the test must demonstrate the actual exploit, not just that the patched line compiles.
- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — the test reproduces the diagnosis. If you can't write the test, you don't fully understand the finding.
- [`research-before-implementing`](research-before-implementing.md) — understand the CWE class before writing the test; the test should be representative of the pattern, not just the one observed instance.

## Sources

Rendered from the `sources:` frontmatter array via `WikiSourceCitations`.
