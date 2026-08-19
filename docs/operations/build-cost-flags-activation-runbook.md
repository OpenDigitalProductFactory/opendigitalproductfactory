# Runbook — Activating the Build Studio cost/quality flags behind evidence

- **Owner:** Platform operator (founder-directed)
- **BI:** BI-9E0595E7 (EP-27FD96BC) · **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](../superpowers/specs/2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §6
- **Governing spec:** [`2026-06-23-quality-first-risk-aware-build-rightsizing-design.md`](../superpowers/specs/2026-06-23-quality-first-risk-aware-build-rightsizing-design.md)

## Why this is a runbook, not a code change

Both flags already exist and merge inert (`apps/web/lib/build/build-studio-config.ts`):

- `DPF_BUILD_MODEL_TIER_ROUTING` — routes `robust`-tier builds to the configured frontier provider (Claude > Codex > Grok). Default **off**.
- `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING` — quality-first defaults (robust for all substantive work; local only for the trivial small doc/chore tail) **and** the deliverable-sensitivity risk axis (a HIGH-sensitivity change escalates its build process regardless of size). Default **off**.

There is nothing to build to "activate" them — the activation is an operational rollout gated on an **evidence window**. Flipping the defaults in code before that window would raise spend without proof and is explicitly out of scope for the BI. This runbook is the executable procedure; the flip itself is the operator's governed step.

**Coupling footgun (read before enabling):** `getBuildStudioConfig` only *acts on* a `robust` tier decision when `DPF_BUILD_MODEL_TIER_ROUTING` is on **and** a robust provider is credentialed. So quality-first alone changes *sizing/sensitivity* but not *model routing*; to realize the cost/quality trade the spec intends, enable **both** together, and confirm a robust provider is configured (else robust builds gracefully degrade to local — safe, but you are not testing the intended path).

## Preconditions

1. A robust provider is active + credentialed (`findConfiguredProvider("claude"|"codex"|"grok")` resolves). Verify on `/platform/ai/runtime-health`.
2. Per-build cost telemetry is flowing — it already is: `costUsd`/token capture from the Claude CLI envelope (`claude-dispatch.ts`) → phase-run rows → the AI operations map (`apps/web/lib/ai-operations-map/`) and gear-interface telemetry. This is the evidence surface for the window.
3. WIP is low enough to get a clean read (the shared sandbox serialises builds; a busy queue muddies per-tier attribution).

## Procedure

Environment flags on the canonical install are set through the **governed self-upgrade / deploy path**, never by a hand `docker compose up` on the root `dpf` project (AGENTS.md §5, compose-guard). Set the two vars in the portal service env for the canonical install and redeploy via `/ops/self-upgrade` (or the governed runner).

### Phase A — Baseline (flags OFF)

Over a representative window (target ≥ 20 builds spanning small/medium/large × feature/fix), record from the operations map / cost telemetry:
- median and p90 `costUsd` per build, bucketed by `(work-type, size)`;
- build-gate pass rate (typecheck + releasable diff) and review-bounce rate;
- escalation rate to the operator.

### Phase B — Enable routing only

`DPF_BUILD_MODEL_TIER_ROUTING=1`, quality-first still off. This routes only the existing large/xlarge `robust` decisions to frontier. Watch the same metrics for the same window size. Expected: large/xlarge cost up, large/xlarge review-bounce and escalation down. Go/no-go: quality metrics improve or hold; cost delta is within the operator's posture budget.

### Phase C — Enable quality-first

Add `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING=1`. Now substantive small/medium work also routes robust, the trivial doc/chore tail stays local, and HIGH-sensitivity changes escalate regardless of size. Watch:
- small/medium **feature/fix** cost (expected up) vs their gate-pass and review-bounce (expected materially better — this is the point);
- doc/chore tail cost (should be **unchanged** — still local);
- HIGH-sensitivity builds (auth/billing/PII/security/kernel/governance) — confirm they escalated process and that quality held.

### Go/No-Go and default flip

Flip the code defaults to on (in `isModelTierRoutingEnabled` / `isQualityFirstRightsizingEnabled`) **only when** Phase C shows: quality metrics up or flat on substantive work, the trivial tail unaffected, and the total cost delta inside the golden-triangle posture the operator has set (`BUILD_GOLDEN_TRIANGLE_POSTURE`, default Quality 0.8). Record the decision via `record_decision_outcome` and land the default flip as its own PR citing the window's numbers.

## Rollback

Unset either env var and redeploy via the governed path — the code path is byte-identical to today when both are off. No data migration is involved; `BUILD_GOLDEN_TRIANGLE_POSTURE` is migration-free in `PlatformConfig`.

## Status

Runbook ready. The evidence window and the default flip are the operator's governed steps; this document is the completable engineering artifact for BI-9E0595E7. The follow-up default-flip PR closes the loop once the window's numbers are in hand.
