---
status: active
---
# Native quota observations preserve the execution hold

Backlog BI-EDDDABE2; Workroom WC-C80A592A. Independent delivery child of BI-2ECA4E9C.

## Problem and design

At source 5b4871e651f0f41fdf7e59918982ac4256231b32, native CLI failure paths throw execution uncertainty before recording a validated quota observation. A live October 16 failure left the previous day's expired cooldown unchanged. Tests on this base reproduce four missing-recorder failures; the original execution remains held.

Reuse the immutable parent design at 19b9fd911283ba5cd53e3d09af50752948dbb00b, `2026-10-15-provider-readiness-repair.md`, section Native quota observation while execution remains held. Reject clearing uncertainty, retrying or falling back within the current execution, raw output storage and guessing a reset. Reuse the adapter error boundary and existing pool/capacity recorders instead of another controller.

Only a validated result envelope with error status, explicit error flag and quota hint records the fixed safe message that the reset is unknown. Await the recorder once with the actual execution plan's pool identity, retaining canonical conservative quota sharing and heuristic backoff. Rethrow the original exception even if persistence fails. This is an account-capacity observation, not settlement evidence.

## Ordered verification and acceptance

1. Observe zero-exit and nonzero-exit regression failures, then extract the already assessed common error-boundary correction.
2. AC-Q1: both native failure paths await exactly one safe quota observation.
3. AC-Q2: the same exception and unknown-settlement diagnostics propagate; persistence failure cannot clear the hold or authorize fallback/replay.
4. AC-Q3: malformed, successful and nonquota envelopes record no quota; raw output and reset guesses are never persisted.
5. AC-Q4: existing identity and conservative budget ownership remain authoritative; future routing can select an independently eligible alternative during bounded cooldown.
6. AC-Q5: affected tests, both TypeScript programs, applicable guards, independent leaf source assessment and protected PR checks pass. Canonical deployment and runtime acceptance are separate evidence.

## Scope and compatibility

No UI, schema, migration, dependency, credential, grant, lifecycle or routing-policy change. Existing legacy handling remains intact. Original held review tasks are not resumed. The parent's 37-file branch, prototypes, UX review requirements and historical gate remain preserved; that gate is not a passing receipt for this leaf tree. Model probes are outside this correction.

The refactoring consolidates observation at one error boundary rather than duplicating process-close and result-parsing branches. Record failed, skipped and unrun gates honestly; no passing review or deployed behavior is claimed by this design.

## Contain the empty-audit settlement exception (BI-29BB23F5, October 21)

PR #6537, merge `2f07ed17208cd076183e316d6bc198353099fdaf`, added automatic settlement for a structured native error, a closed outer process and zero ToolExecution rows. Its WWMD decision DI-88DE0C444B56 relied on the premise that the audit was the execution's complete effect channel. Source assessment found that premise unproven: ordinary writers can mutate before best-effort audit insertion, approval creation can precede audit reservation, and in-flight requests can outlive a count. The runner also leaves child closure unverified and its native-tool denylist does not attest the actual closed capability inventory. These are source counterexamples, not evidence that any particular historical execution caused an effect.

**OBJ-HOLD:** Preserve native execution uncertainty until authentic execution and effect evidence establishes settlement.

**OBJ-QUOTA:** Retain validated quota observation and existing admission checks for future independently authorized requests.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-HOLD-1 | OBJ-HOLD | A native error with a task identity and an empty audit still propagates the original uncertainty; outer closure, quota text and audit absence do not authorize another provider start. |
| AC-HOLD-2 | OBJ-HOLD, OBJ-QUOTA | Safe quota observation is awaited once, and observation persistence failure preserves the same uncertainty and diagnostics. |
| AC-HOLD-3 | OBJ-HOLD | Remove the automatic settlement helper and its unsound positive fixtures; retain genuine no-fallback coverage, malformed-envelope refusal and successful-path compatibility. |
| AC-HOLD-4 | OBJ-QUOTA | Reuse the existing pool/capacity recorder and predispatch check without changing quota ownership, cooldown policy, providers or routing configuration. |

Ordered implementation stays in this fix document:

1. Preserve the original author head and evidence, refresh the existing governed room and worktree, and demonstrate the empty-audit hold regression before changing production code.
2. Remove only the automatic settlement conversion and helper. Keep quota recording at the shared error boundary and rethrow the original exception.
3. Run the affected adapter, quota, uncertainty and existing fallback tests, both web TypeScript programs and applicable guards. Complete the governed integration gate and independent source assessment before protected publication.
4. Verify the containing canonical release through the existing release owner. Source tests do not prove historical closure, and live acceptance must not relaunch an uncertain execution.

This containment restores the native hold rather than manufacturing complete capture. BI-7906C73E separately owns qualified present reassessment; its restricted execution composition does not qualify ordinary native routing or transfer review budget here. Historical identities, unknown outcomes and retry blocks remain intact. No new capture mechanism, approval table, grant, provider, monitor trigger or production runtime is introduced. The monitor's useful execution remains a separate delivery obligation.
