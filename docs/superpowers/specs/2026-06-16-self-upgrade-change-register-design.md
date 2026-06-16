# Self-Upgrade Change Register — register every platform upgrade as a governed change

- **Status:** Design → implementing (single PR)
- **Backlog:** BI-E53C3466
- **Epic:** EP-UPGRADE-LIFECYCLE (Governed Platform Upgrade Lifecycle)
- **Date:** 2026-06-16
- **Owners:** Platform / Ops
- **Builds on:** [`2026-03-21-change-deployment-management-design.md`](2026-03-21-change-deployment-management-design.md), [`2026-05-23-governed-platform-upgrade-lifecycle-design.md`](2026-05-23-governed-platform-upgrade-lifecycle-design.md)

## 1. Problem

The platform runs **many self-upgrades** — `apps/web/lib/queue/functions/self-upgrade.ts` → `apps/web/lib/self-upgrade/run-store.ts` → the `SelfUpgradeRun` table — every time it pulls upstream `main` or promotes a local build to the live install. **None of them is registered in the change management register.** The full change-management substrate already exists and was designed to be the umbrella for *every* change:

- `ChangeRequest` (RFC) — ITIL lifecycle `draft → submitted → assessed → approved → scheduled → in-progress → completed | rolled-back → closed`
- `ChangeItem` — line items, with `inventoryEntityId`, `digitalProductId`, **`externalSystemRef`** (the estate/external seam), `changePromotionId`
- `ChangeImpactReport` (`impactReport` JSON) — blast-radius analysis
- `DeploymentWindow` / `BlackoutPeriod` / `StandardChangeCatalog` — scheduling + pre-approval
- `ChangeEvent` — autonomous edge-node-detected changes (git.deploy / kubectl / terraform) from the customer estate

The original design (`2026-03-21-change-deployment-management-design.md` §3) was explicit:

> "RFC is the umbrella — every change, regardless of type, flows through an RFC."
> "Self-development auto-RFC — when the platform ships a build, an RFC is auto-created wrapping the ChangePromotion."

That mandate was implemented for the **product-ship** path (`createProductVersionWithRFC` in `apps/web/lib/deploy/version-tracking.ts`) but **never for the platform self-upgrade path**. The result: the change the operator most needs in the register for root-cause analysis — "what did the platform change about *itself*, when, from which SHA to which, and did it succeed?" — is the one change that is absent. Self-upgrade history is siloed in `SelfUpgradeRun.failureLog`, `SelfUpgradeRun.completionEvidence`, and `QuiescenceRun` snapshots, none of which an operator browses when diagnosing an incident.

**Goal:** close the gap so every self-upgrade is a first-class record in the change register, **without adding any new surface to manage**, and lay the foundation for the eventual need to register changes across the customer's connected estate (external systems) for total-impact analysis.

## 2. Research & Benchmarking

| Source | Pattern adopted | Citation |
| --- | --- | --- |
| **ITIL 4 Change Enablement** | A self-upgrade is a **standard change**: pre-approved, low-risk, repeatable, automated, *closed with little to no human intervention*, no per-instance CAB. ITIL 4 explicitly encourages making standard changes the norm and automating their approval/testing/deployment. We model self-upgrade as a standard change that the pipeline auto-registers and auto-closes — recording the change without re-introducing an approval step the governed pipeline already owns (quiescence drain, recovery point, operator-reviewed impact summary, health gate, rollback). | [itsm.tools — Change Enablement](https://itsm.tools/change-enablement/), [Digital.ai — ITIL 4 + automation](https://digital.ai/catalyst-blog/understanding-the-itil-4-change-management-process-and-how-automation-can-enhance-it/), [NovelVista — ITIL change types](https://www.novelvista.com/blogs/it-service-management/itil-change-types) |
| **DORA — Change Failure Rate** | "Every deployment must be recorded as a structured event" — the change record is the denominator for CFR and the link target for incident RCA. A *failed change* = one that resulted in degraded service requiring remediation (rollback/hotfix). Our terminal states map directly: `succeeded → completed`, `rolled-back/failed-after-swap → rolled-back`. This makes self-upgrade CFR computable off the register later. | [incident.io — DORA CFR](https://incident.io/hubs/dora/dora-metrics-change-failure-rate), [Apache DevLake — CFR](https://devlake.apache.org/docs/v0.17/Metrics/CFR/) |
| **CSDM / CMDB (ServiceNow)** | Change records reference configuration items; service-to-asset mapping + criticality provides impact context. We attach a `ChangeItem` per change (today: the platform itself; later: estate CIs via `inventoryEntityId` / `externalSystemRef`), so the register is the join point between a change and the things it touched. | [How Change Management Leverages CSDM](../../Reference/framework-mapping-playlist/047-how-change-management-leverages-csdm.md) |

**Patterns rejected.** (a) A new `SelfUpgradeChange` table — rejected; it would fork the register and violate single-source-of-truth + the "no new surface" constraint. (b) A blocking human approval gate before each self-upgrade — rejected; ITIL says standard changes do not need per-instance approval, and the governed upgrade pipeline already carries the operator-reviewed impact summary + quiescence/recovery/health gates. Adding an RFC approval step would be friction the standard-change model explicitly removes. (c) Scattering `createRFC`/`transition` calls across the 7+ terminal sites in the 560-line orchestrator — rejected; high miss-risk. We mirror at the run-store chokepoints instead.

## 3. Design

### 3.1 A self-upgrade is a standard change, mirrored from the run lifecycle

Each `SelfUpgradeRun` gets a paired `ChangeRequest` (`type="standard"`, `scope="platform"`), created and transitioned **in lockstep** by the pipeline. The change record is a faithful *shadow* of the run — never a parallel source of truth.

**Schema delta (the only one):**

```prisma
model SelfUpgradeRun {
  // ...existing fields...
  changeRequestId String?        @unique
  changeRequest   ChangeRequest? @relation("SelfUpgradeChangeRecord", fields: [changeRequestId], references: [id])
}

model ChangeRequest {
  // ...existing fields...
  selfUpgradeRun SelfUpgradeRun? @relation("SelfUpgradeChangeRecord")
}
```

One nullable FK. No new table, no new enum, no new route, no new seed row.

### 3.2 Integration at the run-store chokepoints (not the orchestrator)

Every self-upgrade path — scheduled cron, manual trigger, prep-failure, quiescence-defer, recovery-point-fail, promoter-spawn-error, promoter-exit-nonzero, manual worker-error — funnels through the run-store mutators (`startRun`, `completeRun`, `failRun`, `skipRun`, `cancelRun`). We mirror there, via a single idempotent entry point `syncSelfUpgradeChangeRecord(runId)`, so coverage is total and the orchestrator is untouched.

The sync **reads everything off the persisted `SelfUpgradeRun` row** (status, `currentSha`, `targetSha`, `deployedSha`, `trigger`, `reason`, `failureLog`, `completionEvidence`, `impactSummary`). Callers pass only the `runId`. This decouples the register from the orchestrator's parameter threading.

**Lazy open.** The change record is created on the *first real action or failure* — not at `createRun`. A `queued` run that then `skipRun`s (disabled / cooldown / up-to-date / no-target / promoter-unavailable / activity-in-flight) is a **non-event** and produces **no RFC** — the register stays free of no-op noise. This matches ITIL: a change that never executes is not a change.

**Best-effort.** Mirroring is wrapped so a register write failure is logged loudly (`[self-upgrade-change-record]`) but **never aborts the upgrade**. Availability of the upgrade path outranks completeness of the audit shadow; the loud log makes any gap observable.

### 3.3 Lifecycle mapping

| `SelfUpgradeRun.status` | run-store fn | `ChangeRequest.status` | Notes |
| --- | --- | --- | --- |
| `queued` / `pending` | `createRun` | *(none)* | No RFC yet — lazy. |
| `skipped` | `skipRun` | *(none, or `cancelled→closed` if one already exists)* | No-op tick = non-event. |
| `running` / `completing` | `startRun` | `in-progress` | RFC lazily created at `scheduled` then advanced to `in-progress`; `impactReport` populated from `UpgradeImpactSummary`. |
| `succeeded` | `completeRun` | `completed → closed` | `outcome="succeeded"`; `postChangeVerification` from recovery point + `deployedSha` + health. |
| `failed` / `rolled_back` | `failRun` | `rolled-back → closed` (if was `in-progress`) or `cancelled → closed` (if pre-execution, e.g. merge-conflict) | `outcome="failed"`; `outcomeNotes` = classified failure excerpt. |
| `cancelled` | `cancelRun` | `cancelled → closed` | Operator/abort. |

Pre-execution failures (merge conflict, quiescence defer before swap) map to `cancelled` (the change was withdrawn before touching the runtime); post-swap-attempt failures map to `rolled-back` (the change was attempted and the prior image remained / was restored). This is the DORA-correct failed-change signal.

**Risk derivation (honest, from real data).** `riskLevel="low"` by default (routine standard change); `"medium"` when the attached `UpgradeImpactSummary.counts.breaking > 0`. No fabricated scores.

### 3.4 What the change record carries for RCA

- **Identity:** `RFC-YYYY-XXXX`, title `Platform self-upgrade <from7> → <to7>`, description with trigger + runId + source mode.
- **Impact:** `impactReport` = `{ source: "self-upgrade", runId, fromSha, toSha, trigger, summary?: <UpgradeImpactSummary>, headline?: <phrased.headline> }`.
- **Verification:** `postChangeVerification` = `{ recoveryPoint, deployedSha, completedAt }` on success.
- **Failure:** `outcome="failed"`, `outcomeNotes` = the classified failure excerpt already computed by the pipeline.
- **Linkage:** `SelfUpgradeRun.changeRequestId` ↔ `ChangeRequest` (bidirectional). The siloed run logs remain in place; the register now *indexes* them by RFC for the operator.

No UI work: these RFCs render in the existing `/ops/changes` register (`ChangesClient`) with the existing `standard` type badge, status/risk colors, and active/completed/history filters.

## 4. Foundation for the customer estate & external systems

The user's forward requirement: changes "extend into external systems that are not within DPF code … in the estate we discover and manage from a total impact-analysis perspective," and eventually "log changes for anything in the customer using DPF."

This design lays that foundation **without building estate discovery now**:

1. **A source-agnostic primitive.** The registration logic is extracted into `apps/web/lib/change-management/register-change.ts` — `registerChange()` / `advanceChange()` — operating on `ChangeRequest`/`ChangeItem` with no session dependency. Self-upgrade is its first consumer; a future estate/external detector calls the *same* primitive. One registration path for all change sources = less surface, not more.
2. **The seams already exist.** `ChangeItem.externalSystemRef` (free-text external CI ref) and `ChangeItem.inventoryEntityId` (platform CI) let one RFC span platform + estate. `ChangeRequest.scope` already includes `external` / `both`. The `ChangeEvent` edge feed already ingests estate changes (git/kubectl/terraform) autonomously.
3. **The change-source taxonomy** the register now recognizes:

   | Source | Status today | Path |
   | --- | --- | --- |
   | Platform self-upgrade | **this PR** | `syncSelfUpgradeChangeRecord` → `registerChange` |
   | Product ship / promotion | exists | `createProductVersionWithRFC` |
   | Operator / standard catalog | exists | `createRFC` / `createRFCFromCatalog` |
   | Customer estate (edge-detected) | **follow-up BI** | `ChangeEvent` → `registerChange` |
   | External system (3rd-party) | **future** | `ChangeItem.externalSystemRef` + estate registry |

### Follow-ups (filed separately, not in this PR)

- **Wire `ChangeEvent` (edge-detected estate changes) into the register** via `registerChange`, so customer-estate changes become first-class change records linked to their `EdgeNode` CI — the direct generalization of this PR.
- **Self-upgrade Change Failure Rate** widget computed off the register (DORA), now that the denominator exists.
- **Catalogue self-upgrade** as a `StandardChangeCatalog` entry (governance-visible pre-approval) once an automation/system approver principal is modeled.
- **Migration-aware risk:** raise `riskLevel` when the upgrade carries DB migrations (the impact summary can surface this).

## 5. Test plan

- `lifecycle.test.ts` — the extracted state machine (valid/invalid transitions, timestamp stamping) — preserves the behavior currently covered in `change-management.test.ts`.
- `register-change.test.ts` — primitive create (with items) + advance (idempotent, transition-guarded).
- `change-record.test.ts` — `queued → no RFC`; `running → RFC created at in-progress + linked + impactReport folded in`; `succeeded → completed→closed with postChangeVerification`; `failed-from-in-progress → rolled-back→closed with outcomeNotes`; `failed-pre-exec → cancelled`; `skipped → no RFC`; second call idempotent (no duplicate); register-write failure does not throw to caller.
- Build gate (typecheck + `next build`) and migration-apply via the shared local-CI convergence sandbox; unit tests local.

## 6. Non-goals

- No estate discovery / external-system registry build-out (foundation + follow-up BI only).
- No new approval gate, UI route, or `StandardChangeCatalog` seed row.
- No change to the self-upgrade pipeline's control flow, gates, or rollback behavior — only an audit shadow is added at the run-store seam.
