# Work Intake Unification — One Front Door for Portal-Dev Work

| Field | Value |
| ----- | ----- |
| Status | Draft |
| Date | 2026-06-06 |
| Epic | [`EP-INTAKE-UNIFY`](#) — "Single front door for work intake — consolidate isolated queues into the backlog" |
| Backlog items | BI-2BB06F90 (shared front door — foundation), BI-7541AB88 (auto-file ImprovementProposal — this slice), BI-B716B387 (ImprovementSignal), BI-8CE36E65 (CoworkerCapabilityNeed), BI-EDFBE081 (PlatformIssueReport sync projection), BI-353702E8 (audit ledgers), BI-196693D6 (UI fold) |
| Related substrate | [`apps/web/lib/operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts) (the pattern this generalizes); [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts) (enums); [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) (`create_backlog_item`, `propose_improvement`); [`apps/web/lib/actions/improvements.ts`](../../../apps/web/lib/actions/improvements.ts); [`apps/web/lib/skills/proposals.ts`](../../../apps/web/lib/skills/proposals.ts); `BacklogItem`, `ImprovementProposal`, `ImprovementSignal`, `CoworkerCapabilityNeed`, `PlatformIssueReport` |
| Related specs | [Unified backlog + workType (2026-05-30)](2026-05-30-unified-backlog-worktype-design.md) — landed; this spec is the broader sibling it deferred. |
| Scope | Build ONE shared backlog-ingest helper (`ingestBacklogItem`) that every detector/queue files through; auto-project the isolated portal-dev queues into `BacklogItem` at the moment their origin record is created, back-linked, deduped — so work is visible in the backlog the instant it's detected, with no manual promotion step. Phase 1 (this slice): the shared front door + auto-file `ImprovementProposal` (the visible symptom) + fix the no-`workType` defect in `prioritizeImprovement`. Phases 2-5: the remaining queues + the UI fold, one BI each. |
| Out of scope | Operational / human work queues (customer inquiries, bookings, marketing tasks, leave requests, onboarding tasks, customer-estate triage) — those are a SEPARATE mechanism (the collaborative `WorkQueue`/`WorkItem` substrate), not the portal-dev backlog. Skill-content proposals (`category="skill"`, governed approve/rollback in `skills/proposals.ts`) — they have their own revision-governance lifecycle and are not generic backlog work. Domain audit ledgers (`TaxIssue`, `LicenseReadinessIssue`, `PortfolioQualityIssue`, `EaConformanceIssue`) stay audit surfaces; only their platform-dev *remediation* files a BI (Phase 5). |

---

## 1. Problem

Operator (Mark) flagged hidden queues: portal-dev work captured in their own tables/pages, never landing in the backlog, so it is invisible and never prioritized. The visible symptom: Operations → Improvements (`ImprovementProposal`), where `IP-6F240` ("Estate Specialist: auto-investigate unknown devices") sits at `proposed` indefinitely.

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
| Enums | `BACKLOG_WORK_TYPE_VALUES`, `BACKLOG_SOURCE_VALUES`, `BACKLOG_STATUS_VALUES`, `BACKLOG_TRIAGE_OUTCOMES` in [`backlog.ts`](../../../apps/web/lib/explore/backlog.ts). | The front door types its inputs against these; no new enums. |
| Canonical create | `create_backlog_item` ([`mcp-tools.ts:5301`](../../../apps/web/lib/mcp-tools.ts)): itemId gen, status/triageOutcome pairing rules, epic semantic→cuid resolve, semantic index. | The front door extracts this logic so the MCP tool and every detector share one implementation. |
| Generalizable pattern | `buildBacklogItemData` + `isDuplicate` + `triageAndFile` ([`process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts)) — pure builder + dedup + injectable-deps filing, already unit-tested. | The front door is this pattern, promoted to the canonical home and given an origin back-link. |
| `ImprovementProposal` | `backlogItemId String?` link field exists; created at `status="proposed"` with no BI. | Auto-file at creation, set `backlogItemId`. |
| Skill proposals | `category="skill"` proposals run a governed approve/rollback that mutates `SkillDefinition.skillMdContent` ([`skills/proposals.ts`](../../../apps/web/lib/skills/proposals.ts)). | Excluded from auto-file — different lifecycle. |

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

1. **Provenance marker.** When `origin` is given, append a stable machine- and human-readable line to the body: `[origin:<kind>:<id>]`. This makes the link queryable without a schema change (the same "embed the source id in the body" pattern `quality.ts` and `improvements.ts` already use, now standardized). Callers that own a typed FK field (`ImprovementProposal.backlogItemId`, `CoworkerCapabilityNeed.linkedBacklogItemId`) **also** set it from the returned `itemId`.
2. **Dedup by origin.** Before creating, if `origin` is set, look for a non-terminal (`status NOT IN (done, deferred)`) `BacklogItem` whose body contains the marker. On hit: bump `occurrenceCount` + set `lastSeenAt = now()`, return `{ itemId, created: false }`. This is what "whatever created these items still needs to create them, but they should land in backlog" requires — a recurring signal touches one item, not N.
3. **Create.** Otherwise create the `BacklogItem` reusing the validated `create_backlog_item` rules (itemId gen with optional prefix, status/triageOutcome pairing, epic resolve), default `status="triaging"` so the item enters the normal triage queue, index in semantic memory. Return `{ itemId, created: true }`.

**Why `status="triaging"` by default:** the consolidation makes work *visible and prioritizable*, it does not pre-decide the work. New auto-filed items land where every hand-filed item lands — the triage queue — and the existing scheduled triage drain / operator triages them. No queue gets to inject `status="open"` work that skips triage (closing the `prioritizeImprovement` defect by construction).

The front door deliberately extracts the *same* validated rules `create_backlog_item` already enforces (itemId gen, status/triageOutcome pairing, epic resolve). Migrating the existing call sites onto it — `create_backlog_item` (which returns structured `{success:false}` errors to MCP callers rather than throwing), issue-report triage, process-observer, assurance, `sendIssueReportToBuildStudioAsFix` — is a fast-follow, one reviewable diff each, so this slice does not change the MCP error contract while standing up the shared path.

### 3.2 Auto-file `ImprovementProposal` (this slice)

`propose_improvement` ([`mcp-tools.ts:11641`](../../../apps/web/lib/mcp-tools.ts)): after creating the proposal, call `ingestBacklogItem` with `origin={kind:"improvement", id:proposalId}`, `source="automated-detection"` (a coworker observed the friction), `workType` derived from `category` (`category==="skill"` never reaches here; map `bug`-ish categories to `bug`, else `feature`), `itemIdPrefix="IMP"`, status `triaging`. Set `ImprovementProposal.backlogItemId` from the result. Move the (currently dead) semantic-index call before the `return`.

`prioritizeImprovement` ([`improvements.ts:54`](../../../apps/web/lib/actions/improvements.ts)): no longer the *only* path to a BI. If `proposal.backlogItemId` is already set (the normal case now), reuse it — do **not** create a second item. For legacy proposals created before this change with no link, ingest one through the front door (fixing the no-`workType` defect). The proposal's own status transitions are unchanged; the backlog is now the source of truth for the *work*, the proposal is the *evidence*.

The `/ops/improvements` page stays in this slice (its full fold into a filtered backlog view is BI-196693D6). It already shows the proposal lifecycle; a follow-up adds a "see backlog item" link.

### 3.3 The remaining phases (one BI each, not this slice)

| Phase | BI | Change |
| ----- | -- | ------ |
| 2 | BI-B716B387 | `ImprovementSignal`: flywheel evaluation files recurring/high-impact signals via the front door, deduped by `signalId`. |
| 3 | BI-8CE36E65 | `CoworkerCapabilityNeed`: auto-file on submission (`workType=skill|tool`), back-link `linkedBacklogItemId`. |
| 4 | BI-EDFBE081 | `PlatformIssueReport`: synchronous projection via the front door, retire the 15-min cron, fold `/admin/issue-reports` into a `workType=bug` view (the 2026-05-30 spec's Phase 2). |
| 5 | BI-353702E8 | Audit ledgers (`AssuranceFinding` already auto-files — migrate it onto the front door; others gain a rule/operator "file to backlog" affordance). |
| 6 | BI-196693D6 | UI fold: the former queue pages become evidence views; `/ops` is the one place to see and prioritize portal-dev work. |

## 4. Verification Gates (this slice)

| Layer | What to run / show |
| ----- | ------------------ |
| Unit | `pnpm --filter web exec vitest run` — new `backlog-ingest.test.ts`: marker compose (idempotent, no double-append), itemId gen with/without prefix, dedup decision (marker hit bumps vs. miss creates), workType derivation from improvement category, status default. Existing `process-observer-triage` / `mcp-tools-backlog` suites stay green. |
| Typecheck / build | `pnpm --filter web typecheck`; `cd apps/web && pnpm exec next build` — zero errors. |
| Functional (live install) | Drive `propose_improvement` (a coworker proposes an improvement) → confirm a `triaging` `BacklogItem` appears in `/ops` immediately, linked back, with a real `workType` — no manual Review/Prioritize needed. Re-propose the same origin → `occurrenceCount` bumps, no duplicate. This is the structural→functional step required before claiming the symptom fixed. |

## 5. Next Step After Sign-Off

Implement Phase 1 directly on this worktree (Build Studio stabilization in progress; direct DCO PR is the current ship path), DCO-signed PR off `origin/main`, full build gate, then functionally verify on the live install. Phases 2-6 proceed one BI at a time, each migrating one queue onto the shared front door.
