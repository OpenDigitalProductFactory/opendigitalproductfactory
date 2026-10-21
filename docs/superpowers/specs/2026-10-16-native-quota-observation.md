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

## Settlement by the governed ledger (BI-29BB23F5, 2026-10-21)

This section narrows the rule above that a native failure never falls back within the execution. In the seven days to October 21, 211 failed scheduled Workroom runs (237 runs in total) ended "The existing execution has no verified settled result". 214 of them finished in under ten seconds with no ToolExecution row. Held diagnostics showed a self-terminated exit 1 with a structured error envelope: a weekly sub-account limit, or an API usage limit that the quota hint does not match. The hold sent no work to an alternative provider and bypassed the capacity hold, so every retry repeated the same failure.

The Claude CLI runs with every native tool disallowed and only the platform MCP server mounted. Its only effect channel is therefore `governedExecuteTool`, which writes a ToolExecution row (a reservation before any consequential side effect) under the session's taskRunId before it returns the result. `settleNativeCliWithoutEffects` (`apps/web/lib/routing/cli-native-settlement.ts`) settles the execution only when all of these hold:

- the CLI exited by itself: an exit code other than 124, no signal and no timeout;
- its output parsed as a `type:result` envelope with error status;
- the session carries a taskRunId;
- the ledger has zero rows for that taskRunId or thread since dispatch, minus a five-second skew margin.

The settlement is logged (`settled-without-effects`). It then raises the ordinary InferenceError for the hint (rate_limit for quota), so fallback and the room's capacity hold apply. A timeout, a signal, an unparsed envelope, a missing taskRunId, any ledger row or an unreadable ledger keeps the hold. Codex is unchanged because its native workspace tools write outside the ledger. WWMD decision DI-88DE0C444B56.
