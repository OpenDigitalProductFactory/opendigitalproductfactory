---
status: draft
---

# Delivery Visibility & PR Capture — Addendum to Unified Build Studio Tracking

- **Date:** 2026-06-19
- **Status:** draft (research + keystone shipped)
- **Author:** Claude Code (operator `/goal` session)
- **Extends:** [`2026-06-19-unified-build-studio-tracking-all-surfaces-design.md`](2026-06-19-unified-build-studio-tracking-all-surfaces-design.md) (EP-UNIFIED-TRACKING) — that spec chose the WorkCapsule as the universal work-unit and the unified timeline backbone. This addendum does **not** restate or compete with it; it closes three gaps that surfaced from a *delivery-visibility* operator ask the parent spec did not center.
- **Epic:** EP-UNIFIED-TRACKING
- **New backlog:** BI-620261D8 (PR capture + status node), BI-DF8537CC (delivery→change-record), BI-D3E09880 (delivery IA)
- **Cross-epic:** [BI-7C4FDBF5](#) (EP-BUILD-STUDIO — PR merge-resolution; produces the PR-status read this addendum renders)
- **Related:** [`2026-06-19-build-studio-pr-merge-resolution-design.md`](2026-06-19-build-studio-pr-merge-resolution-design.md)

> **2026-09-03 live-backlog continuation.** The three-lens delivery experience and
> PR-to-closeout requirement continue in
> [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md).
> Its live implementation BIs are `BI-9DC43E17` (delivery rail) and
> `BI-06AE6833` (PR/review-tail convergence); the legacy BI identifiers below are
> retained as design history and are not current backlog dependencies.

---

## 1. Operator intent (verbatim framing)

> "I'm trying to see how the 2 complete runs are tracked with their PRs and what the status of those PRs are in the platform. Under admin there is Platform Development, and also Hive Contributions — these are related but they are not showing me the PRs either. Where are PRs captured? I also looked at Build Runtime under AI Operations, it's not there either. … I also looked at a Change Log, there is nothing there either. We need a much better design for these surfaces, and better visibility. … There may be other surfaces I didn't even find."

This is a **delivery-visibility** ask: *for a build, where is its PR, what is the PR's status, where is the change record, and why are the surfaces scattered?* The parent spec (EP-UNIFIED-TRACKING) answers the structurally-adjacent "track external-agent work in one timeline" ask and picks the right backbone (WorkCapsule-anchored unified timeline). Three gaps remain against the delivery-visibility framing.

## 2. The backbone already chosen (parent spec — do not duplicate)

The parent spec's decisions are adopted wholesale:
- **WorkCapsule = the universal work-unit** (executor-agnostic, leased, already feeding the cross-surface change-lanes view); `FeatureBuild` is the BS-internal execution detail that attaches to a capsule.
- **One unified timeline** rendered by the existing `UnifiedEvidenceTimeline` component, merging `WorkCapsuleActivity` + linked `BuildActivity`/`BuildArtifactRevision` + `ExternalEvidenceRecord` + `RuntimeVerification` + `PhaseHandoff` (BI-C25374E4), retiring the *faked* external lane at `WorkflowStageInspector.tsx:137`.
- A capsule/build-keyed live channel + Daily-Steward status reconciler (BI-8F83933B).

## 3. Gap A — PRs are not captured as a queryable fact (the headline)

**Finding (sharper than "scattered"): the model and the readers exist; only the *writer* was missing.**

`WorkCapsule.pullRequestUrl`/`pullRequestNumber` (`schema.prisma:1058-1059`) already exist and are **read** in at least three projections:
- change-lanes lane projection — `lib/contributor-change-lanes/lane-projection.ts:108,162`
- runtime-target rollup — `lib/runtime-coordination/runtime-targets.ts:347-348`
- capsule presenter — `lib/work-capsules/work-capsule-presenter.ts:31`

But **no code wrote them at PR-creation time.** `create_portal_pr` (`mcp-tools.ts`) opened the PR, captured `prResult.prUrl`/`prNumber`, logged them as a free-text BuildActivity line, and returned — never stamping them onto the build's attached capsule. Every reader therefore fell back to `pr?.url` (a delayed, branch-name-matched GitHub *inventory snapshot* from contributor-inventory-sync) `?? capsule.pullRequestUrl` (null). Result: a freshly-shipped build's PR is invisible until an out-of-band sync maybe backfills it. And no live PR *status* (open / checks / mergeable / behind / conflicting / merged) is synced at all.

### 3.1 Keystone — shipped in this change (the missing writer)
`apps/web/lib/build/capture-build-pr.ts` → `captureBuildPrOntoCapsule({ db, featureBuildId, prNumber, prUrl })`, wired into `create_portal_pr` immediately after the PR is confirmed. It `updateMany`s the build's capsule(s) (keyed by `featureBuildId = FeatureBuild.id`, the link set at `work-capsules/build-studio-attachment.ts:72`) with the PR url + number. Migration-free (columns already exist); best-effort (opening the PR never hinges on it); unit-tested. This alone makes the change-lanes / runtime-target / presenter readers show the real PR the moment it is opened.

### 3.2 Remaining (BI-620261D8)
- **Live PR-status sync:** a queryable status + checks summary + `mergedAt` + `deployedSha`, sourced by consuming the watcher **BI-7C4FDBF5** stands up (it revives the dead `getPRStatus()` and already needs to poll mergeable state) — *not* a second poller.
- **Render the PR → merge → deploy node** on the unified timeline (BI-C25374E4), in plain language ("Finalizing against the latest platform…", "Your change is live").
- Persist status so the BI-8F83933B reconciler projects capsule status from real PR state.

## 4. Gap B — delivered builds create no change record (empty Change Log)

`/ops/changes` reads `ChangeRequest`/`ChangeItem`; a BS build never creates one (`FeatureBuild` has no FK to `ChangeRequest`). `ChangePromotion` is updated on auto-merge only when a `ProductVersion` already exists for the build — usually it does not. So the operator's Change Log is empty for the very builds they shipped, and the timeline has no change/deploy node.

**Fix (BI-DF8537CC):** on ship/merge, create-or-link a `ChangeRequest` (ITIL *standard change*) + `ChangePromotion`, reusing the **source-agnostic `registerChange()` primitive** the self-upgrade change-register work already added at the `run-store.ts` chokepoints (EP-UPGRADE-LIFECYCLE / BI-E53C3466) — expressly built so other subsystems can log changes. No new model expected.

## 5. Gap C — no information architecture (scattered surfaces)

A 2026-06-19 audit enumerated ~14 dev-process surfaces with no coherent IA. The parent spec unifies the *data*; it does not address the *navigation*.

| Route | What it actually is | Lifecycle stage | Discoverability |
| --- | --- | --- | --- |
| `/build` (+ hidden `?v=2`) | Build Studio (FeatureBuild) | idea→build→ship | primary; v2 hidden |
| `/build/work` | Work Capsules (incl. PR fields) | merge prep | hidden |
| `/admin/platform-development` | dev **config** (policy/DCO/creds/token) | config | mistaken for a dashboard |
| `/admin/hive` | HiveContributionLedger (knowledge/rules) | governance | nav |
| `/ops` | Backlog + Epics | intake/triage | primary |
| `/ops/changes` | ChangeRequest RFCs | change governance | nav (empty for builds — Gap B) |
| `/ops/promotions` | ChangePromotion + GitPromotionCandidate | deploy/merge | hidden |
| `/ops/dev-loop` | live RuntimeTarget/leases/worktrees | runtime ops | hidden |
| `/ops/improvements` | ImprovementProposal | improvement intake | nav |
| `/ops/self-upgrade` | SelfUpgradeRun + impact summary | portal self-update | nav |
| `/platform/ai/build-studio` | BS **config** (providers/engines) | config | nav |
| `/platform/ai/operations-map` | agent routing/execution topology | agent ops | hidden ("Build Runtime"?) |
| `/admin/build-studio/stall-thresholds` | BS tuning | config | deep/hidden |

**Fix (BI-D3E09880):** one canonical **Delivery** surface = the lifecycle-visibility home, with three lenses over the same WorkCapsule-joined data:
1. **Pipeline lens** — board of all work by stage (Ideating → Building → In-Review → PR Open → Merging → Deploying → Done); each card shows PR # + live status.
2. **Thread lens** — one build's end-to-end timeline (the BI-C25374E4 projection + the PR/merge/deploy node from Gap A + the change node from Gap B).
3. **Attention lens** — only what needs the operator: review pending, PR conflict/behind (BI-7C4FDBF5), deploy-window, `needs-human` escalation (BI-3E0EE3BA `selfFixClass`).

Plus: a consolidated **Development Settings** home for config (Platform Development + `/platform/ai/build-studio` + stall-thresholds); surface the hidden routes in nav; make Hive / Changes / Promotions / Dev-Loop drill-downs from the thread lens.

## 6. Sequencing (folds into the parent spec's phases)

- **Now (shipped):** Gap A keystone — `captureBuildPrOntoCapsule` writer (this change).
- **Phase 1 (with BI-C25374E4):** render the PR/merge/deploy node on the unified timeline; stand up the Delivery thread lens.
- **Phase 2 (with BI-7C4FDBF5):** consume the merge-resolution watcher's status into the PR-status field (BI-620261D8); Attention lens.
- **Phase 3:** delivery→change-record via `registerChange()` (BI-DF8537CC); Change Log shows delivered builds.
- **Phase 4:** the consolidated Delivery + Development Settings IA (BI-D3E09880); surface hidden routes.

## 7. Principles honored

- `verify-substrate-before-proposing-new` / `schema-audit-before-features` — the keystone added a *writer* to existing columns + existing readers; no new model. The change-record join reuses `registerChange()`. The IA reuses the parent spec's WorkCapsule timeline.
- `single-source-of-truth` — PR identity + status live on the WorkCapsule (the chosen universal unit), not a fourth parallel store.
- `structural-verification-is-not-functional` — the keystone ships with a unit test; functional proof = open a BS PR and confirm the capsule's PR fields populate at creation and the PR surfaces in change-lanes (pending live verification post-deploy).
