# Verified-finding review — reproduce a finding before it blocks

- **Status:** implemented (opt-in, default off)
- **Date:** 2026-07-12
- **BI:** BI-269922A4 · **Epic:** EP-27FD96BC
- **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §4/§9-R4

## Problem

Build Studio's dual-reviewer gate blocks (fails, triggering a rework round) whenever a reviewer returns a **critical** finding (`parseReviewResponse` → `hasCritical ? fail : pass`). Reviewer models — especially weak/local ones — surface plausible-but-wrong criticals, and each false critical costs a full rework round. The industry answer (2026) is **separation of duties**: a finding may only block once an *independent* verifier reproduces it. Claude Code's ultrareview does exactly this — every finding is reproduced before it is reported. The existing test-first *downgrade* pattern (`downgradeTestFirstCriticals`) is the same shape applied to one hard-coded finding class; this generalizes it to *any* critical, using a verifier instead of a regex.

## Design

`apps/web/lib/build/verified-finding-review.ts`:

- **`applyFindingVerdicts(review, verdicts)` — pure.** For each *critical* whose verdict is `verified === false`, downgrade to advisory `minor` (append `UNVERIFIED_FINDING_NOTE`) and recompute the decision. Verified criticals and all important/minor findings are untouched. A critical with **no** verdict stays blocking (**fail-closed**).
- **`verifyReviewFindings(review, artifact, deps)` — dispatch injected.** Runs only when the review currently fails on ≥1 critical. Each critical gets a **fresh-context** adversarial verifier (`buildFindingVerifierPrompt`) prompted to *refute* it and default to not-verified when uncertain — the burden of proof is on the finding. Verifiers run concurrently; a dispatch error yields no verdict (finding stays blocking). Capped at `maxFindings` (default 6) as a cost guard.
- **`parseVerifierResponse`** fails closed to `verified:true` on unparseable output — a broken verifier never silently clears a real finding.

## Wiring & flag

Gated by `DPF_BUILD_VERIFIED_FINDING_REVIEW` (`isVerifiedFindingReviewEnabled`, default **off** — merges inert, zero verifier spend until enabled). Wired at the plan-review merge point in `mcp-tools.ts` (`reviewBuildPlan`), after the deterministic test-first lenience and before iteration-delta computation, so a `fail` driven by an unreproduced critical is downgraded before it triggers another plan-fix round. `BuildActivity` records how many criticals could not be reproduced. The design-review gate is the natural next wiring site and reuses the same module unchanged.

## Verification

`verified-finding-review.test.ts` covers the pure downgrade rules (refute→advisory→pass, verified→stays fail, no-verdict→fail-closed, mixed sets, important/minor untouched, no-op), verifier-response parsing (clean / fenced / unparseable→fail-closed), the prompt contents, and the injected-dispatch path (no-criticals no-op, refute, reproduce, throw→fail-closed, cap).

## Non-goals

Does not change *which* findings a reviewer produces, does not touch the advisory architecture reviewer, and does not alter behavior when the flag is off. Verifying the reviewer's *severity calibration* (vs the finding's reproducibility) stays with the existing severity-driven decision.
