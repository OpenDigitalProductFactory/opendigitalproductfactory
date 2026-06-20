# Work Intake Unification — One Front Door for Portal-Dev Work

| Field | Value |
| ----- | ----- |
| Status | Draft — EA reviewed and tightened 2026-06-06; Phase 6 evidence folds + orphan backfills implemented 2026-06-20 — ImprovementProposal (BI-196693D6, §3.5) + CoworkerCapabilityNeed (BI-8CE36E65, §3.6). `/admin/issue-reports` (BI-EDFBE081) still open. |
| Date | 2026-06-06 |
| Epic | [`EP-INTAKE-UNIFY`](#) — "Single front door for work intake — consolidate isolated queues into the backlog"; live MCP verified the listed BIs under this epic on 2026-06-06. |
| Backlog items | BI-2BB06F90 (shared front door — foundation), BI-7541AB88 (auto-file ImprovementProposal — this slice), BI-B716B387 (ImprovementSignal), BI-8CE36E65 (CoworkerCapabilityNeed), BI-EDFBE081 (PlatformIssueReport sync projection), BI-353702E8 (audit ledgers), BI-196693D6 (UI fold). |
| Related substrate | [`apps/web/lib/operate/backlog-ingest.ts`](../../../apps/web/lib/operate/backlog-ingest.ts) (new shared front door on this branch); [`apps/web/lib/operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts) (the pattern this generalizes); [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts) (canonical enums); [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) (`create_backlog_item`, `triage_backlog_item`, `propose_improvement`); [`apps/web/lib/actions/improvements.ts`](../../../apps/web/lib/actions/improvements.ts); [`apps/web/lib/skills/proposals.ts`](../../../apps/web/lib/skills/proposals.ts); `BacklogItem`, `BacklogItemActivity`, `ImprovementProposal`, `ImprovementSignal`, `CoworkerCapabilityNeed`, `PlatformIssueReport`. |
| Related specs | [Unified backlog + workType (2026-05-30)](2026-05-30-unified-backlog-worktype-design.md) — landed; this spec is the broader sibling it deferred. |
| Scope | Build ONE shared backlog-ingest helper (`ingestBacklogItem`) that every detector/queue files through; auto-project the isolated portal-dev queues into `BacklogItem` at the moment their origin record is created, back-linked, deduped, and audited — so work is visible in the backlog the instant it is detected, with no manual promotion step. Phase 1 (this slice): the shared front door + auto-file `ImprovementProposal` (the visible symptom) + fix the no-`workType` defect in `prioritizeImprovement` + converge `create_backlog_item` onto the same validation/create path. Phases 2-6: the remaining queues + the UI fold, one BI each. |
| Out of scope | Operational / human work queues (customer inquiries, bookings, marketing tasks, leave requests, onboarding tasks, customer-estate triage) — those are a SEPARATE mechanism (the collaborative `WorkQueue`/`WorkItem` substrate), not the portal-dev backlog. Skill-content proposals (`category="skill"`, governed approve/rollback in `skills/proposals.ts`) — they have their own revision-governance lifecycle and are not generic backlog work. Domain audit ledgers (`TaxIssue`, `LicenseReadinessIssue`, `PortfolioQualityIssue`, `EaConformanceIssue`) stay audit surfaces; only their platform-dev *remediation* files a BI (Phase 5). |

---

## 1. Problem

Operator (Mark) flagged hidden queues: portal-dev work captured in their own tables/pages, never landing in the backlog, so it is invisible and never prioritized. The visible symptom: Operations → Improvements (`ImprovementProposal`), where `IP-6F240` ("Estate Specialist: auto-investigate unknown devices") sits at `proposed` indefinitely.

Architectural diagnosis: the backlog is the canonical work ledger, but intake is currently implemented as several local queues with optional promotion. That violates the single-source-of-truth rule for portal-development work and makes triage dependent on remembering the origin page. The fix is not another queue or a better reminder; it is one front door that creates or touches the canonical `BacklogItem` synchronously and leaves the origin row as evidence.

### 1.1 The improvement queue only reaches the backlog through two manual clicks

`propose_improvement` ([`mcp-tools.ts:11641`](../../../apps/web/lib/mcp-tools.ts)) creates an `ImprovementProposal` at `status="proposed"` and **no** `BacklogItem`. A `BacklogItem` is only born inside `prioritizeImprovement` ([`improvements.ts:54`](../../../apps/web/lib/actions/improvements.ts)), which requires an operator to first click **Mark Reviewed** (`proposed → reviewed`) and then **Prioritize** (`reviewed → prioritized`). Those clicks never happen, so the proposed work is lost. Two further defects in that path:

- The `BacklogItem` it creates has **no `workType`** (it writes `prisma.backlogItem.create` directly, bypassing the `create_backlog_item` required-field guard) — the exact failure the 2026-05-30 workType spec set out to prevent.
- It skips triage entirely (`status="open"` with no `triageOutcome`), so the item lands in the "ready" pool without ever being triaged.

There is also dead code: the semantic-memory indexing in `propose_improvement` sits **after** the `return` ([`mcp-tools.ts:11681-11689`](../../../apps/web/lib/mcp-tools.ts)) and never runs.

### 1.2 Every queue rolls its own intake

Audit found these distinct `BacklogItem` birth points, each with its own shape and drift: `create_backlog_item` MCP + `createBacklogItem` server action; issue-report triage; process-observer triage (`buildBacklogItemData`); `sendIssueReportToBuildStudioAsFix`; `prioritizeImprovement`; `createBacklogItemFromFinding`. There is **no shared promote-to-backlog helper**, so each path diverges (the `workType` defect above is one symptom). Sibling queues that never reliably reach the backlog at all: `ImprovementSignal` (no link field), `CoworkerCapabilityNeed` (manual link only), `PlatformIssueReport` (15-min cron, parallel queue).

## 2. Current Repo Truth

| Area | Verified behavior | Implication |
| ---- | ----------------- | ----------- |
| `BacklogItem` columns | Has `workType String?`, `source String?`, `occurrenceCount Int @default(1)`, `lastSeenAt DateTime?`, `status`, `type`, `triageOutcome` ([`schema.prisma:950`](../../../packages/db/prisma/schema.prisma)). | The dedup/recurrence columns already exist — the front door can bump `occurrenceCount`/`lastSeenAt` instead of creating a duplicate. |
| Backlog activity | `BacklogItemActivity` has `kind`, `summary`, and JSON `payload` scoped to one `BacklogItem`. | Origin projection should write an `intake_origin` activity row so provenance is not only hidden inside free text. |
| Enums | `BACKLOG_WORK_TYPE_VALUES`, `BACKLOG_SOURCE_VALUES`, `BACKLOG_STATUS_VALUES`, `BACKLOG_TRIAGE_OUTCOMES` in [`backlog.ts`](../../../apps/web/lib/explore/backlog.ts). Current code includes `triaging` in `BACKLOG_STATUS_VALUES`; AGENTS enum text may lag and must be reconciled separately, not worked around locally. | The front door types its inputs against these; no new enums. |
| Canonical create | `create_backlog_item` ([`mcp-tools.ts:5301`](../../../apps/web/lib/mcp-tools.ts)): itemId gen, status/triageOutcome pairing rules, epic semantic→cuid resolve, semantic index. | The front door extracts this logic so the MCP tool and every detector share one implementation. |
| Generalizable pattern | `buildBacklogItemData` + `isDuplicate` + `triageAndFile` ([`process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts)) — pure builder + dedup + injectable-deps filing, already unit-tested. | The front door is this pattern, promoted to the canonical home and given an origin back-link. |
| `ImprovementProposal` | `backlogItemId String?` link field exists; created at `status="proposed"` with no BI. | Auto-file at creation, set `backlogItemId`. |
| Skill proposals | `category="skill"` proposals run a governed approve/rollback that mutates `SkillDefinition.skillMdContent` ([`skills/proposals.ts`](../../../apps/web/lib/skills/proposals.ts)). | Excluded from auto-file — different lifecycle. |
| Live backlog | MCP `list_backlog_items(epicId="EP-INTAKE-UNIFY")` returned BI-2BB06F90, BI-7541AB88, BI-B716B387, BI-8CE36E65, BI-EDFBE081, BI-353702E8, and BI-196693D6 as `triaging` on 2026-06-06. | This is real planned work, not a speculative epic. Keep the phase table aligned with these item IDs. |

## 3. Design

### 3.1 The shared front door — `ingestBacklogItem`

New module `apps/web/lib/operate/backlog-ingest.ts`. Split into pure planning (unit-testable, no DB) and a thin async orchestrator (mirrors `process-observer-triage.ts`).

**Contract:**

```ts
export interface BacklogIngestInput {
  title: string;
  body?: string | null;
  workType: BacklogWorkType;          // the WHAT (closed enum)
  source: BacklogSource;              // the ORIGIN (closed enum)
  type?: "product" | "portfolio";     // default "portfolio"
  status?: "triaging" | "open" | "in-progress"; // default "triaging"
  triageOutcome?: BacklogTriageOutcome;
  effortSize?: BacklogEffortSize;
  priority?: number;
  epicId?: string;                    // semantic (EP-…) or cuid; resolved in the orchestrator
  digitalProductId?: string | null;
  taxonomyNodeId?: string | null;
  submittedById?: string | null;
  agentId?: string | null;
  itemIdPrefix?: string;              // e.g. "IMP" → BI-IMP-XXXXXXXX
  /** Provenance back-link to the origin record (e.g. {kind:"improvement", id:"IP-6F240"}). */
  origin?: { kind: string; id: string };
}

export interface BacklogIngestResult { itemId: string; created: boolean; }
```

**Behavior:**

1. **Provenance.** When `origin` is given, write provenance in three layers:
   - Typed back-link when the origin model has one (`ImprovementProposal.backlogItemId`, `CoworkerCapabilityNeed.linkedBacklogItemId`).
   - A `BacklogItemActivity` row with `kind="intake_origin"` and payload `{ origin: { kind, id }, createdBy: "backlog-ingest" }`.
   - A stable compatibility marker in the body, `[origin:<kind>:<id>]`, until a later schema slice adds first-class origin/dedupe columns. The marker is a bridge, not the enterprise record.
2. **Dedup by origin.** Before creating, if `origin` is set, look for a non-terminal (`status NOT IN (done, deferred)`) `BacklogItem` whose typed back-link or compatibility marker identifies the same origin. On hit: bump `occurrenceCount` + set `lastSeenAt = now()`, append an `intake_origin` activity row with `created=false`, and return `{ itemId, created: false }`. This is what "whatever created these items still needs to create them, but they should land in backlog" requires — a recurring signal touches one item, not N.
3. **Create.** Otherwise create the `BacklogItem` through the same validated path used by `create_backlog_item` (itemId gen with optional prefix, status/triageOutcome pairing, epic resolve), default `status="triaging"` so the item enters the normal triage queue, index in semantic memory, write the `intake_origin` activity row, and return `{ itemId, created: true }`.

**Why `status="triaging"` by default:** the consolidation makes work *visible and prioritizable*, it does not pre-decide the work. New auto-filed items land where every hand-filed item lands — the triage queue — and the existing scheduled triage drain / operator triages them. No queue gets to inject `status="open"` work that skips triage (closing the `prioritizeImprovement` defect by construction).

The front door deliberately extracts the *same* validated rules `create_backlog_item` already enforces (itemId gen, status/triageOutcome pairing, epic resolve). Phase 1 is not complete while the MCP tool and the helper carry separate copies of those rules. The acceptable shape is:

- Pure helpers in `backlog-ingest.ts` (or a sibling module) own ID generation, status/outcome validation, body/provenance composition, epic semantic-id resolution, and workType/source typing.
- `create_backlog_item` delegates to those helpers and preserves its existing structured `{ success:false }` MCP error contract by catching helper validation errors.
- Queue/detector callers use `ingestBacklogItem` directly and may throw/log internally because they are not the public MCP boundary.

This reserves the requested refactoring budget for convergence work, not only feature plumbing. Rough capacity target for implementation: about 80% behavior delivery and 20% extraction/convergence/refactoring, with no unrelated cleanup.

### 3.2 Auto-file `ImprovementProposal` (this slice)

`propose_improvement` ([`mcp-tools.ts:11641`](../../../apps/web/lib/mcp-tools.ts)): after creating the proposal, call `ingestBacklogItem` with `origin={kind:"improvement", id:proposalId}`, `source="automated-detection"` (a coworker observed the friction), `workType` derived from `category` (`category==="skill"` never reaches here; map `bug`-ish categories to `bug`, else `feature`), `itemIdPrefix="IMP"`, status `triaging`. Set `ImprovementProposal.backlogItemId` from the result. Move the (currently dead) semantic-index call before the `return`.

`prioritizeImprovement` ([`improvements.ts:54`](../../../apps/web/lib/actions/improvements.ts)): no longer the *only* path to a BI. If `proposal.backlogItemId` is already set (the normal case now), reuse it — do **not** create a second item. For legacy proposals created before this change with no link, ingest one through the front door (fixing the no-`workType` defect). The proposal's own status transitions are unchanged; the backlog is now the source of truth for the *work*, the proposal is the *evidence*.

The `/ops/improvements` page stays in this slice (its full fold into a filtered backlog view is BI-196693D6). It already shows the proposal lifecycle; a follow-up adds a "see backlog item" link.

### 3.3 The remaining phases (one BI each, not this slice)

| Phase | BI | Change |
| ----- | -- | ------ |
| 2 | BI-B716B387 | `ImprovementSignal`: flywheel evaluation files recurring/high-impact signals via the front door, deduped by `signalId`. |
| 3 | BI-8CE36E65 | `CoworkerCapabilityNeed`: auto-file on submission (`workType=skill|tool`), back-link `linkedBacklogItemId`. **DONE** — auto-file shipped 2026-06-06; page fold + orphan backfill 2026-06-20 (§3.6). |
| 4 | BI-EDFBE081 | `PlatformIssueReport`. **RE-SCOPED 2026-06-20 (§3.7):** NOT a redundant queue — a functioning runtime-evidence triage + support pipeline that already projects to the backlog and shows the link; the "orphans" are deduped duplicates. Re-scoped to a careful provenance refactor (route the triage create through `ingestBacklogItem`); do NOT fold the support page or backfill. Needs its own design pass. |
| 5 | BI-353702E8 | Audit ledgers. **`AssuranceFinding` migrated onto the front door 2026-06-20 (§3.7)** — `createBacklogItemFromFinding` files through `ingestBacklogItem` (origin `{kind:"assuranceFinding"}`). Domain ledgers (`TaxIssue`/`LicenseReadinessIssue`/`PortfolioQualityIssue`/`EaConformanceIssue`) stay audit surfaces; only an explicit remediation files a BI. |
| 6 | BI-196693D6 | UI fold: the former queue pages become evidence views; `/ops` is the one place to see and prioritize portal-dev work. This is a UX convergence slice, not a new dashboard. It must reuse report-kit `StatusBadge`, `DataTable`, `FilterBar`, and `StatCard` where applicable, keep theme-token styling, and treat origin pages as evidence/detail views linked from the canonical backlog row. **`/ops/improvements` shipped 2026-06-20** (§3.5) **and `/platform/ai/capability-needs` shipped 2026-06-20** (§3.6): read-only evidence views of the linked `BacklogItem` status + idempotent orphan backfill. The `/admin/issue-reports` page fold remains (Phase 4, BI-EDFBE081). |

### 3.4 Enterprise architecture guardrails

- **Backlog is the work SSoT.** Origin tables may hold evidence and lifecycle metadata, but no portal-development work is considered actionable until it has a `BacklogItem`.
- **No parallel lifecycle.** Origin statuses (`proposed`, `reviewed`, `submitted`, `open`) do not replace `BacklogItem.status` or `triageOutcome`. The backlog lifecycle decides prioritization and build eligibility.
- **No enum drift.** `workType`, `source`, `status`, and `triageOutcome` must import from `apps/web/lib/explore/backlog.ts` and MCP schemas must remain parity-tested. Additions update the enum registry and MCP definitions in the same commit.
- **No body-only provenance as a final architecture.** The body marker is a no-migration bridge. `BacklogItemActivity` carries the audit record now; a future schema slice may add explicit origin/dedupe columns if query volume or reporting requires it.
- **No UI dialect drift.** The UI fold composes existing `/ops` and report-kit primitives. Do not add a second status badge, KPI tile, table, tab row, or queue dashboard.
- **Skill proposals stay separate.** `ImprovementProposal.category="skill"` remains in the governed skill revision flow; this spec may create backlog work for missing platform capability, but must not bypass skill approve/rollback.

### 3.5 Phase 6 implementation — `/ops/improvements` evidence fold (2026-06-20)

Operator review (Mark, 2026-06-20) reopened the symptom: the Improvements tab still **looked** like an orphaned parallel queue — 6 proposals all stuck at `proposed`, and live DB confirmed **5 of 6 had no `BacklogItem` at all** (only the newest, post-auto-file, was linked). The data layer had converged (Phase 1 auto-files new proposals) but the **UI lifecycle never did**: `ImprovementsClient` still rendered the full `proposed→reviewed→prioritized→in_progress→implemented→verified` workflow with its own buttons and status filter — a second lifecycle competing with `BacklogItem.status`, which no one drained. That is the queue-elimination violation. This slice finishes the fold for the improvements page:

- **One lifecycle.** Removed the parallel improvement workflow entirely — the `reviewImprovement` / `prioritizeImprovement` / `startImprovement` / `completeImprovement` / `verifyImprovement` / `rejectImprovement` server actions (`apps/web/lib/actions/improvements.ts`, deleted) and the status-filter bar keyed on improvement status. `/ops/improvements` is now a **read-only evidence view**: each card surfaces the linked `BacklogItem`'s canonical status (report-kit `StatusBadge` `domain="backlogItem"`, registry entry added to `statusColors.ts`), filterable by backlog status (`FilterBar` pills), and links to the backlog row where triage/prioritize/build/defer happen. No competing status workflow remains (spec guardrail "No parallel lifecycle").
- **Orphan backfill (queue drain).** New idempotent `reconcileImprovementBacklog()` (`apps/web/lib/evaluate/improvement-backlog-reconcile.ts`) files every non-skill, non-rejected proposal with `backlogItemId IS NULL` through the **same** shared front door (`ingestBacklogItem`, no second create path), then sets the link. The page server-render awaits it (non-fatal) before reading, so legacy orphans drain to the backlog the moment the page is viewed — the operator never clicks anything (`do-the-work-dont-task-the-operator`). It converges to a zero-write no-op once every proposal is linked, and self-heals any future auto-file failure.
- **Skill proposals untouched.** `category="skill"` is excluded from both the evidence read and the backfill; the governed `lib/skills/proposals.ts` approve/rollback lifecycle is unaffected.
- **UX-Fit decision** (`human_cognitive_load`, `principle_decide`, external_coding_agent): fold-to-evidence composite 6.67 vs keep-parallel-queue 1.49, margin 5.18, high confidence, no commandment conflict.
- **Still open under BI-196693D6:** the `/admin/issue-reports` page fold (gated on the Phase 4 PlatformIssueReport projection landing on the front door first).

### 3.6 Phase 6 implementation — `/platform/ai/capability-needs` evidence fold (2026-06-20)

The CoworkerCapabilityNeed queue was the same shape as ImprovementProposal: auto-file on submission already shipped (PR #1591, 2026-06-06 — `submitCoworkerSelfAssessment` files each need through `ingestBacklogItem` with origin `{kind:"capability-need", id: capabilityNeedOriginId(agentId, kind, need)}` and sets `linkedBacklogItemId` + `status="backlog-filed"`), but the `/platform/ai/capability-needs` page still owned a parallel review lifecycle (`submitted→reviewing→accepted/deferred/discarded/duplicate→resolved`) via Accept/Defer/Discard, manual "Link backlog item", and "Mark duplicate" controls. Live DB: 2 needs, both orphaned (created 2026-06-03, pre-auto-file, no backlog link). This slice mirrors §3.5:

- **One lifecycle.** The page is now a read-only evidence view: each row shows the linked `BacklogItem`'s status (`StatusBadge domain="backlogItem"`), with severity/kind as evidence labels, filterable by severity/kind via report-kit `FilterBar` (`mode="url"`, server-rendered). Deleted the UI action layer (`apps/web/lib/actions/coworker-capability-needs.ts` + test) and the need-status filter/summary. The work is triaged on the backlog row the page links to.
- **Orphan backfill.** New idempotent `reconcileCapabilityNeedBacklog()` (`apps/web/lib/coworker-self-assessment/capability-backlog-reconcile.ts`) files every non-dismissed need with no `linkedBacklogItemId` through the SAME filer the submit path uses (`fileCapabilityNeedToBacklog`, extracted from the submit closure so origin dedup key + body never drift), then links it back. The page awaits it (non-fatal) before rendering, so the 2 orphans drain automatically. Dismissed needs (`discarded`/`duplicate`/`resolved`) are excluded so closed evidence is not resurrected.
- **Service capability retained.** `resolveCapabilityNeed` / `linkNeedToBacklogItem` stay in the service layer (the latter is reused by the reconcile); only the competing *UI surface* was removed.
- **UX-Fit decision** (`human_cognitive_load`, `principle_decide`, external_coding_agent): fold-to-evidence, same rationale as §3.5 — one lifecycle replaces two.

### 3.7 AssuranceFinding front-door convergence + PlatformIssueReport re-scope (2026-06-20)

Continuing the consolidation sweep after the two genuine redundant-queue folds (§3.5, §3.6), an investigation mapped the remaining intake surfaces. The *genuine* disparate queues (ImprovementProposal, CoworkerCapabilityNeed) had a parallel status lifecycle competing with the backlog and are now eliminated. The rest are NOT redundant queues:

- **ImprovementSignal** — already converged: `createOrTouchImprovementSignal` promotes recurring signals (recurrence ≥ `SIGNAL_BACKLOG_THRESHOLD`) through `ingestBacklogItem` (origin `{kind:"improvement-signal"}`); live = 81 signals, all linked, 0 orphans, no parallel UI.
- **PlatformIssueReport** — a functioning runtime-evidence triage + support pipeline (LLM triage, crash-boundary honesty, semantic/digest dedup, spike detection) that already projects open reports to the backlog and surfaces the `/ops` link on `/admin/issue-reports`. That page's own statuses (suppress warmup-noise, resolve, escalate via `SUPPORT_FLOW_STATUSES`) are a legitimate support lifecycle, not a redundant backlog copy. The 308 `acknowledged`-without-BI rows are **deduped duplicates** — `triageIssueReports` acknowledges a report both when it creates a BI and when it folds a duplicate via `incrementOccurrence` — not lost work; backfilling them would create 300+ duplicate BIs. **BI-EDFBE081 is therefore re-scoped** to a careful provenance refactor (route the triage `createBacklogItem` through `ingestBacklogItem` so the link is a standard origin marker + `intake_origin` activity instead of the free-text "Source report:" ref and the "experimental" marker resolution `getBacklogLinksForReports` does today) — NOT a page fold or backfill. It is entangled with the triage's own dedup, so it warrants its own design pass.
- **AssuranceFinding** — `createBacklogItemFromFinding` is a correct operator-triggered remediation path (the audit-ledger pattern: only an explicit "file to backlog" creates a BI). It was the last divergent BI-create path (a bespoke `prisma.backlogItem.create`). This slice converges it onto the shared front door (`ingestBacklogItem`, origin `{kind:"assuranceFinding", id:findingKey}`) so every detector files through one path. Dedup (finding `evidence.backlogItemId`), the `planned` status transition, and the done-epic reopen are unchanged. (0 live findings — consistency change, no backfill.)
- **Domain ledgers** (`TaxIssue`/`LicenseReadinessIssue`/`PortfolioQualityIssue`/`EaConformanceIssue`) stay audit surfaces — only an explicit platform-fix remediation files a BI; never bulk-file customer-domain findings into the platform backlog.

Net: every genuine redundant intake queue is consolidated into the single backlog; the remaining intake surfaces feed the backlog correctly; the one open item (BI-EDFBE081) is a provenance refactor, not a queue elimination.

## 4. Verification Gates (this slice)

| Layer | What to run / show |
| ----- | ------------------ |
| Unit | `pnpm --filter web exec vitest run` — new/updated `backlog-ingest.test.ts`: marker compose (idempotent, no double-append), `intake_origin` activity write on create and dedupe, itemId gen with/without prefix, dedup decision (origin hit bumps vs. miss creates), workType derivation from improvement category, status default, structured-error preservation for `create_backlog_item`. Existing `process-observer-triage` / `mcp-tools-backlog` suites stay green. |
| Typecheck / build | Source-local: `pnpm --filter web typecheck`. Runtime-bound build: `pnpm --filter web build` only on the canonical local install or shared local-CI convergence sandbox, per AGENTS.md §5. |
| Functional (live install / shared lease) | Run `pnpm verify:preflight -- --feature-sha <sha>` first. If `CAN-TEST`, drive `propose_improvement` (a coworker proposes an improvement) → confirm a `triaging` `BacklogItem` appears in `/ops` immediately, linked back, with a real `workType`, a typed proposal link, and an `intake_origin` activity row — no manual Review/Prioritize needed. Re-propose the same origin → `occurrenceCount` bumps, no duplicate. This is the structural→functional step required before claiming the symptom fixed. |
| UI (Phase 6 only) | Browser exercise on `/ops` and each retained evidence view at desktop and mobile widths. Verify no hardcoded colors, no overlapping text, and report-kit reuse for status/table/filter/KPI elements. |
| Migration | None in Phase 1 unless explicit origin/dedupe columns are added. If a migration is added, it must include inline backfill SQL and apply cleanly in the canonical runtime or shared local-CI sandbox. |

## 5. Advisory Review Result

**Architecture review (advisory): aligned with important guardrails.**

- `[important]` The original draft said the helper "reuses" `create_backlog_item` rules while allowing a duplicated validation path. That would create the same drift this spec is meant to remove. The spec now requires shared pure helpers and MCP delegation before Phase 1 is considered complete.
- `[important]` Body-marker provenance alone is not a durable enterprise record. The spec now uses typed back-links where present, `BacklogItemActivity(kind="intake_origin")` as the canonical audit trail, and treats the marker as a compatibility bridge only.
- `[important]` The `/ops` fold can easily become another dashboard. The spec now frames it as UI convergence and requires report-kit/theme-token reuse, filtered backlog views, and evidence/detail pages instead of new queue dashboards.
- `[minor]` Live MCP verified the BI set under `EP-INTAKE-UNIFY`; that evidence is now named in the frontmatter and current-truth table.

**UX fit review:** `fits-with-guardrails`.

- Owning area: Platform Operations.
- Route family: `/ops` as canonical work view; origin pages become linked evidence/detail views.
- Primary persona: founder/operator deciding what portal-development work deserves triage, build, defer, or discard.
- Navigation layer touched: section/local navigation only; no global nav addition.
- Reuse/convergence: report-kit for reporting/data-display; existing backlog lifecycle copy and status intent registry for statuses.
- AI boundary: informational rows and metric links navigate only. Any coworker-starting action must show context preview and explicit confirmation.
- Required spec/plan edits: keep the guardrails above in every phase plan and add browser evidence for Phase 6.

## 6. Next Step After Sign-Off

Implement Phase 1 directly on this worktree (Build Studio stabilization in progress; direct DCO PR is the current ship path), DCO-signed PR off `origin/main`, full build gate, then functionally verify through the live-install preflight/shared-lease path. Phases 2-6 proceed one BI at a time, each migrating one queue onto the shared front door without widening UI or lifecycle surface area.
