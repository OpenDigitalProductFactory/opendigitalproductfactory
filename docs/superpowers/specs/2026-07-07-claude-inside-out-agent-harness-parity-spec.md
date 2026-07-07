# Claude Inside-Out — Agent-Harness Parity as DPF Platform Primitives

**Date:** 2026-07-07
**Status:** Research / gap analysis (kernel-ratified altitude: research + spec + epic + seeded BIs, no implementation — ledger `DI-D919355DF1AE`)
**Operator goal:** "Turn Claude inside out within DPF" — replicate the basic premise and mechanics of a Claude-style coding agent (skills, MCP, marketplaces, memory management, loops, management surfaces) as first-class DPF platform primitives, available to every DPF coworker and to humans, not just to external CLI agents pointed at the repo.
**Strategic frame:** Ross Haleliuk's thesis that AI either kills ServiceNow or makes it dramatically stronger (50/50). ServiceNow's moats: central position in enterprise ops, "everything is a workflow," context-rich acquisitions (Armis, Veza), 98% renewal, 85% F500. Its weakness: not architected for AI agents — "a lot of rearchitecting needs to happen." DPF's wedge: written from scratch *by* agents *for* agents and people, targeting small companies first, no legacy rearchitecting debt.

---

## 1. The premise being inverted

Today the most capable agent runtime in the DPF ecosystem is the *external* harness (Claude Code, and partially Codex/Grok) pointed *at* the platform: it has skills, hooks, subagents, persistent memory, MCP client+server, scheduled loops, marketplaces, permission planes, context management. DPF coworkers — the agents the platform itself runs — have a subset. "Turning Claude inside out" means the platform itself becomes the harness: every mechanic that makes the external agent effective becomes a governed, multi-tenant, UI-manageable DPF primitive.

This is also the ServiceNow answer: ServiceNow is a platform-of-record with a workflow engine bolted to forms. An agent-native platform-of-record is a *harness* with a system-of-record underneath — where workflows, catalog items, approvals, and knowledge are all things agents read, write, and execute natively.

## 2. Reference taxonomy — the mechanics of the Claude harness

The canonical inventory of what the external harness does, used as the comparison axis throughout. Eighteen mechanics in six groups:

### A. Instruction & knowledge plane
1. **Layered instruction hierarchy** — system prompt → org policy → project instructions (AGENTS.md/CLAUDE.md) → session goal → inline reminders. Deterministic precedence; the agent always knows which layer wins.
2. **Skills (progressive disclosure)** — named, versioned procedure packs with trigger descriptions; loaded on demand, not resident in context; user-invocable (slash) or model-invoked; scopeable to a directory/domain.
3. **Persistent memory** — per-project memory files with an index loaded every session; typed entries (user / feedback / project / reference); dedup + linking discipline; auto-recall.

### B. Tool plane
4. **MCP client** — attach arbitrary external tool servers, with auth flows, per-server instructions, and a registry/directory of connectors.
5. **MCP server** — expose own capabilities as tools to other agents.
6. **Deferred tool loading (tool search)** — thousands of tools available, schemas loaded on demand; keeps context lean while keeping the whole surface reachable.
7. **Permission planes** — allowlists/denylists per tool+argument pattern, permission modes, sandboxing, ask-the-human escalation as a typed primitive.

### C. Orchestration plane
8. **Subagents** — spawn typed agents (model/effort/tool overrides), background execution, continuation by reference, isolated worktrees.
9. **Deterministic workflows** — scripted fan-out/pipeline orchestration of many agents with schemas, budgets, resumability.
10. **Loops & scheduling** — recurring self-paced loops, cron-scheduled cloud runs, wakeup scheduling with cost-aware pacing.
11. **Goals / stop conditions** — a goal registered as a stop-hook: the agent cannot declare done until the condition holds.

### D. Guardrail plane
12. **Hooks** — lifecycle interception (session start, pre/post tool-use, stop) that can inject context, warn, or hard-deny; the mechanism guards, gates, and ratchets are built from.
13. **Context management** — compaction/summarization at window pressure, cache-aware pacing, scratchpads, persisted oversized outputs.

### E. Distribution plane
14. **Plugins & marketplaces** — bundles of skills+hooks+MCP servers+agents installable from a marketplace; versioned, updatable, org-distributable.
15. **Model routing** — per-task model/effort selection with floors (frontier requirements) and fast-mode variants.

### F. Experience plane
16. **Sessions** — resumable, searchable, forkable transcripts; cross-session messaging; chapters.
17. **Tasks & progress surfaces** — typed task lists, background-task chips, spawn-task suggestions surfaced to the human.
18. **Deliverable surfaces** — artifacts (hosted pages), file sending, inline widgets/visualizations; the agent's output is a product surface, not chat text.

## 3. DPF current-state inventory

*(Filled from codebase inventory — see §4 matrix for the per-mechanic verdicts.)*

### 3.1 Agent-runtime primitives

| # | Concern | Verdict | Anchor substrate | Notes |
|---|---|---|---|---|
| 1 | Agent loop | **EXISTS** (mature) | `apps/web/lib/tak/agentic-loop.ts` (2.4k lines), entry `lib/actions/agent-coworker.ts` | Tool-loop until text-only turn; MAX_ITERATIONS=200, per-task duration caps, repetition detector, fabrication check, deferred `load_tools`. More built-in babysitting than the CC harness. Legacy vs unified path branches on `USE_UNIFIED_COWORKER` (legacy is still install default). |
| 2 | Tool surface & grants | **EXISTS** (mature) | `lib/mcp-governed-execute.ts`, `lib/mcp-tools.ts` (16.5k lines), packs in `lib/mcp/packs/` | Single governed entry (`governedExecuteTool`) for every caller population, capability + grant enforcement + ToolExecution audit. Wart: `HARDCODED_COWORKER_GRANTS` in `packages/db/src/workforce-seed.ts` re-applied every boot — grant writes non-durable. |
| 3 | Model routing | **EXISTS** (strongest primitive) | `lib/inference/routed-inference.ts` (`prepareRoute`), `lib/routing/*` | Learned routing: quality tiers, capability floors (frontier floor, 16K context min), provider health, cost ranking, champion/challenger, fallback chains, Golden-Triangle posture compiled in at the seam. *Exceeds* CC's fixed model-per-agent. |
| 4 | Scheduling/loops | **EXISTS** (ops-fragile) | `ScheduledAgentTask` model, `lib/queue/functions/agent-task-dispatch.ts` (5-min Inngest cron), `lib/operate/scheduled-jobs/coworker-self-tasks.ts` | Proactivity-posture-driven self-tasks (assertive=daily/balanced=weekly/quiet=off); ~60 Inngest functions. Substrate complete; Inngest split-state wedge is the known operational fragility. |
| 5 | Subagent orchestration | **PARTIAL** | `lib/tak/delegation-authority.ts`, A2A tasks `lib/coworker-service-catalog/a2a-tasks.ts`, `TaskRun`, Build Studio engine dispatch | Governed delegation chains (authority propagation, loop detection, depth limits) and A2A lifecycle exist — but there is **no lightweight "spawn N parallel subagents with a prompt" primitive** like CC's Agent/Workflow tools. |
| 6 | Memory | **EXISTS** (differently shaped) | `lib/tak/user-facts.ts`, `lib/tak/governed-memory.ts`, `lib/inference/semantic-memory.ts`, WikiPage corpus + `lib/wiki/recall.ts` | Multi-layer: structured user facts (L1), semantic recall gated by authorization class, WWMD/WWWD corpus, durable AgentThread. Shared + governed rather than CC's per-agent editable memory files; no per-agent memory file. |
| 7 | Context management | **EXISTS** | `lib/tak/context-arbitrator.ts` (L0–L2 budget tiers), `context-pressure.ts`, `compaction-digest.ts`, `tool-result-budget.ts` | Budget arbitration, pressure classification, compaction digest of dropped history, per-model tool-result clamps, context-economy telemetry. |
| 8 | Runtime guards | **EXISTS** (compiled-in, not pluggable) | fabrication guard in `agentic-loop.ts`, advise-mode stripping `lib/actions/coworker-tool-filter.ts`, kernel gate `lib/kernel/runtime-gate.ts`, `DecisionInteraction` audit | Guards are governed and audited but hard-wired — **no user/org-configurable pre/post-tool hook injection point** in the coworker loop (CC's PreToolUse/PostToolUse plane has no in-platform equivalent). |
| 9 | Skills | **PARTIAL** (substrate mature, default path strips) | `lib/skills/runtime.ts` (parses the same SKILL.md format as CC), `SkillDefinition`/`SkillAssignment`/`SkillMetric` models, marketplace/curator/observatory actions | Full lifecycle substrate incl. metrics and curation — but the legacy coworker path (`USE_UNIFIED_COWORKER=false`, install default) hides every skill at runtime. |
| 10 | Marketplaces | **PARTIAL** (internal only) | `DigitalProduct`, for_employees BOM wiring, `lib/actions/skill-marketplace.ts`, MCP catalog `lib/tak/mcp-catalog-sync.ts` | Internal product/skill/MCP-server catalogs exist; **no external plugin/extension marketplace** comparable to CC plugins; distribution today = hive/commons pipeline. |

Structural contrasts worth keeping: DPF trades CC's pluggable hook plane for compiled-in governed guards, per-agent memory files for a shared governed corpus, and a generic spawn tool for audited delegation — deliberate multi-tenant governance choices, not omissions. The true deficits are activation (skills stripped on the default path), orchestration ergonomics, and external distribution.

### 3.2 Extensibility & platform-of-record surfaces

**Extensibility (DPF's strongest ServiceNow differentiator):**

- **MCP server — EXISTS (mature).** JSON-RPC + REST doors (`apps/web/app/api/mcp/v1`, `/call`, `/tools`, `/token`), 13 modular packs + flat registry, `McpApiToken` with scoped/tiered auth incl. ephemeral ship tokens, all through the `governedExecuteTool` choke point with ToolExecution audit.
- **MCP client — EXISTS.** `McpServer`/`McpServerTool` models with health + auth modes, external-registry catalog sync (`McpIntegration`/`McpCatalogSync` + Inngest sync job), `serverSlug__toolName` bridge in `lib/tak/mcp-server-tools.ts`, grants via `AgentToolGrant`. Known wart: grants re-seed from the hardcoded map on boot.
- **Hooks — EXISTS client-side, PARTIAL server-side.** `packages/dpf-skill-pack/hooks/` ships 9 tested guards to Claude/Codex/Grok via a real multi-engine plugin (`.claude-plugin/`, `.codex-plugin/`, `.grok-plugin/` + marketplace.json). Server-side there are governance interceptors (kernel runtime gate reading `WikiPage.principleRuntimeEnforcement`, work-case governance hook) but no user-definable business-rules plane.
- **Behavior-as-content — EXISTS.** WikiPage corpus (pageKind entity/decision/runbook/stance/heuristic/principle, kernel vs org-overlay override chain, principle dimension vectors, ring scope, runtime-enforcement payload) + WWMD/WWWD/WSID perspective substrate + `/wiki` authoring surfaces: business users steer agent behavior without code. DB-native skills (`SkillDefinition` family + admin surfaces) parallel the contributor-side skill pack.
- **Marketplace/catalog — PARTIAL.** DigitalProduct spine + FeaturePack (contribution review, merge readiness) + HiveContributionLedger + storefront family — but no end-to-end "browse → install a packaged capability into another install" store; distribution is hive/PR-based and dev-facing.

**Platform-of-record (ServiceNow-parity core):**

- **Workflow engine — PARTIAL.** 67 code-defined Inngest functions + FeatureBuild phase machine; the only user-authorable automation is `ScheduledAgentTask` (cron + timezone + NL prompt — notably already an *agent-native* Flow-Designer seed). Missing: declarative trigger→condition→step→approval definition over arbitrary records.
- **Ticketing/work — EXISTS breadth, PARTIAL ITSM depth.** BacklogItem (dev), `ServiceTicket` with ticketKind/severity/SLA fields/CI linkage, generic `WorkQueue`/`WorkItem` routing, and a real change family (`ChangeRequest`/`StandardChangeCatalog`/`DeploymentWindow`/`BlackoutPeriod`). Missing: problem management, major-incident flow, incident↔problem↔change linkage.
- **CMDB — EXISTS breadth, PARTIAL unification.** Genuine discovery pipeline (`DiscoveryRun`→`InventoryEntity`/`InventoryRelationship`), EA mirror (`EaElement`/`EaView`/`BusinessCapability`), plus CI-ish records in ~5 families (CustomerConfigurationItem, InventoryEntity, EdgeNode, EaElement, FixedAsset) with no reconciled CI class hierarchy (no CSDM analog). Master-data breadth (CRM/GL/HR/suppliers/tax/MDM) already exceeds ServiceNow out-of-box.
- **Approvals — EXISTS, fragmented.** Kernel decision governance (principle_decide + DecisionInteraction + escalation/deferral captures) is the crown jewel; the compliance framework (Regulation/Obligation/Control/ComplianceProposal) generalizes propose-approve. But domain approvals exist five different ways (bills, compliance, outbound marketing, HITL gates, agent proposals) with no shared approval-chain primitive.
- **Forms/self-service — PARTIAL.** `DynamicForm`/`DynamicView` models exist but dormant (no builder UI). Actual self-service = coworker chat, Build Studio quick-box, storefront, customer portal, 20+ admin areas.
- **Reporting — PARTIAL.** Bespoke per domain (compliance posture, finance reports, Ops Map); Workbooks (spreadsheet substrate) is the seed of a generic layer; no ad-hoc report/dashboard composer or scheduled delivery.

## 4. Gap matrix — Claude mechanic → DPF primitive

Verdicts: ✅ EXISTS (at or beyond harness parity) · 🟡 PARTIAL (substrate present, activation/generalization missing) · 🔴 MISSING (no in-platform equivalent). "Gap → BI" names the seeded backlog item (§6) or the pre-existing home.

| # | Claude mechanic (§2) | DPF today | Verdict | Gap → BI |
|---|---|---|---|---|
| 1 | Layered instruction hierarchy | Unified prompt assembler (identity → authority → mode → skills → corpus) with kernel/org-overlay override chain in the wiki corpus | ✅ | Legacy path bypasses the assembler → gap folds into #2 |
| 2 | Skills w/ progressive disclosure | Full DB-native skill lifecycle (`lib/skills/runtime.ts`, SkillDefinition family, marketplace/curator/observatory) — but the **default runtime path (`USE_UNIFIED_COWORKER=false`) strips every skill** | 🟡 | **BI: retire legacy path / flip unified default** (relates EP-F7E35344, BI-E1FB2307) |
| 3 | Persistent memory | user-facts store + governed semantic recall + WWMD/WWWD corpus + durable AgentThread — shared & governed, deliberately not per-agent files | ✅ | Optional refinement: per-coworker durable working-notes; folded into memory-refinement BI |
| 4 | MCP client | McpServer/McpServerTool + catalog sync + `serverSlug__toolName` bridge + AgentToolGrant | ✅ | Wart: **BI: durable tool grants** (grants revert to seed on boot) |
| 5 | MCP server | Governed JSON-RPC/REST doors, 13 packs, scoped tokens, single audit choke point | ✅ | — |
| 6 | Deferred tool loading | `load_tools` budget mechanism + context-economy telemetry (window-aware banding) | ✅ | — |
| 7 | Permission planes | Capability + grant enforcement at `governedExecuteTool`; advise/act mode stripping; tool tiers | ✅ | Escalation-to-human as typed primitive exists via HITL gates but is fragmented → approval-engine BI (#16) |
| 8 | Subagents (generic spawn) | Governed delegation chains + A2A tasks + Build Studio dispatch — heavyweight shapes only; **no "spawn N parallel prompts" primitive** | 🔴 | **BI: coworker subagent fan-out primitive** |
| 9 | Deterministic workflows | 67 code-defined Inngest fns; nothing agent-authorable | 🔴 | **BI: agent-authored orchestration scripts** (shares substrate with #14) |
| 10 | Loops & scheduling | ScheduledAgentTask + proactivity-driven self-tasks + admission control | ✅ | Ops fragility tracked in Inngest-wedge epic (prevention BIs already filed) |
| 11 | Goals / stop conditions | Inline reviewer on autonomous runs (`coworker-inline-review.ts`) approximates; no goal-as-completion-gate primitive | 🟡 | **BI: goal/stop-condition primitive for coworker tasks** |
| 12 | Hooks (pluggable lifecycle) | Client-side plugin plane mature (9 guards, 3 engines); server-side only compiled-in interceptors — **no org-configurable pre/post-tool hook plane** | 🟡 | **BI: governed server-side hook plane** (the ServiceNow "business rules" analog) |
| 13 | Context management | Budget arbitration (L0–L2), pressure classification, compaction digest, per-model clamps | ✅ | — |
| 14 | Plugins & marketplaces | FeaturePack + hive ledger + McpIntegration catalog + skill marketplace — dev-facing, PR-based; **no install/update store across installs** | 🟡 | **BI: packaged-capability store** (publish→review→install w/ permission review) |
| 15 | Model routing | Learned routing w/ health, cost, champion/challenger, posture — **exceeds the CC harness** | ✅ | — |
| 16 | Sessions | Durable AgentThread; no fork/resume-by-reference or cross-session search surfaced | 🟡 | **BI: session resume/search/fork surfaces** |
| 17 | Tasks & progress surfaces | TaskRun + WorkQueue/WorkItem + Ops Map + review queues | ✅ | — |
| 18 | Deliverable surfaces | Chat + workbooks + bespoke reports; no artifact-style hosted deliverable primitive | 🟡 | **BI: coworker deliverable artifacts** (rendered, shareable outputs) |

**Reading of the matrix:** 10 of 18 at parity or beyond, 6 partial, 2 missing. The pattern in the partials is consistent: *the substrate exists but the activation or generalization layer doesn't*. DPF's deficits are not "build an agent runtime" (done, arguably better-governed than the harness) but (a) **orchestration ergonomics** (#8, #9, #11), (b) **runtime pluggability** (#2, #12), and (c) **distribution** (#14). These three clusters plus the declarative-admin-layer gaps from §3.2 (workflows, forms/catalog, approvals, SLA, CMDB unification, reporting) constitute the backlog seed in §6 — the "1000s of items" the operator anticipates decompose from these ~20 umbrella items, mostly via Build Studio right-sizing at execution time.

## 5. ServiceNow-parity lens

What ServiceNow actually is, reduced to nine capability families — and which side of the "inside-out" line each falls on. The harness mechanics (§2) are the *agent-native replacement* for the left column's automation layer; the system-of-record families remain conventional platform work tracked in existing epics.

| ServiceNow capability family | What it is | Agent-native equivalent in the inside-out frame |
|---|---|---|
| CMDB / CSDM | Canonical system of record for assets, services, relationships | DPF master data (MDM EP-4A12A7CB, CRM, GL, workforce) + a *live* environment model agents can query — the harness's "memory + schema grounding" replaces discovery-then-stale-copy |
| Flow Designer / Workflow Engine | Human-authored, form-triggered workflows | Deterministic agent workflows + loops/scheduling (§2 C9–C10): workflows become scripts agents author, run, and revise; humans approve rather than draw |
| Service Catalog / Request | Forms that create records that trigger flows | Marketplace + skill invocation (§2 E14, A2): a catalog item is a governed skill with a permission plane, not a form |
| ITSM (incident/problem/change) | Ticket tables + SLAs + assignment rules | Work-management substrate (BacklogItem/TaskRun/CWQ queues) with agents as first-class assignees; triage/approval as kernel decisions with ledgers |
| Approvals / governance | Approval chains on records | WWMD/WWWD/WSID decision governance: `principle_decide` + DecisionInteraction audit — policy evaluated per decision, not hard-wired chains |
| Knowledge Management | KB articles humans search | Wiki corpus as *behavioral* knowledge: WWWD org pages steer agents directly; knowledge is executable context, not documents |
| Virtual Agent / Now Assist | Scripted chatbot + bolt-on LLM | The coworker itself — the whole harness, not a chat veneer |
| App Engine (low-code) | Citizen-developer app builder | Build Studio: natural-language → governed build pipeline with gates; the "low-code" layer is the agent |
| Integration Hub | Prebuilt spokes/connectors | MCP client plane (§2 B4): the connector ecosystem is the open MCP registry, not a proprietary spoke catalog |

The strategic claim, sharpened: ServiceNow must retrofit an agent harness *onto* a record platform; DPF grows a record platform *inside* an agent harness. Haleliuk's "a lot of rearchitecting" is exactly the left-to-right migration of this table — which DPF gets to skip. The renewal-rate/F500 moat argument does not apply in the small-company segment DPF is entering first, which is also the segment least able to afford ServiceNow's implementation cost.

What this lens does NOT cover (deliberately out of scope here, tracked elsewhere): deep vertical record functionality (EP-SAP-PARITY finance, EP-B51FA3BC CRM), and horizontal scale/tenancy concerns.

## 6. Epic & seeded backlog

**Epic:** `EP-CLAUDE-INSIDE-OUT` — *Claude inside-out: agent-harness mechanics as governed DPF platform primitives (ServiceNow-replacement groundwork)*. Kernel altitude ledger `DI-D919355DF1AE`. All items filed 2026-07-07 as `triaging`, `proposedOutcome: build`, source `user-request`.

**Cluster 1 — harness parity (turn Claude inside out):**

| BI | Title | Matrix row |
|---|---|---|
| BI-E63B8293 | Coworker subagent fan-out primitive | #8 |
| BI-8E07CCA5 | Agent-authored deterministic orchestration workflows | #9 |
| BI-D6F6A313 | Goal / stop-condition primitive for coworker tasks | #11 |
| BI-69B614C6 | Governed server-side hook plane | #12 |
| BI-4FA040D5 | Durable coworker tool grants | #4 wart |
| BI-042F5269 | Packaged-capability store | #14 |
| BI-033F7446 | Coworker session surfaces (resume/fork/search) | #16 |
| BI-4D1CD70B | Coworker deliverable artifacts | #18 |
| BI-F9025BA0 | Per-coworker durable working memory | #3 refinement |

**Cluster 2 — declarative admin layer (ServiceNow-parity core):**

| BI | Title | §3.2 gap |
|---|---|---|
| BI-D80D16C4 | User-definable workflow primitive | top-10 #1 |
| BI-5032C62F | Service catalog and form builder | top-10 #2 |
| BI-55D2A0E5 | Universal approval-chain engine | top-10 #3 |
| BI-78414B9D | General SLA/OLA engine | top-10 #4 |
| BI-B459B303 | Unified CI identity graph (CSDM analog) | top-10 #5 |
| BI-28E5CBBD | ITSM process depth (problem / major-incident / linkage) | top-10 #6 |
| BI-83AC1A03 | Ad-hoc reporting and dashboard composer | top-10 #7 |
| BI-6804292F | Governed data extension (custom fields/tables) | top-10 #8 |
| BI-997503EC | User-configurable notification/subscription rules | top-10 #10 |

**Deliberately not refiled (already owned elsewhere):** legacy-vs-unified path split / skill activation → **BI-45514C4E** (EP-F7E35344); advise-mode transparency → BI-FE37B0A1; proactivity→autonomy execution loop → BI-2726089C (partially closed by #2674/#2685); coworker WWMD/WWWD routing → BI-3E71E016; Inngest scheduling fragility → the executor-wedge epic; deep vertical record functionality → EP-SAP-PARITY / EP-B51FA3BC / EP-4A12A7CB.

**Sequencing note (advisory, not triage):** the two highest-leverage items are BI-D80D16C4 (user-definable workflows — every catalog/approval/SLA/notification item composes onto it) and BI-45514C4E (unified-path default — until it lands, the whole skill plane is dark on default installs, which suppresses most of Cluster 1's value). The operator's "possibly 1000s" of items decompose from these umbrellas at Build Studio right-sizing time, not here.
