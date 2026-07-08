# Vertical Integration Inward — "Shift to Digital" applied to DPF itself

_Status: draft plan · Author: Claude (founder-directed goal session) · 2026-07-07_
_Method: 8-way grounded code-mining fan-out across 114 `lib/` domains + schema + Docker + deps · every opportunity cites `file:line`_

---

## 0. Executive summary

The founder's **Shift to Digital** thesis — assemble from external parts, then
**re-combine and hybridize** into an owned, manageable whole; software's version of
manufacturing **vertical integration** — now applies to DPF itself. DPF was
assembled from ~80 direct npm deps (deep transitive tree), a ~20-server external
MCP fleet, heavy Docker services (Postgres + Neo4j + Qdrant + Redis + an 8-container
observability stack + STT/TTS sidecars), four external coding engines, two skill
corpora, and **9,314 TS/TSX files across 114 `lib/` domains** plus a **12,124-line,
~410-model schema**.

Eight independent grounded miners swept the codebase against a 7-type opportunity
taxonomy. **The headline is convergence:** miners that never saw each other's work
kept surfacing the *same spines re-implemented 3–7 times*, because each subsystem,
portfolio, and vertical grew on its own. This is not scattered debt — it is a
**small number of un-unified spines** whose duplication radiates into thousands of
leaf-level change sites.

**By the numbers found (all grounded):**
- **~460 named opportunities**, decomposing to **~2,000–3,000 leaf change sites**.
- Duplication hot-spots: `err instanceof Error ? …` **×313 / 188 files** (no helper);
  **90** per-file auth guards; **85** hand-rolled `<table>`s (12 on the shared kit);
  **239** MCP tools in a **16,526-line** file; **173** `status String` fields against
  **4** Prisma enums; **386** Json columns; money encoded **4** ways; **6** near-clone
  backup/restore runners; **4–5** coexisting model-routing generations; **5** OAuth
  token-clients + **16** `*ApiError` classes + **12** clone connect-actions.
- Heavy externals that are **non-authoritative projections** and can hybridize onto
  Postgres: **Neo4j** (self-described "projection… for traversal only") and **Qdrant**
  (thin 768-dim REST store; `wiki/ppr.ts` already prefers Postgres-native).

**The 14 structural bets** (§4) are the spine. Ranked first-to-do by leverage ÷
effort ÷ risk, the top five are: **① the cross-cutting micro-primitives** (getErrorMessage,
coercion, staleness math — hundreds of sites, near-zero risk), **② the auth/decision
spine** (highest *correctness* risk — "can this actor do X" answered by parallel
engines that drift), **③ the integration/adapter substrate** (`@dpf/integration-shared`
already exists, just unadopted), **④ finish the MCP tool-pack + one-validation-source
migration**, and **⑤ the datastore hybridization** (retire two heavy services fleet-wide).

**This is a standing discipline, not a project.** §6 defines the repeatable mining
engine + the per-consolidation ratchet so duplication cannot regrow — exactly how the
dependency gates already work.

---

## 1. The thesis in DPF's own terms

Vertical integration inward = **own more of the stack, depend on fewer outside parts,
and build each shape once.** The moves, as a closed vocabulary:

| Type | Name | Move | Manufacturing analogy |
|------|------|------|----------------------|
| **T1** | Internalize (vendor) | Replace/vendor an external dep with owned code | Bring a bought part in-house |
| **T2** | Dedup | Collapse N implementations of one function to 1 | Standardize a part across product lines |
| **T3** | Hybridize | Merge two overlapping subsystems into one | Combine two adjacent process stages |
| **T4** | Extract primitive | Pull inline-everywhere logic into a shared module | Create a common component/jig |
| **T5** | Collapse surface | Fewer flags / tools / routes / services | Reduce SKU proliferation |
| **T6** | Retire | Remove dead/superseded external or internal code | Decommission an idle line |
| **T7** | Portfolio-generalize | Portfolio/archetype-specific fork → one parametrized path | One flexible line serves all 4 portfolios |

Every backlog item carries `type · evidence(file:line) · current_state · proposal ·
effort(S/M/L) · leverage(H/M/L) · risk`.

## 2. What already exists — extend, do not reinvent

DPF has partially operationalized the *external-dependency* half of the thesis. The
plan builds ON this; the gap it fills is the **internal assembled-functionality** half.

- **Rent-not-own doctrine** — `docs/architecture/dependency-reduction-routine.md`;
  order = eliminate → dedupe → replace-with-native → own → keep. `KEEP_EXTERNAL`
  auto-excludes framework/native/security-sensitive deps. **Respected throughout.**
- **New Dependency Gate** + `sbom/dependency-allowlist.json`; **internalization
  shortlister** (`pnpm candidates`); **SBOM drift + OSV scan**; **Tool Evaluation
  Pipeline** (EP-GOVERN-002) + `approved_tools_registry.json`.
- **UI**: `components/ui/report-kit/` (badge/table/KPI/chart/statusColors),
  `CollapsibleList`, `PhoneInput`/`EmailInput`, `LocalTime`; the `<table>` ratchet.
- **Data model**: `Organization` canonical identity; `PrincipalAlias`→`Principal`
  convergence; one `Organization.address` shape + helpers.
- **Plumbing precedents already shipped but under-adopted**: `actions/shared/guards.ts`
  (`requireCapability`/`withCapability`), the `lib/api/` route toolkit,
  `mcp/tool-registry.ts` `composeToolPacks` (13 packs), `routing/adapter-registry.ts`,
  `@dpf/integration-shared`, `@dpf/validators` (13 zod modules).

**The recurring finding: the right primitive frequently already exists and is simply
not adopted.** Much of this plan is *migration to blessed primitives*, not green-field.

## 3. Current-state map (grounded)

- **Code**: 9,314 TS/TSX files · 114 `lib/` domains · 24M · 41 component dirs. Biggest
  domains: `actions/` (2.9M, 267 files, 150 `"use server"`), `integrate/` (2.5M),
  `tak/` (1.6M), `routing/` (1.5M).
- **Schema**: `schema.prisma` 12,124 lines · ~410 models · **4 enums** · 173 `status`
  strings · 386 Json columns.
- **MCP surface**: `mcp-tools.ts` 16,526 lines / 792KB · `PLATFORM_TOOLS` + a 234-case
  `executeTool` switch · **239 tools** (AGENTS.md: selection collapses past ~15).
- **Docker**: postgres, neo4j:5-community(+apoc), qdrant, redis, portal/sandbox/promoter,
  browser-use, adp, prometheus/grafana/loki/alloy/cadvisor/4 exporters, inngest,
  dpf-stt, dpf-tts, integration-test-harness.
- **External MCP fleet**: ~20 connector servers (hubspot/slack/notion/bigquery/apollo/…),
  several duplicating in-portal `integrate/*` clients.
- **4 portfolios**: Foundational · Manufacturing & Delivery · For Employees ·
  Products & Services Sold — the axis for every T7.

---

## 4. The 14 structural bets (the spine)

Each bet is a spine re-implemented N times. `Σleaf` = grounded count of leaf change
sites. Bets are the epics; leaf items are the BIs.

### BET-1 · The Work-Unit spine  · T3/T7 · effort L · leverage H
Seven work models each re-encode status + claim + activity-timeline and cross-FK each
other: `BacklogItem`, `Epic`, `WorkCapsule`, `FeatureBuild`, `TaskRun`, `WorkItem`,
`WorkEngagement` (schema 1219/1446/1295/5010/5659/10142/1114); plus 3 "engagement"
tables (`CoworkerEngagement`, `WorkEngagement`, `Engagement`) and `FinanceWorkItem`.
Above it: **portal vs workspace case-loaders** are the same ~370-line harness twice
(`portal-case-loader.ts` ≡ `workspace-case-loader.ts`), **claim block copy-pasted**
across 3 models, **`*Activity` event tables ×6** (two byte-identical), and **three
build orchestrators** with distinct phase vocabularies (`build-orchestrator.ts` /
`build-pipeline.ts` / durable `build-execute.ts`). **Move:** one `WorkUnit` spine +
typed role tables + a shared claim/ownership value group + one polymorphic
`ActivityEvent`; land behind a compatibility view, staged fleet-safe migrations.
`Σleaf ≈ 40` (7 models + 6 activity tables + 2 loaders + 3 orchestrators + claim sites).
**Highest-traffic tables — sequence last among the big bets, but its read-model half
(BET-10) can start now.**

### BET-2 · The Authorization / Decision spine · T3 · effort L · leverage H · **highest correctness risk**
"Can this actor do X / should this decision proceed" is answered by parallel engines
that can silently drift:
- **Two decision-scoring engines that never compose**: `option-scoring.decide()` (ranks
  options, used only by the *un-ledgered* `principle_decide` MCP call at
  `mcp-tools.ts:13073`) vs `evaluateDecisionPerspective` (`decision-perspective/evaluator.ts:119`
  bands *material coverage*, used by both gates but merely echoes options). The
  `principle-decide.ts` shim's "share ONE inner engine" claim is nominal.
- **Two near-identical gates**: `build-studio-gate.ts` vs `org-business-gate.ts`
  (~70% identical; the latter's own comment: "It mirrors…"). **WSID has no gate.**
- **Two authorization engines**: LIVE `govern/governance-resolver.ts` (baseline ∩ grant)
  vs the richer-but-unwired `authority/effective-authority.ts` + `AuthorityBinding`
  (subjects/approvalMode/sensitivityCeiling) that only feeds a display panel + one
  promotion check.
- **Three `requireCapability` surfaces** (`api/auth-middleware.ts:135` array-includes /
  `actions/shared/guards.ts:28` `can()` / `tak/agent-grants.ts` grant-check), **three
  grant-satisfaction resolvers**, **four autonomy ladders** (`autonomy-envelope`,
  `remediation-authority`, `catalog`, `accountability`), and **risk/autonomy/approval
  answered 3×** (`risk-posture` envelope / perspective evaluator / governed-action
  resolver — never shared).
- **whether-approval vs who-approves** have no spine (`govern/approval-authority.ts`
  resolves WHO, disconnected from the WHETHER gate).
**Move:** one `EffectivePermission` resolver as the single entry point; fuse the two
scoring halves (gate calls `decide()` over resolved materials); collapse the two gates
into `evaluatePerspectiveGate({resolver})` parametrized by WWMD/WWWD/WSID; feed the
risk envelope into the resolver; chain who-approves onto the require_approval verdict;
route `AuthorityBinding` into enforcement (or retire it). `Σleaf ≈ 25`.
**Do early despite L effort — this is where drift is a security bug, not just noise.**

### BET-3 · The Integration / Adapter substrate · T2/T4 · effort M · leverage H · **best leverage/risk**
The densest duplication in the codebase, and the consolidation home **already exists
and is blessed** (`@dpf/integration-shared`), adopted only by the ADP sidecar:
- **5 clone OAuth token-clients** (`integrate/{quickbooks,google-marketing,microsoft365,adp}/token-client.ts` + `services/adp/…`, 631 LOC, identical RFC-6749 refresh grant).
- **16 bespoke `*ApiError`/`*AuthError`** classes (HubSpot/Stripe/Mailchimp/QuickBooks/…).
- **~20 hand-rolled undici clients** (`integrate/*/client.ts` + `services/edge-node`).
- **12 clone `connect-action.ts`** OAuth-connect flows.
- **credential-crypto implemented twice** (`govern/credential-crypto` vs
  `integration-shared/credential-crypto` — two AES-256-GCM impls of one scheme).
- **6 adapter+registry reinventions** (`marketing/channels/registry`, `workbooks/adapter`,
  `gear-interface/source-adapters`, `brand/extraction`, `routing/adapter-registry`,
  `mdm/domain-registry`) + **TTS synthesis + marketing scheduling live outside the
  canonical registries** they belong in.
**Move:** extract `refreshOAuthToken` / `integrationRequest` / one `IntegrationApiError`
/ `connectProviderAction(config)` / `createAdapterRegistry<T>()` into
`@dpf/integration-shared`; migrate the ~20 vendors + marketing channels onto it; make
`integration-shared` the single credential-crypto. `Σleaf ≈ 60`.
**Migration not invention; target home + tests already exist — start now.**

### BET-4 · The MCP tool surface + one-validation-source · T5/T1 · effort L · leverage H
`mcp-tools.ts` is a 16,526-line / 792KB file — the largest single artifact and worst
cross-session merge hazard — yet `composeToolPacks` + 13 packs prove the target shape.
234 inline `executeTool` cases; **212 `String(params[…])` + 278 `typeof params[…]`**
hand-coercions; **233 hand-written JSON-Schemas, zero zod**; 385 `success:false` /
273 `success:true` inline envelopes; **38 `list_*`/`query_*`/`get_*`** sibling tools
inflating the surface past AGENTS.md's ~15 ceiling. Input contracts are authored
**three times** (MCP schema / ~90 action guards / 113 route `req.json()`), while
`@dpf/validators` (13 zod modules) sits at 36 imports. **Move:** drain the switch into
packs domain-by-domain behind the registry; parse `rawParams` against `inputSchema`
once; define each contract once in `@dpf/validators`, derive JSON-Schema for MCP and
reuse for action/route parsing; merge sibling read tools into `query_<domain>({resource,id?,filter?})`;
add `toolOk/toolErr`. `Σleaf ≈ 40` packs/tools + hundreds of coercion sites.

### BET-5 · Datastore hybridization: Neo4j + Qdrant → Postgres · T3 · effort L · leverage H
Both auxiliary stores are **non-authoritative projections** of Postgres truth:
`packages/db/src/neo4j.ts:3` ("never authoritative… a projection for traversal and
impact analysis only"); `qdrant.ts` = thin 4-collection 768-dim REST store; embeddings
already local (`inference/embedding.ts`, nomic 768-d); `wiki/ppr.ts` already prefers
Postgres-native ("No graph DB, no extra dependency"); `tsvector`+GIN already in use.
**Move:** Neo4j → `WITH RECURSIVE` CTEs / `ltree` (or Apache AGE); Qdrant → `pgvector`
+ HNSW. Removes **2 heavy always-on containers + their dev twins + 2 backup/restore
subsystems + 2 npm drivers + all NEO4J_*/QDRANT_* env + preflight tiles**. Benchmark
code-graph/EA traversal perf and A/B recall first. `Σleaf ≈ 15` (drivers, backup/restore
runners, compose services, callers). Blast radius: 119 neo4j-referencing files.

### BET-6 · Cross-cutting micro-primitives · T4 · effort S · leverage H · **do first**
The cheapest, highest-count, near-zero-risk wins — pure extraction, hundreds of sites:
- **`getErrorMessage(err)`** — `err instanceof Error ? err.message : String(err)`
  **×313 across 188 files**, no helper exists.
- **JSON coercion set** `isRecord/stringOr/numberOr` copied ≥6× (build) + no
  `asString/asNumber` in `shared/` (plumbing).
- **Staleness math** `now−ts>threshold` ×3+ (`isStale`), **liveness-state literal**
  `["working","active"]` in 5+ files (`TASK_LIVE_STATES`), **`isSignalStale`** ×2.
- **`parseFencedJson<T>`** (LLM fenced-JSON unwrap) ×2, **`stableKey(parts[])`**
  (2 hashing dialects across finding-key/component-key/cyclonedx), **repo-path regex**
  ×4, **`SANDBOX_CONTAINER_ID` fallback** ×8, **`/workspace` const** ×3,
  **probe-timeout const** ×4, **`PROMETHEUS_URL` default** ×3.
- **`ActionResult<T>` envelope** (708 inline `{ok}` objects, 2 type defs),
  **`newId(prefix)`** (prefixed-id gen inline everywhere), **`ROUTES` const map**
  (120 `revalidatePath` magic strings, `"/compliance"` ×47).
`Σleaf ≈ 1,000+` occurrence sites across ~20 primitives. **Start here for momentum.**

### BET-7 · The UI primitive plane · T2/T4 · effort M · leverage H
report-kit exists but adoption is thin: **85 hand-rolled `<table>`s vs 12 on DataTable**
(25 in finance alone, one shared idiom → codem-able), **39 inline status→color maps +
11 bespoke `*Badge`** (retire the color logic under thin domain wrappers; template
exists: `ChangeLaneStatusBadge`), **18 custom `fixed inset-0` modals** → `ui/Dialog`
(+ a `EntityFormDialog` for the 5-clone customer "New…" family), **13 hardcoded-hex
escapes**, **~25 inline filter clusters vs 8 on FilterBar**, **43 client raw-fetch +
19 hand-rolled useEffect loaders** (no shared fetcher/SWR). **4 missing feedback
primitives**: `EmptyState` (43 sites), `Skeleton` (21+), `Notice/Callout` (25),
`KpiCard` (~50 inline vs 20 on StatCard). **Move:** DataTable adoption drive (codemod
finance first) + unify the badge/status plane + extract the four primitives + one
`apiFetch`/`useApiData` hook; enforce with a lint/ratchet. `Σleaf ≈ 320`.

### BET-8 · The Model-Routing / Dispatch spine · T2/T6 · effort M/L · leverage H
**4–5 coexisting generations** of one loop: `routing/pipeline.ts` (v1, dead),
`pipeline-v2.ts` (live), `task-router.ts` (orphaned EP-INF-012), `tak/agent-router.ts`
(live coworker path), + legacy `inference/ai-provider-priority.callWithFailover` (still
reached by brand-extraction + coding-agent despite being "replaced"), + fully-dead
`routing/task-dispatcher.ts`. **Route→sensitivity triplicated** across 3 prefix tables
(security-relevant drift). **Three model-tier vocabularies** (`QualityTier` /
`CapabilityTier` / `costTier`). Plus **4 byte-duplicated engine dispatchers**
(`claude/codex/grok/opencode-dispatch.ts`, incl. a missing-audit bug in claude) + **3
engine selectors** + an 8-field flat config (BET-3-adjacent). **Move:** migrate the 3
stragglers + brand/coding onto `routeAndCall`, delete the 2 dead paths; make
`route-context-map` the single sensitivity source; canonicalize `QualityTier`; extract
`runEngineDispatch` + route all callers through `getBuildAgentRunner`. `Σleaf ≈ 55`.

### BET-9 · The Financial-document family + canonical Money · T3/T4 · effort L · leverage H
**5 line-item tables** (`Quote/Invoice/Bill/PurchaseOrder/Expense` LineItem) + **5
header spines** (Quote/Invoice/Bill/PO/SalesOrder) encode one document shape;
`accountCode` is an unvalidated string shadowing `LedgerAccount` on 5 models;
`StorefrontOrder.items` is untyped Json. **Money encoded 4 ways** (bare `Decimal`,
`Decimal(14,2)`, `Int`-cents, `Float`); `currency @default("GBP")` copy-pasted 23×
while `OrgSettings.baseCurrency` is the real source; `erpSyncStatus/erpRefId` pair +
polymorphic `sourceType/sourceId` copied per model. Plus **two orders** (`SalesOrder`
vs `StorefrontOrder`) and **two reservation lifecycles** (`StorefrontBooking` vs
`RentalAgreement` — schema calls the latter "the rental analog"). **Move:** canonical
`Money` convention first (de-risks every finance migration), then a shared
`DocumentLineItem` + financial-document spine, FK `accountCode`→`LedgerAccount`, one
Order archetype + one time-slot-reservation base. `Σleaf ≈ 50`.

### BET-10 · The live Health / Run read-model · T4/T5 · effort L · leverage H
TaskRun is re-queried and re-projected across `ai-operations-map` (4 projectors, twin
windows with identical selects), `observability` (stall/watchdog/heartbeat),
`operate` (quiescence, inert-build-reaper), `workspace/command-center`, and
`attention/sources` — each with its own select, status classifier, and liveness
literal. **4+ health aggregators** with no single "is the platform healthy" surface;
**4 staleness reapers** on one heartbeat; **`now−ts>threshold`** re-implemented; **5
hand-rolled status→state classifiers**; endpoint `provider:model` split ×3;
coworker-node dedup ×3; `titleize`/`normalizeAgentId` copied per projector. **Move:**
one `OperationsRunReadModel` + `taskrun-liveness` query layer + `TASK_LIVE_STATES`
(BET-6) + one parameterized reaper framework + one health aggregator. `Σleaf ≈ 40`.
**The read-model half of BET-1 — start it now; it needs no schema migration.**

### BET-11 · The Backup / Restore / Scheduling substrate · T4/T5 · effort M · leverage H · **cleanest large win**
**6 near-identical runners** (postgres/neo4j/qdrant × backup/restore, ~1,900 lines,
85–90% shared: `isoTsForDirectory`/`nextDailyRunAt`/`applyRetention`/`summarizeFailure`),
**12 near-identical Prometheus metric families**, **5 next-run/cron engines** (3 hardcoded
HH:00), **4 job registries** kept in sync by comments + parity tests, **ScheduledJob
heartbeat update copy-pasted** across every runner, **`platformConfigSingleton`
boilerplate** (read/parse/upsert) in ≥5 modules, and **`createGatedCron`** would
de-boilerplate ~33 Inngest functions. **Move:** `runManagedBackup`/`runManagedRestore`
+ 3 engine specs + one metric family with an `engine` label + `recordJobHeartbeat` +
one `nextRunAt(schedule)` + a shared `@dpf/scheduled-jobs` registry + `createGatedCron`
+ typed `platformConfigSingleton<T>`. `Σleaf ≈ 90`. **Lowest semantic risk of the big
bets — `reconcile-stuck-runs.ts` already proves engine-agnostic lifecycle.**

### BET-12 · The Governance findings / evidence plane · T3/T7 · effort M · leverage M
Four "finding" streams never meet: `WikiLintFinding` (`wiki/lint.ts`),
`ReviewFinding` (derived from `DecisionInteraction`), assurance findings
(`finding-persistence`), and SOC cases (`security/`). **`ComplianceEvidence` is emitted
only from security** — assurance/SBOM never feed GRC. **Intake/remediation rail wired
for assurance not security** (SOC cases never convert to BI). **Coverage-gap detected
twice** (`wiki/coverage-gap` recall-miss vs `decision-review-findings` cluster). Plus
`DeliberationRun` outcomes invisible to Decision Review (two audit trails). Assurance
run-ledger duplicated (scan vs bom), 4 bespoke keyed-upsert loops, 5+ severity
ladders. **Move:** one `GovernanceFinding` presentational contract + one keyed-upsert
helper + `withAssuranceRun` wrapper + generalize case→evidence + route all detectors
through the `ingestBacklogItem` front door + one severity module. `Σleaf ≈ 45`.

### BET-13 · Identity & vocabulary convergence · T2/T3/T7 · effort L · leverage H
Direct enforcement of DPF's post-2026-05-09 canonical-identity rules across the 4
portfolios: **`SocialIdentity` is a `PrincipalAlias` on the wrong parent**;
**`CustomerContact`/`EmployeeProfile`/`ServiceProvider`** are parallel person
identities; **guest-contact blocks duplicated across 5 storefront-commerce tables**;
**3 models store addresses as Json** bypassing canonical `Address`;
**`Organization` vs `CustomerAccount`** two "company" models. Vocabulary: **archetype
vocabulary defined ≥3 places and already drifting** (`archetype-vocabulary.ts` map vs
`INDUSTRY_OPTIONS` vs `StorefrontArchetype.customVocabulary` Json — some installs
silently fall back to defaults); `StorefrontArchetype` is a 6-Json-column bag;
**finance-templates(14) + storefront-templates(19)** keyed by the same archetype but
bridged by a hand-coded map (`finance/setup-profile.ts`). **Move:** fold identity onto
`Principal`/`Address` behind resolver views; make one archetype registry the shared
spine for all vertical templates + setup resolvers + vocabulary. `Σleaf ≈ 45`.
**Unblocks BET-9's two-orders/two-reservations merges (they can't reconcile customer
identity until identity roots converge).**

### BET-14 · External-surface rationalization (deps · engines · MCP · services · skills) · T1/T5/T6 · effort mixed · leverage M
The long tail on the external half, each item respecting rent-not-own:
- **Own-candidates (WWMD-gated each)**: `nanoid`, `dotenv`→Node `--env-file`,
  `prom-client` (unlocks exporter retirement), `picomatch`.
- **Dedup dep clusters**: calendar (5 `@fullcalendar/*` + `react-day-picker`),
  graph-layout (`dagre`+`elkjs`+`@xyflow`+3 hand-rolled), 6-lib parse-zoo → one
  `parseDocument()` façade, dual pg drivers (`postgres` vs `pg`), `undici`→native
  fetch audit, `gray-matter`/js-yaml retirement (sheds the only OSV finding),
  `pino`→platform logging, TS version split (BI-6C620C7A).
- **Coding engines**: right-size the 4-engine sandbox fleet behind a build ARG (only
  opencode vetted; grok binary 137MB); backfill tool-eval records for grok/codex/claude.
- **MCP fleet**: route the ~20 external connectors through DPF's governed `/api/mcp/v1`
  front door (several duplicate `integrate/*`); dedup the 3 per-engine skill-pack MCP
  configs from one source.
- **Services**: gate the headless observability trio (Prometheus/Loki/Alloy) behind a
  profile like Grafana already is; retire the 2 sidecar exporters into portal `/metrics`;
  fold ADP sidecar into the in-portal integration substrate; assess Playwright retirement
  (browser-use "replaces" it but `playwright-runner.ts` remains).
- **Skills/config**: dedup DPF-native vs Anthropic skill corpora; reconcile 2 skill
  formats (`.skill.md` vs SKILL.md dirs) onto the DB-backed loader; generate engine
  installs from one recipe registry (Dockerfile vs build-engines.json vs provisioning);
  unify the 2 SBOM/OSV engines (script vs in-platform, BI-96DFDC7D).
`Σleaf ≈ 45`.

---

## 5. Execution ranking (leverage ÷ effort ÷ risk)

| Wave | Bets | Why this order |
|------|------|----------------|
| **Wave 0 — momentum** | BET-6 (micro-primitives), the "already-blessed adoption" leaves of BET-3/4/7 (guards, integration-shared, DataTable-finance, tool-packs one domain) | S-effort, near-zero risk, 1,000+ sites; establishes the ratchets |
| **Wave 1 — correctness** | BET-2 (auth/decision spine), BET-8 (routing generations), BET-10 (run read-model), E1 terminal-phase disagreement | Where drift is a *bug*, not noise; read-models unblock later schema work |
| **Wave 2 — substrate** | BET-3 (integration), BET-4 (validation/tools), BET-11 (backup/scheduling), BET-12 (findings) | M-effort structural collapses on blessed homes |
| **Wave 3 — heavy** | BET-5 (datastore hybridization), BET-13 (identity/vocab), BET-9 (finance/money), BET-1 (work-unit spine) | L-effort, migration-bearing, fleet-safety-critical; sequence behind their read-models |
| **Continuous** | BET-14 leaves | Fold into the monthly SBOM-reduction judgment already running |

**Each bet is gated per kernel (WWMD):** the internalize/hybridize/retire decisions
(BET-5, BET-14 own-candidates, BET-1/9/13 model merges) run through `principle_decide`
(operational_independence + vendor_lock_in vs long_term_maintainability + blast_radius)
before code — the machinery already exists.

## 6. The repeatable engine (so it cannot regrow)

This is a **standing discipline**, mirroring the dependency gates:
1. **Mine** — the 8-way grounded fan-out in this session is re-runnable as a scheduled
   sweep; each item cites `file:line`, no fabrication.
2. **Rank** — leverage ÷ effort ÷ risk; cluster leaves under bets.
3. **Gate** — per-bet `principle_decide` for internalize/hybridize/retire.
4. **Ratchet** — **every** consolidation ships a guard so the duplication cannot
   regrow. Templates already in-repo: the report-kit `<table>` ratchet, the New
   Dependency Gate, the SBOM Divergence Guard, `check-mobile-jest-pin`. New ratchets
   this plan implies: ban raw `err.message` ternary (→ `getErrorMessage`), ban local
   `Record<string,color>` status maps (→ `resolveIntent`), ban new `requireAuth`
   variants (→ `shared/guards`), cap the MCP tool count, ban new `status String`
   without a registered catalog, ban raw `NextResponse.json({error})`.
5. **Account** — `log()` what a wave did NOT cover; silent truncation reads as "done."

## 7. Count accounting — where "the thousands" are

Honest framing: **~460 named opportunities** (the mining tables) decompose to
**~2,000–3,000 leaf change sites** because a single named opportunity often IS a
count: getErrorMessage = 313 sites, `<table>` = 85, `requireX` = 90, JSON-Schema→zod =
233, `String(params)` coercions = 212+278, status-string typing = 173, Json typing =
386, currency defaults = 23, connect-actions = 12, backup metric families = 12, and so
on. The register is the ~460; the BI count when leaves are filed individually is in the
low thousands. **Quality caveat:** the value is in the ~14 spines, not the raw count —
file leaves in batches under their bet, not as 313 separate getErrorMessage BIs.

## 8. Deliverables & status — FILED

**Filed 2026-07-07** (kernel-gated via `principle_decide` → operator-confirmed at low
confidence, margin 0.191): epic **EP-8DC217EB** "Vertical Integration Inward" +
18 child BIs.

| BI | Bet | Effort · Priority |
|----|-----|-------------------|
| BI-6A505BFF | BET-6 micro-primitives | medium · p1 |
| BI-F4156099 | BET-2 auth/decision spine | large · p2 |
| BI-0C4486A5 | BET-8 routing/dispatch spine | large · p2 |
| BI-B6157FB7 | BET-10 live run read-model | large · p2 |
| BI-ABC88965 | BET-3 integration/adapter substrate | large · p3 |
| BI-2B7EE073 | BET-4 MCP tool-pack + one-validation-source | large · p3 |
| BI-6182950F | BET-7 UI plane | large · p3 |
| BI-B72328D5 | BET-11 backup/scheduling substrate | large · p3 |
| BI-7CD647B0 | BET-12 findings/evidence plane | medium · p4 |
| BI-C0CEB377 | BET-14 external-surface long-tail | medium · p4 |
| BI-9D4A5D22 | BET-9 finance-docs + Money | xlarge · p4 |
| BI-75B31594 | BET-13 identity/vocab convergence | xlarge · p4 |
| BI-B6DD63A4 | BET-1 WorkUnit spine | xlarge · p5 |
| BI-A1E864A5 | BET-5 Neo4j+Qdrant→Postgres | xlarge · p5 |
| **Wave-0 leaves (p1, start now):** | | |
| BI-B4EF08FA | getErrorMessage helper + codemod (313 sites) | small · p1 |
| BI-991D4DC8 | requireAuth variants → shared/guards | medium · p1 |
| BI-C5EEC0B1 | DataTable codemod (25 finance pages) | medium · p1 |
| BI-81EE4A46 | anti-regrowth ratchet guards | medium · p1 |

Each bet decomposes to its leaf items (§4 `Σleaf`) when its wave starts — file those
per-bet, in batches, not as hundreds of loose BIs (§7).

**Open kernel decisions to route before the heavy waves (Wave 3):** BET-5 (own the two
datastores?), BET-1/9/13 (spine-merge sequencing + fleet-safe migration shape),
BET-14 own-candidates — each through `principle_decide`
(operational_independence + vendor_lock_in vs long_term_maintainability + blast_radius).

---

## 9. The Self-Optimization Engine — the priority next move (enablement-first)

**Kernel-gated (`principle_decide`, HIGH confidence, composite 9.10, margin 0.30):
wire the connective tissue and visibility layer BEFORE mass-dispatch.** DPF already
owns the substrate to run this optimization *itself* — and doing so also exercises
capabilities the sweep found under-used (76/88 coworkers never run; WSID has no gate;
the EA parity baseline is static). The move is to make vertical-integration the first
workload of a **coworker-driven, WSID-guided, architecture-projection-visible loop**,
rather than something Claude mines and files by hand.

**The three assets, proven live:**
- **Architecture / structure projections** — the *analysis + visibility* layer.
  Code graph is ready (`get_code_graph_freshness`: 4,406 files, 11,368 imports, 498
  routes, 242 tools, 1,759 test links); `trace_code_surface` gives real per-bet blast
  radius (replacing grep estimates); `data-architecture-steward` + `data-model-mirror`
  render the schema forks (7 work models, 5 line-item tables, identity forks) on the
  ERD; `architecture-parity-steward` + its baseline is the drift ratchet; the
  business-capability map gives leadership coverage; `describe_ea_view` lets coworkers
  critique a view.
- **AI coworkers** — the *execution* layer. `request_coworker` / `summon_coworker`
  hand a scoped bet to a *named* peer; `create_scheduled_agent_task` runs the standing
  sweep; Build Studio builds it; `submit_coworker_capability_need` captures gaps.
- **WSID profession techniques** — the *competence* layer. `resolve-profession-profile`
  binds profiles (`wsid-data-architect` → `build-data-architect`, `wsid-strategy-executive`,
  …) to coworkers, so each bet is worked by the right profession — and the missing WSID
  decision gate (a BET-2 finding) gets closed here.

**BET-0 · Self-Optimization Engine (gates the delivery waves) — FILED under EP-8DC217EB:**

| BI | Slice | Effort · Priority |
|----|-------|-------------------|
| BI-D9B58004 | 0a · Optimization cockpit — project 14 bets onto code-graph blast radius + ERD + capability map | large · p1 |
| BI-ED9AC5A6 | 0b · Register consolidations as architecture-parity targets (progress ratchet) | medium · p1 |
| BI-9900B365 | 0c · Assign WSID profiles to refactor coworkers + close the WSID-gate gap | medium · p1 |
| BI-C350F8B0 | 0d · Dispatch harness — route each bet to its WSID coworker via Build Studio | medium · p2 |
| BI-F95222FA | 0e · Scheduled self-optimization sweep (create_scheduled_agent_task = §6 standing discipline) | small · p2 |
| BI-5C01F920 | 0f · WSID feedback loop — completed bets enrich the profession corpus | small · p3 |

**The loop:** projections make the work *visible and right-sized* → WSID-profiled
coworkers *build* it via Build Studio → parity-steward *measures* the drift-reduction →
gaps become *capability-needs + WSID enrichment* → the scheduled sweep finds the next
round. Vertical integration stops being a Claude task and becomes a **platform
capability** — which is the thesis, applied to the optimization itself.

**Bet → WSID profession (0c mapping):** BET-1/9/13 (data/schema) → `wsid-data-architect`;
BET-2/4/8/10 (governance/routing/tools/observability) → enterprise/platform-architect;
BET-3/6/7/11 (integration/primitives/UI/substrate) → refactoring/UI engineer;
BET-5/14 (datastore/deps, WWMD-gated) → enterprise-architect + strategy-executive;
BET-12 (findings/evidence) → assurance/security profile.

## 10. Cross-epic coordination — EP-CLAUDE-INSIDE-OUT

A parallel thread works **EP-CLAUDE-INSIDE-OUT** (agent-harness mechanics → new
governed platform primitives). Where its *new primitive* is the same target as one of
this epic's *consolidations*, they are **one effort**: the Inside-Out primitive is the
**canonical home**, and the Vertical-Integration bet is its **migrate-the-duplicates-onto-it
follow-on** — never build both (kernel-gated `dependency_link`, HIGH confidence 8.64,
margin 1.53). Strong overlaps: BET-2 → approval-chain/durable-grants/hook-plane
(BI-55D2A0E5/BI-4FA040D5/BI-69B614C6); BET-8/11/0d → workflow/fan-out primitives
(BI-8E07CCA5/BI-D80D16C4/BI-E63B8293); BET-1/13 → unified CI identity graph
(BI-B459B303). The 9 overlapping bets carry a cross-epic dependency note; the full
map + file-collision hot-zones (schema, `tak/`, `govern/`, `routing/`, `queue/` — claim
before working, one schema migration author) is in
`docs/superpowers/plans/2026-07-08-cross-epic-coordination-vertint-vs-insideout.md`.

### Appendix — grounded evidence
Every bet above is backed by the 8-miner fan-out with `file:line` citations (external
surface, UI, AI-routing, decide-surfaces, govern, tool-dispatch/authority, verticals,
data-model, ops, build-pipeline). Raw miner tables are preserved in the session
transcript and can be exported to `docs/superpowers/audits/` on request.
