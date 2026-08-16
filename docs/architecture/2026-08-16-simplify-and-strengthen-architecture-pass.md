# Simplify & Strengthen — Whole-Platform Architecture Pass (2026-08-16)

**Status:** point-in-time architecture review (advisory). **BI:** BI-4C9D700D · **Capsule:** WC-A843A014
**Relationship to prior art:** refreshes and extends the [whole-platform architecture hardening plan](../superpowers/plans/2026-08-01-whole-platform-architecture-hardening.md) (2026-08-01), the [platform substrate convergence design](../superpowers/specs/2026-07-17-platform-substrate-convergence-design.md), and the [platform adequacy review](2026-06-22-platform-adequacy-architecture-review.md). It does not supersede any of them; it re-cuts priorities against the customer base the platform is preparing for and adds UX-primitive and data-model depth those documents did not carry.
**Method:** five parallel evidence sweeps (architecture-doc history, code structure, Prisma data model, UX primitives/IA, forward scope) with first-hand verification of every load-bearing claim: live backlog queries over MCP, a fresh run of the application-boundary guard, compose-topology grep, and schema counts re-measured on disk. Numbers are as-of 2026-08-16 unless dated otherwise. ⟦runtime: every count in this document drifts — re-measure before acting on one⟧

---

## 1. The customer base this architecture must serve

From the strategy corpus, live epics, and recent plans, the demand profile is specific and unusual:

| # | Demand | Source |
|---|--------|--------|
| D1 | **Horizontal scale**: many small single-tenant sovereign installs on lean hosts (LAN, Windows/macOS, Docker Desktop, CGNAT) — never one big multi-tenant deployment | deployment-contracts spec; cloud-deployment spec; recent lean-host fix commits |
| D2 | **MSP channel**: managed estates *inside* one MSP org (Topology A, strict `CustomerAccount`/`CustomerSite` scoping) plus sovereign-peer federation (Topology B) | [managed-services & federation design](../superpowers/specs/2026-06-24-managed-services-delivery-and-cross-org-federation-design.md); [MSP channel readiness path](../superpowers/specs/2026-07-22-local-msp-channel-readiness-path.md) |
| D3 | **Archetype breadth**: 106 archetypes / 24 categories, new categories landing roughly monthly, each provisioning four dimensions; behavior must derive from operating-model axes, never `archetypeId === "…"` | archetype provisioning playbook; four-portfolio standard |
| D4 | **Non-technical operators**: any flow requiring a shell, config file, or DNS record is a design failure, not a runbook | edge topology plan; federation robust-design plan |
| D5 | **Per-surface reachability**: some surfaces need stable public HTTPS across CGNAT; MCP and A2A stay private; endpoints need a public/private classification at birth | [edge reachability topology plan](../superpowers/plans/2026-08-11-edge-reachability-topology.md) (EP-8B03CB06) |
| D6 | **Governance on the hot path**: a pre-execution policy decision point in front of every consequential tool call, with hash-chained receipts | [WWWD constitutional alignment gate](../superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md) (EP-1C37C089); trust-envelope plan |
| D7 | **Sovereignty as product**: local inference fails loudly rather than silently egressing; SBOM/attestation; EU CADA positioning | docs/strategy (CADA corpus) |
| D8 | **The growth rate itself**: 560 → 588 Prisma models in the 15 days since the hardening baseline; 222 schema-touching commits in 90 days; ~654 specs with no index. The architecture must metabolize this production rate safely | measured this pass |

Everything below is judged against D1–D8, not against generic best practice.

## 2. State of the existing hardening program (verified live)

The 2026-08-01 hardening plan is the right program — this pass confirms its diagnosis. But its live state needed checking, and the check found three things:

1. **Its coordination anchors do not exist.** `EP-413F2602`, umbrella `BI-C04CAD7F`, and Phase-1 `BI-2E9F6D37` all return `not_found` from the live backlog (verified 2026-08-16 via MCP). The platform's flagship architecture program is invisible to its own coordination plane — a direct violation of "MCP is the coordination plane" (AGENTS.md §12), and a recurrence of the known unbacked-doc-anchor pattern.
2. **Phase 1 nonetheless shipped.** PR #3921 landed `scripts/application-boundaries.json` (8 contexts), `scripts/check-application-boundaries.mjs`, and the CI wiring. The guard passes today.
3. **The guard is freezing, not converging.** Cross-context imports: 498 at baseline → **504 today** (+6 in two weeks, all via permitted edges). Owned exceptions: **65 → 65, unchanged**. The plan's own top risk — "a baseline can legitimize debt" — is materializing on schedule.

**Consequence:** the first move of any simplification program is not new analysis; it is re-anchoring the existing program in the live backlog and converting its frozen baselines into owned, expiring budgets (the plan's own Phase 6, which has not started).

## 3. Findings by lens

### 3.1 Code structure

Scale: ~1.35M LOC TS/JS across 12,380 tracked files; `apps/web` is 84% of it (7,038 files / ~1.14M LOC). Fourteen satellite packages, of which several are questionable as packages (§3.1-f). Tests are a healthy ~37% of the app.

**(a) `apps/web/lib` is a flat namespace, not a layered architecture.** 163 subdirectories plus **291 loose files at `lib/` root**; 36 directories contain exactly one module. The boundary guard's 8 governed contexts cover the six largest areas, but the long tail is where drift accumulates.

**(b) Near-synonym directory pairs put the same concern in two homes:**

| Collision | Evidence |
|---|---|
| `lib/integrate/` (344 files) vs `lib/integrations/` (21) | **Two connector registries.** `integrate/` also fuses in the entire Build Studio orchestrator — two unrelated subsystems in one directory |
| `lib/govern/` (99) vs `lib/governance/` (11) | auth/credentials vs findings/severity — actively confusing |
| `lib/ops/` vs `lib/operate/` vs `lib/operations/` vs `lib/operations-run/` | four namespaces, one concern |
| `lib/release/` | contains `storefront-actions/auth/data/middleware/types.ts` while an 83-file `lib/storefront/` exists — pure misfiling |
| `lib/workspace/` vs `lib/workspace-home/`, `lib/edge/` vs `lib/edge-node/`, `lib/platform/` vs `lib/platform-runtime/` vs `lib/platform-config/` | one-file orphans beside their real home |
| `components/build/` (130 files) vs `components/build-studio/` (35) | despite a namespace-convergence doc ([build-studio-namespace.md](build-studio-namespace.md)) |

**(c) The MCP tool layer has three coexisting generations.** `lib/mcp/packs/` (~90 pack modules — the current pattern), `lib/mcp-tools.ts` (1,952-LOC legacy monolith; the module-size guard's header records it once reached ~15k LOC), and `lib/mcp-handlers/` (an abandoned third pattern containing exactly one file). ~30 orphaned root-level `mcp-tools-*.test.ts` files test subjects that already moved into packs.

**(d) The coworker domain is fragmented across at least nine homes:** seven `lib/coworker*` directories, ~30 `coworker-*.ts` files inside `lib/tak/` (276 files, 53k LOC, no stated boundary), and `lib/actions/agent-coworker.ts` — at 2,793 LOC the largest hand-written module in the repo.

**(e) Coupling is measured and real:** 65 mutually-importing `lib/*` directory pairs; heaviest are `actions↔tak` (61/5), `integrate↔mcp` (1/60), `inference↔routing` (45/9), `build↔integrate` (15/31). `lib/actions/` (199 non-test modules, 84.5k LOC) imports from **70 distinct sibling directories** — server actions are a transport, but this directory has become a domain-logic warehouse.

**(f) The workspace map lies.** `packages/dpf-skill-pack` (no `package.json`), `services/browser-use` (Python), and `services/edge-node-go` (Go) live in workspace-shaped directories but are invisible to pnpm — and `apps/web` reaches into two of them by raw relative path (e.g. `lib/build/capability-packs.ts:1`). `@dpf/db` exposes **63 export subpaths** and is imported by 1,948 files — a namespace, not a boundary — with 7 relative-path escapes bypassing even that (e.g. `lib/tak/agent-grants.ts:2` → `../../../../packages/db/data/agent_registry.json`). `@dpf/coworker-sim-harness` has **zero importers** (its own spec calls it "an island"), while its oracle pattern was re-implemented at `lib/business-activity-sim/oracles.ts`.

**(g) Deliberate duplication to respect:** the TS/Go edge-node pair is ADR-backed ([edge-node runtime decision](../superpowers/specs/2026-05-16-edge-node-runtime-decision.md)) and parity-tested — a standing tax, not a defect. Similarly the hand-rolled MCP JSON-RPC transport was deliberately kept over `@modelcontextprotocol/sdk` (2026-08-06 adoption spec).

### 3.2 Data model

Verified counts: **588 models, 5 enums, 503 migrations (5 months), 515 `Json` columns across 266 models, 1,501 indexes, zero `deletedAt`, zero partitioned tables.**

**(a) The enum rule is systematically violated — and codified.** AGENTS.md §8: "Closed-set string fields are typed enums, never free-form strings." Reality: 5 enums against ~648 closed-set string columns (298 `*Status`, ~301 `*Type`/`*Kind`). A schema comment at `schema.prisma:16095` *blesses* the anti-pattern ("Discriminator fields are String (allowed values named in comments)…"). `BacklogItem` alone carries 14 comment-documented closed sets; `CustomerAccount.status` defers its 9-value union to a TS file with no DB enforcement.

**(b) Referential integrity has holes on the spine.** ~360 FK-shaped `*Id` columns with no declared relation across 209 models — including 7 on `WorkCapsule`, the work-convergence spine (`epicId`, `taskRunId`, `changePromotionId`, `leaseHolderPrincipalId`, …), and **20 models carrying `organizationId` with no FK to `Organization`** (the whole `Staffing*` family among them). Separately, ~204 *declared* FK relations lack a leading index — including `BacklogItem.epicId`, `CustomerContact.accountId`, `TaxonomyNode.parentId` (an unindexed recursive tree), and the `EpicPortfolio` join table indexed on neither side.

**(c) Parallel model families repeat one concern.** `BeautyResourceAvailability` ≡ `HospitalityResourceAvailability` field-for-field and index-for-index; same for the two `*CapacityAllocation` ledgers; `ProviderAvailability` and `EmployeeAvailabilityWindow` are third and fourth expressions of resource availability. Seven activity ledgers; eight version/revision implementations; ~22 scheduling/booking models including both `RecurrenceSchedule` *and* `RecurringSchedule`; **ten carriers of "a unit of work"** (`BacklogItem`, `Epic`, `WorkCapsule`, `WorkItem`, `FeatureBuild`, `TaskRun`, `TaskNode`, `WorkEngagement`, `FinanceWorkItem`, `StaffingDemand`). The platform knows this — EP-WORK-CONVERGENCE and the `dpf-bring-work-under-formula` skill exist — but each new vertical still adds clones.

**(d) "Not active" is said six ways:** `archivedAt`, `supersededById`, `mergedIntoId`, `quarantinedAt`/`overlapQuarantinedAt`/`conflictQuarantinedAt`, `retiredAt`, `status="quarantined"`. Every reader must know which convention applies per table; that is a correctness-bug factory.

**(e) Growth tables outrun retention.** The retention registry (`apps/web/lib/operate/retention/policies.ts`) is well built but enrolls only 19 models for purge; **~39 append-only tables are unenrolled** (`EdgeEvent`, `ChangeEvent`, `IntegrationToolCallLog`, `QueueTelemetryEvent`, `AdminActivity`, `LifecycleEvent`, `ToolExecutionReceipt`, …), and 26 have no index on any time column — the sweep itself would seq-scan. At fleet scale (D1×D8) this is the slow-motion outage. The federation `take:1000` silent-truncation bug (fixed on main) was the canary for unbounded reads generally.

**(f) Write-path imbalance:** `ToolExecution` — the highest-volume table — carries 13 indexes; `WorkCapsule` 14; meanwhile 60 models have zero. Index hygiene must run in both directions.

**(g) Multi-tenancy posture is implicit and inconsistent — the highest-stakes open question.** Only 117/588 models carry `organizationId`. The CRM/commerce spine (`CustomerAccount` → `Invoice`/`Quote`/`Opportunity`/`Subscription`/`ServiceTicket`) has no tenant column; ~150 call sites do unfiltered `prisma.organization.findFirst()` (correct only if exactly one org exists); one 2026-04 migration deliberately *removed* org scope from `Portfolio`. Yet the newest verticals (`Beauty*`/`Care*`/`Catalog*`) correctly use composite FKs `references: [id, organizationId]` with org-leading uniques. So the schema is half single-tenant-by-invariant, half multi-tenant-by-pattern, with the invariant written nowhere. MSP **Topology A** (many customer estates inside one MSP org) is precisely where this ambiguity will surface as a data-isolation incident.

**(h) Structural positives to build on:** pgvector with partial HNSW per collection; the Postgres graph mirror that replaced Neo4j; optimistic-concurrency `version` columns in newer domains; the declarative retention registry; the Prisma→EA data-model mirror; the migration-safety guard (L1+L2 of fleet-safe schema evolution) — with L3 (shadow-DB preflight, BI-UPGRADE-008) still the missing load-bearing piece for fleet upgrades.

### 3.3 UX primitives & information architecture

**(a) The primitive layer is three stacked kits with one success story.** `report-kit` (13 components, a spec, a README) is genuinely adopted — 193 importing files, `StatusBadge` in 145. The form contract (`components/ui/form/`, BI-8E74C749) has **17 importers against 235 files using raw `<input>`** and 156 raw `<select>`. `page-shells/PageShell.tsx` — the L1 reading contract the UX-budget machinery *measures* — has **one consumer out of 350 routes** (192/198 measured routes have `leadBandWords: 0`). `lib/shared/action-result.ts`, whose own header says it replaces "~700 hand-inlined return sites," has 6 importers against **1,590 `ok: true` sites and 9 competing local result aliases** (three of which use `message` instead of `error`).

**(b) The two most-repeated markup patterns have no primitive at all.** There is no `Button` and no `Card`/`Surface` component: the card string (`border-[var(--dpf-border)] … bg-[var(--dpf-surface-1)]`) appears **727 times in 426 files**; the accent-button string **296 times**; 1,321 raw `<button>` sites. Directly downstream: `text-white` (346 occurrences) is the largest theme-violation class because the accent-button label has no token — and the canonical `primaryButtonClass` itself uses `text-white` (`components/ui/form/styles.ts:27`). **The missing `--dpf-on-accent` token makes compliance impossible today.**

**(c) The token system itself is healthy.** ~27 `--dpf-*` color/font properties + 152 generated design tokens, 22,283 `var(--dpf-…)` references, runtime brand override working. Violations concentrate in local status→hex maps (e.g. four byte-similar palettes across `finance/{bills,purchase-orders,expense-claims,suppliers}/[id]/page.tsx`) that slip past `check-no-local-status-color.mjs` because the guard only matches `Record<…, Intent>` shapes.

**(d) The IA carries two unlinked taxonomies.** The rail is 6 sections (`portal-shell-sections.ts`: workspace/business/products/delivery/platform/knowledge; only 21 of 350 routes have rail entries; `workspace` holds one item while `business` holds nine). The 4-portfolio DPPM model lives separately in `lib/attention/outside-in.ts` and `packages/db/src/device-placement.ts` and drives attention-ranking and taxonomy placement. "Products" means different things in each; no code maps between them. Sub-navigation is a second source of truth: 8 per-domain `*-nav.ts` data files + 15 `*TabNav` components feed a shared model that had to grow 3 variants × 4 tones to absorb the divergence — while `portal-navigation-model.ts` (948 LOC) already encodes the same trees.

**(e) Form/action mechanics are hand-rolled 200 ways.** 195 files use `useTransition` + local `useState` error handling; `useActionState` is used once; `FormStatus` 16 times against 59 hand-written `role="alert"` and 126 hand-styled error paragraphs. And the app has **2 `error.tsx` / 3 `loading.tsx` / 3 `not-found.tsx` for 350 routes** — most surfaces have no consistent failure or loading face.

**(f) Duplicated primitives:** two Skeletons and two SearchableSelects each claiming canonicity in their header comment (+ `ReferenceTypeahead` as a third picker); nine dialog/modal/drawer implementations; ~48 local status-color maps and ~10 bespoke badge components bypassing `StatusBadge`; ~180 hand-rolled empty states vs 28 uses of `EmptyState`; a local `CockpitShell` in `OperatorCockpit.tsx:19` shadowing the real `CockpitShell` export by name.

### 3.4 Runtime & deployment topology

The runtime shape is sound for D1: one compose project, capability-gated profiles (verified: inngest v1.36.0 + redis:7 are in the base compose under `runtime-durable-automation`), Postgres as sole datastore, edge nodes as thin outbound-only satellites with a real fleet lifecycle model. Points of friction:

- **Compose sprawl:** a 49.5KB base file with 25 services plus **15 overlay compose files** (5 for edge alone), and 12 hand-maintained `dev_nm_*` volumes that must track workspace membership by hand.
- **Reachability is designed but not enforced:** the edge-reachability plan (EP-8B03CB06, current branch) correctly mandates path-segmented public exposure — because `proxy.ts` is fail-open for `/api/*`, bearer credentials lack transport binding, and `/api/a2a/tasks/[taskId]` has no auth (named gap). What's missing is the *architectural* rule: every new endpoint declares public/private classification at birth, enforced by a guard, not a plan.
- **The API namespace mirrors the lib/ drift:** 133 handlers under `/api/v1` but ~25 one-route namespaces outside it.
- **Guard/test toolchain sprawl:** 568 script files, 112 `check-*.mjs` guards (51 tested), ~90 npm scripts, four test runners (vitest/jest/playwright/node:test). Each guard is individually justified; collectively they are their own governance surface with no registry-level ownership yet (the plan's Phase 6).

### 3.5 The architecture knowledge base

- **Two competing living overviews** — [orientation.md](orientation.md) (19 lines) and [platform-overview.md](platform-overview.md) (42KB) — that contradict each other on compose topology, with no statement of which wins. Orientation omits the coworker runtime, MCP plane, Build Studio, decision governance, edge, and EA entirely.
- **654 specs + 784 plans with no index and no status convention.** Status appears in ≥4 formats; exactly one spec is marked "binding" (edge node) while the deployment-contracts doctrine — cited as binding from orientation — still says DRAFT. Supersession is free-text in four formats; superseded specs sit unmarked in the active directory; four specs are HTML-only and invisible to markdown lint/search.
- **~30+ specs still describe retired Neo4j/Qdrant as live**, including deployment-contracts and the binding edge-node spec.
- **Counts are hand-maintained and diverge:** kernel principles reported as 157/95/101/92 across four docs (87 on disk today); model counts drift within a day of each other.
- **In-corpus best practices worth generalizing:** the `⟦runtime:…⟧` drift annotation (used in exactly one file), the golden-triangle "code wins, this doc is the bug" posture, the edge-node operator docs' back-linking discipline, and the founder-kernel provenance ledger.

## 4. Systemic diagnosis — three patterns, one root cause

**P1 — Paved roads without ratchets.** The platform repeatedly builds the correct canonical primitive and leaves adoption voluntary:

| Canonical thing | Adoption | Hand-rolled competition |
|---|---|---|
| `ActionResult` | 6 files | 1,590 `ok:true` sites, 9 local aliases |
| Form contract | 17 files | 235 raw-`<input>` files |
| `PageShell` L1 contract | 1 route | 349 routes |
| Prisma enums | 5 | ~648 closed-set strings |
| Retention registry | 19 models | ~39 unenrolled growth tables |
| WorkUnit formula | adapter exists | 10 work carriers |
| `report-kit` | **193 files — the success** | (see below) |

The one success, `report-kit`, won because it shipped with a spec, a README, named components for each use case, and a CI ratchet culture around it. The lesson is mechanical: **a primitive is not "done" until its adoption ratchet is on.** The repo already invented the ratchet pattern (module-size baseline, boundary guard, status-color guard, loading-primitive guard); it is applied to *violations* but almost never to *adoption*.

**P2 — Generations coexist without supersession.** Three MCP handler generations; two living overviews; two connector registries; nine result aliases; six "not active" conventions; free-text supersession across 654 specs; orphaned tests at old addresses. New patterns land; old ones are not retired in the same motion. Supersession must become a mechanical act — in code (delete/redirect in the same PR) and in docs (a status field + a superseded marker a linter checks).

**P3 — The coordination plane and reality drift apart.** The flagship hardening program is unbacked in the live backlog; doc-cited BIs "never existed"; counts are hand-maintained; the boundary baseline froze without converging. Governance that approves evidence needs its anchors to exist and its baselines to expire.

**Root cause, honestly stated:** this codebase is produced at AI-agent velocity across four delivery surfaces. The doctrine anticipated this ("convert disciplines to gates") and the gate machinery exists and works — the drift concentrates precisely in the gaps where a discipline was documented but never converted: adoption, supersession, anchor-existence, baseline expiry. The fix is not "slow down" and not "more docs"; it is closing those four gate gaps so the existing velocity compounds instead of sprawling.

## 5. The program — ranked moves

Grouped in three tiers by leverage-per-risk. Each move names its evidence (§ above) and its natural home. Existing epics own most of this; genuinely new work is marked ★.

### Tier 0 — do first (low risk, high leverage, mostly additive)

1. **★ Re-anchor the hardening program** (§2): file the real epic + BIs for the 2026-08-01 plan's 22-deliverable table (or re-map to live ids), and add an anchor-existence check — any EP-/BI- id cited in a merged doc must exist in the DB (extend an existing doc guard). Closes P3 at the source.
2. **Data-integrity pack** (§3.2-b/e): add the ~204 missing FK indexes (priority: recursive trees, join tables, `BacklogItem`, `CustomerContact`); add FKs for `WorkCapsule`'s 7 unbacked links and the 20 unbacked `organizationId`s; enroll the 39 growth tables in retention and index their time columns. All forward-only additive migrations; per the plan's own caveat, justify each index against a query path and *prune* the speculative ones on `ToolExecution`/`WorkCapsule` while there.
3. **UX foundation pack** (§3.3-b/e): ship `Button` + `Surface` primitives and the `--dpf-on-accent` token (fix `primaryButtonClass` in the same PR); one `ActionResult` codemod + a `check-no-local-action-result.mjs` ratchet; `error.tsx`/`loading.tsx` per route group (~14 files). Mechanically greppable, retires the largest violation classes.
4. **Doc-truth pack** (§3.5): subordinate one living overview to the other explicitly; adopt one status/supersession frontmatter convention + linter across specs/plans; generate the volatile counts (models, principles, routes) from source (the plan's Phase 4 / PR #3871 pattern); sweep the Neo4j/Qdrant references.

### Tier 1 — this quarter (structural, bounded risk)

5. **Enum migration for the top ~40 closed sets** (§3.2-a), starting where a TS union already declares the set (`CustomerAccount.status`, `BacklogItem.*`, `WorkCapsule.status`, `FeatureBuild.status`); delete the schema comment blessing the anti-pattern. Fleet-safe via expand→contract where values drifted.
6. **Collapse the MCP handler layer to one generation** (§3.1-c): fold `mcp-tools.ts` + `mcp-handlers/` into packs; relocate/delete the ~30 orphaned tests. Dissolves the `integrate↔mcp` 60-edge cycle's worst half.
7. **Split `lib/integrate/` on its real seam** (§3.1-b): connectors → `lib/integrations/` kernel (one registry); Build Studio orchestration → `lib/build/`. Then the cheap renames: `govern`/`governance` collision, `release/storefront-*` misfiling, the four operations namespaces, one-file directory merges.
8. **Split `schema.prisma` into a Prisma schema folder** along domain boundaries (§3.2, D8): zero-semantic-change, removes the chronic merge-conflict surface (222 commits/90 days on one 16.7k-line file), and makes per-domain ownership assignable (plan Phase 5 / BI-PSC-006).
9. **Single-source sub-navigation** (§3.3-d): fold the 8 `*-nav.ts` files + 15 `*TabNav`s into `portal-navigation-model.ts`; then decide the rail↔portfolio relationship explicitly (kernel consult — either map them or document them as orthogonal axes with distinct vocabulary).
10. **Thin `lib/actions/`** (§3.1-e) as the existing plan's Phases 2–3 execute (ActorContext, transport-neutral services): domain logic moves next to its subsystem; actions become wrappers. Sequenced behind #6/#7 to avoid double-moves.

### Tier 2 — next quarter (decisions and deeper surgery)

11. **Ratify the multi-tenancy posture in writing** (§3.2-g) — the single highest-stakes open question. Recommended: keep **install = tenant** as a written invariant (it is the product's sovereignty thesis, D1/D7) *and* harden the one real intra-install boundary the MSP motion depends on (Topology A): extend the composite-FK `organizationId` pattern the new verticals already use across the CRM/commerce spine, and add a lint that fails unfiltered `organization.findFirst()` (150 sites). This keeps the door open to estate-scoped isolation without committing to SaaS multi-tenancy.
12. **Collapse the vertical clone families** (§3.2-c): one `Resource`/`ResourceAvailability`/`CapacityAllocation` set with a domain discriminator — *before* the next archetype wave (agriculture, manufacturing just landed) adds four more clones. Also fold `RecurrenceSchedule`/`RecurringSchedule`.
13. **Unify the "not active" convention** (§3.2-d): one lifecycle enum + timestamp; migrate the six conventions; document in the stewardship runbook.
14. **Consolidate the coworker domain** (§3.1-d): one `lib/coworker/` home, a stated `tak` boundary, and `agent-coworker.ts` decomposed — coordinate with EP-31815F97 (authority model) and EP-COWORKER-LIFECYCLE.
15. **Endpoint classification at birth** (§3.4, D5): a manifest field (public/authenticated/private-mesh) required for every `route.ts`, guard-enforced — the durable form of the reachability plan's path-segmentation rule.
16. **Workspace honesty** (§3.1-f): make `dpf-skill-pack`, `browser-use`, `edge-node-go` explicit members or move them; close the 7 relative-path escapes with a guard; begin shrinking `@dpf/db`'s 63 subpaths toward the package-boundaries doc's portable-contract rule; delete-or-wire `coworker-sim-harness`.

### What NOT to do

- **Do not** add SaaS-style tenancy columns everywhere — the sovereignty premise (one install per customer) is the product. Harden the MSP estate boundary; keep the invariant explicit.
- **Do not** replace the hand-rolled MCP transport with the SDK — decided 2026-08-06 with reasons that still hold.
- **Do not** collapse the TS/Go edge pair — ADR-backed, parity-tested, platform-constrained.
- **Do not** mechanically index all 204 FKs — hot tables already over-indexed; every index needs a query path.
- **Do not** start a rewrite of `lib/` — the boundary guard + targeted splits (#6, #7, #10) converge it incrementally; a big-bang restructure would fork every open branch.
- **Do not** spend this capacity on new taxonomy (the `EP-BUILD-*` single-item epic noise is a hygiene sweep, not a program).

## 6. Readiness scorecard

| Demand | Grade | Why |
|---|---|---|
| D1 fleet of lean sovereign installs | **Yellow** | Compose/profile model right; migration-safety L1/L2 shipped; but L3 shadow-DB preflight missing, 39 unbounded growth tables, no partitioning |
| D2 MSP topologies | **Red** | Topology A's tenant boundary deferred while CRM spine is org-blind and 150 `findFirst()` sites assume one org — the go-to-market rests on the schema's weakest invariant |
| D3 archetype breadth | **Yellow** | Four-dimension provisioning + completeness guard are excellent; but each vertical still clones models (§3.2-c) — cost per archetype is growing, not shrinking |
| D4 non-technical operators | **Yellow** | Direction right (SAS pairing, generated enrollment); UX substrate under it inconsistent (forms, errors, empty states hand-rolled per page) |
| D5 per-surface reachability | **Yellow** | Plan exists and is correct; classification-at-birth guard missing; known unauth'd A2A endpoint |
| D6 hot-path governance | **Yellow** | Decision substrate deep and real; execution-time chokepoint (the 2026-05-24 gap) still landing via EP-1C37C089; latency/fail-mode budgets not yet stated |
| D7 sovereignty | **Green-ish** | Postgres-only, local inference, SBOM machinery, hive egress boundary understood — strongest story; keep the "fails loudly" invariant tested |
| D8 metabolizing growth | **Red→Yellow** | The gate machinery exists and works where applied; the four gaps (adoption, supersession, anchors, baseline expiry) are exactly where sprawl leaks in — Tier 0 closes them |

## 7. Measurement

Track the pass's effect with numbers already cheap to produce, on a nightly cadence via the existing conformance/parity machinery (no new infrastructure): boundary imports & exception count (504 / 65 today), enum count vs closed-set count (5 / ~648), primitive-adoption ratios (ActionResult 6:1,590; forms 17:235; PageShell 1:350), retention enrollment (19:58), FK-index misses (204), model count per week (+28 over the last 15 days), spec status coverage (1 binding / 654). Every baseline this document cites should appear there with an owner and an expiry — the plan's Phase 6, which is where freeze becomes convergence.

---

*Method note: five agent-assisted evidence sweeps over the working tree at `origin/main` 4d9159946 / local f0ba454, with first-hand verification of all load-bearing claims (live backlog MCP queries, boundary-guard execution, compose grep, schema counts). One sweep error was caught and corrected during verification (a claim that Inngest/Redis were absent from compose — they are present under the `runtime-durable-automation` profile), which is the reason every consequential number above was re-measured before citation.*
