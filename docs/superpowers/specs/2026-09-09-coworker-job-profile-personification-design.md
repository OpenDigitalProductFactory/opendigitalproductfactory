---
status: draft
---

# Coworker Job Profile — Personification at Execution Time — Design Spec

| Field | Value |
|-------|-------|
| **Backlog** | BI-841C8BEC (parent) · BI-5CCBF85B · BI-003816C1 · BI-775E1669 · BI-3ABE0149 · BI-9F0978F3 |
| **Epic** | EP-COWORKER-LIFECYCLE |
| **Status** | Draft |
| **Created** | 2026-09-09 |
| **Author** | Claude Opus 5 for Mark Bodman |
| **Companion specs** | [2026-04-27-coworker-persona-audit-design.md](./2026-04-27-coworker-persona-audit-design.md) — defines the six-section job description this spec makes reachable and queryable · [2026-04-27-coworker-tool-grant-spec-design.md](./2026-04-27-coworker-tool-grant-spec-design.md) — the tool envelope |
| **Normative standards** | [GAID](../../architecture/GAID.md) — who the agent is · [TAK-JSI](../../architecture/job-specific-intelligence.md) §7 — the job profile · [work-shape taxonomy](./2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md) — what the job serves |
| **Out of scope** | Authoring new job descriptions (they exist and conform), model binding, token budgets, A2A transport, human HRIS surfaces |
| **Primary goal** | Every AI coworker knows its own job when it executes work, states its abilities the way a person in the equivalent role would, and is staffed onto work by matching that job to the shape of the work — so that organizational design, not routing accident, decides who does what. |

---

## 1. Problem Statement

DPF hires AI coworkers into jobs. Organizational design starts by naming the job to be done and hiring to it; the coworker that fills the job must know what it is accountable for, what it may decide, where its authority stops, and who it works with. Today the platform has written all of that down, checks it in CI, and then does not give it to the coworker.

### 1.1 The job descriptions exist and they are conformant

The [persona audit spec](./2026-04-27-coworker-persona-audit-design.md) §3.2 mandates six ordered sections per coworker: `# Role`, `# Accountable For`, `# Interfaces With`, `# Out Of Scope`, `# Tools Available`, `# Operating Rules`. Its own words: *"The first four sections together are the job description. The fifth is the tool envelope. The sixth is the playbook."*

That gate is green. Run at `c4ad51898e3`:

```
invariantsChecked: 9   errorCount: 0   warnCount: 3
```

All three warnings are `PERSONA-008` (a one-line description over 120 characters). All 87 agents in `packages/db/data/agent_registry.json` have a persona file carrying a matching `agent_id`. 91 files across `prompts/route-persona/` (31) and `prompts/specialist/` (60).

The content is not the problem. The wiring is.

### 1.2 The measured defect: 78% of the roster executes without its job description

The autonomous execution paths all resolve their system prompt through one helper, `loadPromptBackplane` ([apps/web/lib/tak/agent-routing-server.ts:22-30](../../../apps/web/lib/tak/agent-routing-server.ts)):

```ts
async function loadPromptBackplane(agentId: string, fallbackPrompt: string): Promise<string> {
  const dbPrompt = await loadPrompt("route-persona", agentId, fallbackPrompt);
```

It asks for **category `route-persona`, slug `agentId`**. Prompt templates are seeded with **slug = file basename** ([packages/db/src/seed-prompt-templates.ts:132](../../../packages/db/src/seed-prompt-templates.ts)) under the **directory as category**. So a lookup succeeds only when the coworker's runtime id happens to equal a persona file's basename *and* that file lives in `prompts/route-persona/`.

Measured against the live install roster:

| Selectable coworkers (`active` / not archived / `production`) | 130 |
|---|---|
| Resolve a job description at runtime | **29 (22%)** |
| Fall back to a generated one-liner | **101 (78%)** |
| — of which hold a complete, audit-conformant persona in `prompts/specialist/` that the backplane never reads | 13 |
| — of which have no persona template keyed by their runtime id at all | 88 |

What the other 101 receive instead, in full ([agent-routing-server.ts:127](../../../apps/web/lib/tak/agent-routing-server.ts)):

> `You are ${agentName}. Complete the assigned scheduled work with your granted tools, prefer concrete action over narration, and finish with a concise operational summary.`

That is a work instruction, not a job. It carries no purpose, no accountability, no boundary, no peers. A coworker running on it infers its role from the task in front of it, which is precisely the failure the persona audit spec was written to prevent: *"Two invocations of the same agent on different topics behave like two different agents — no stable accountability."*

### 1.3 Why the gate is green while the runtime is empty

The audit and the runtime key on different fields.

| | Key | Source of truth |
|---|---|---|
| `audit-coworker-personas.ts` (PERSONA-001) | frontmatter `agent_id` ∈ registry | the file's declared identity |
| `loadPromptBackplane` | template `slug` == `runtimeAgentId` | the file's **basename** and its **directory** |

**Zero of the 91 persona files have `slug == agent_id`.** Every one is keyed by a human-readable basename (`policy-enforcement-agent`) while declaring a canonical identity (`AGT-100`). A partial bridge exists — `COWORKER_SLUG_TO_CANONICAL_AGENT_ID` ([packages/db/src/agent-identity.ts:76](../../../packages/db/src/agent-identity.ts)) — but it covers roughly 47 workstream and orchestrator identities and is hand-maintained. Nothing requires a persona file to be reachable, so nothing noticed when 101 became unreachable.

This is the kernel principle `encoded is not verified` in its exact form: a gate that measures the wrong thing is worse than prose, because prose does not claim to be checked. `PERSONA-001` asserts *"every registry agent has a persona file"*. The proposition the platform actually needs is *"every executing coworker is given its job description"*, and no check states it.

### 1.4 The job description is prose, not data

Even for the 22% that resolve, the six sections arrive as one markdown string concatenated into a system prompt. Nothing can query them. `Agent` ([packages/db/prisma/schema/ai-coworker.prisma:226-291](../../../packages/db/prisma/schema/ai-coworker.prisma)) has `name`, `displayName`, `kind`, `tier`, `description`, `role`, `valueStream`, `hitlTierDefault`, `escalatesTo`, `delegatesTo[]` — governance dials and routing edges. It has no purpose, no accountable-for, no out-of-scope, no decision rights, no success measures, no position.

Three consequences follow.

**The platform reads the job back off the model.** `submit_coworker_capability_need` takes a `missionSummary`: *"How the coworker understands its mission/job in one or two sentences."* The platform asks the coworker to infer the job it was never told, then records the inference as input to staffing decisions.

**Staffing cannot be reasoned about.** No query answers "who is accountable for release acceptance", "which coworkers may not touch production", or "what is this coworker explicitly not allowed to do". Those are the first questions of organizational design.

**The richest job model faces outward only.** `CoworkerService` / `CoworkerOffer` carry `authorityBoundary`, `requiredInputs`, `producedOutputs`, `deliverables`, `riskTier`, `dataBoundary`, `sla`; the GAID agent card ([apps/web/lib/coworker-service-catalog/agent-card.ts](../../../apps/web/lib/coworker-service-catalog/agent-card.ts)) projects identity, authority boundary, capabilities and required grants to federated peers. Both are complete enough to be job descriptions. Both are published to other organizations and never shown to the coworker they describe.

### 1.5 Execution paths that carry no job at all

`loadPromptBackplane` is reached by four autonomous runners: work threads, coworker requests, scheduled and self tasks, and Workroom stage execution (via a scheduled task). Four other paths bypass it.

| Path | Prompt | Job? |
|---|---|---|
| Build Studio autonomous codegen — [build-pipeline.ts:469](../../../apps/web/lib/build/build-pipeline.ts) | `"You are an AI coworker building a feature in the sandbox."` + build state + `prompts/build-phase/<phase>` | **No** |
| Build Studio specialists (agentic) — [specialist-prompts.ts:296](../../../apps/web/lib/build/specialist-prompts.ts) | `prompts/specialist/<role>`, shared header *"You are a specialist sub-agent … Build Studio"* | Partial — a build **role**, not the coworker's job |
| Build Studio specialists (external CLI) — [sandbox/agent-cli-runtime.ts:89](../../../apps/web/lib/build/sandbox/agent-cli-runtime.ts) | hardcoded `SPECIALIST_ROLE_INSTRUCTIONS[role]` | **No** |
| Deliberation — [queue/functions/deliberation-run.ts:141](../../../apps/web/lib/queue/functions/deliberation-run.ts) | none; the run routes an endpoint and completes the node | **No** — `ResolvedDeliberationRole.personaText` is loaded at [deliberation/registry.ts:135](../../../apps/web/lib/deliberation/registry.ts) and referenced nowhere outside its own tests |

Build Studio codegen is where the most consequential work happens, and it is the path with the least identity.

### 1.6 The interactive path labels the page as the persona

The unified assembler ([apps/web/lib/tak/prompt-assembler.ts](../../../apps/web/lib/tak/prompt-assembler.ts)) is reached from interactive chat and the endpoint-test runner only. On it:

- Block 1 `IDENTITY_BLOCK` (`:107`) is one static string for every coworker: *"You are a specialist assigned to the area the employee is currently viewing."*
- Block 2 (`:259`) states the **employee's** HR role and granted/denied capabilities. The coworker's own authority is never stated.
- [agent-coworker.ts:851,863](../../../apps/web/lib/actions/agent-coworker.ts) passes `routeCtx.domainContext` — a description of the **page** — into `composeCoworkerDomainContext({ persona: selectedDomain })`.

A coworker on this path is told where it is standing and whose authority it borrows. It is not told who it is.

### 1.7 Work shape does not resolve to a job

`workroomShape` ([work-management/room-shapes.ts:4-11](../../../apps/web/lib/work-management/room-shapes.ts)) names abstract participant roles — `coordinator`, `specialist`, `approver`, `reviewer`. `ReadinessShape` ([backlog/initiative-readiness/shape-requirements.ts:29](../../../apps/web/lib/backlog/initiative-readiness/shape-requirements.ts)) carries a free-text `accountableRole`. `executorKind` names runtimes (`build-studio`, `codex-desktop`, `human`). `WorkroomParticipantRole` is room-local.

No function answers *"which coworker is qualified to be the specialist for this shape"*. Staffing a room is assignment, not hiring.

### 1.8 Coworker and human job structures are disjoint

`Position` ([packages/db/prisma/schema/workforce.prisma:129](../../../packages/db/prisma/schema/workforce.prisma)) carries `title`, `jobFamily`, `jobLevel`, `occupationKey` → `OccupationProfile`. `Agent` has no `positionId` and no FK in either direction. `OccupationProfile.coworkerRoster` points from a human occupation to agent slugs, one way.

A coworker cannot be said to hold a position in the organization. When a coworker replaces or augments a person in an existing job, there is no structure that says so, and no way to compare the two.

### 1.9 Conformance is referential, never semantic

`LIFE-001` … `LIFE-009` ([coworker-lifecycle/coworker-definition.ts:136-161](../../../apps/web/lib/coworker-lifecycle/coworker-definition.ts)) check that grants are honored by some tool, that a route exists, that a model floor is set, that ids cross-reference. All nine are referential integrity. `establishCoworker()` ([establish-coworker.ts:71](../../../apps/web/lib/coworker-lifecycle/establish-coworker.ts)) requires exactly `name` and a one-line `description`:

```ts
if (!input.name?.trim() || !input.description?.trim())
  return { ok: false, code: "missing_fields", message: "name and description are required." };
```

A specialist with no purpose, no accountability and no boundary passes every gate the platform has. As the roster grows, each addition inherits the gap.

### 1.10 Evidence of the cost

[docs/superpowers/audits/2026-04-28-coworker-self-assessment.md](../audits/2026-04-28-coworker-self-assessment.md) asked 50 coworkers to reason as themselves against their own tool envelope. Verdicts: **blocked 28 (56%)**, gaps 20 (40%), adequate 2 (4%).

`BI-2C5DECC1` records that certification is presence-shaped — 18 of 23 coworkers pass a generic read probe with zero domain capability. `BI-79298169` records a Finance Specialist that can route but cannot finish the job. These are the same defect seen from three angles: the platform has no statement of what each coworker is *for*, so it cannot tell whether the coworker is equipped for it.

---

## 2. Non-Goals

- **Authoring job descriptions.** All 87 registry agents have conformant six-section personas. This spec makes them reachable, queryable and injected. Where §1.2 counts 88 coworkers with no persona *keyed by runtime id*, the remedy is keying and coverage, not new prose.
- **Replacing GAID or TAK-JSI.** Both are normative and already written. This spec implements TAK-JSI §7 as substrate and feeds GAID's agent card from it.
- **A new taxonomy.** `workroomShape`, `ReadinessShape`, `workShape`, `Position` and `OccupationProfile` all exist. This spec binds them; it introduces no fourth vocabulary.
- **Human HRIS changes.** `Position` gains a reverse relation, nothing more.
- **Model or provider selection.** Which model a job needs is `resolve_model_selection`'s problem.
- **Retiring the registry/roster dual namespace.** Tracked separately as `BI-620EBA53` and `BI-E9FF1287`. This spec must work correctly while both exist, which is why §4.1 keys on canonical identity with an explicit bridge rather than assuming convergence.

---

## 3. Design Principles

1. **The persona file stays the single source of truth.** Job descriptions are authored and reviewed as markdown; the database holds a *projection*, regenerated and drift-gated. No hand-maintained second copy.
2. **Reachability is the invariant, not presence.** A gate asserts what the runtime actually resolves, keyed the way the runtime keys it.
3. **The coworker is told its job on every path that executes work.** One resolver, consumed everywhere, including Build Studio.
4. **Authority is an intersection and is stated as one.** A coworker acts under its own job authority *and* the requesting human's, whichever is tighter.
5. **Staffing is hiring.** Work shape names a job; a job resolves to qualified coworkers; a room is staffed from that resolution.
6. **Extend, do not parallel.** Reuse `CoworkerService.authorityBoundary`, the agent-card projection, `Position`, the existing shape vocabularies.

---

## 4. Design

### 4.1 `CoworkerJobProfile` — the job as data

A projection table shaped by TAK-JSI §7, generated from the persona file, one row per canonical agent identity.

| Field | TAK-JSI §7 | Source in the persona file |
|---|---|---|
| `canonicalAgentId` | stable id | frontmatter `agent_id` |
| `profileVersion` | version | frontmatter `version` |
| `title` | — | frontmatter `displayName` |
| `purpose` | purpose | `# Role` body |
| `accountableFor[]` | activities and expected outcomes | `# Accountable For` bullets |
| `interfacesWith[]` | required human roles, oversight boundaries | `# Interfaces With` bullets, `AGT-*` resolved |
| `outOfScope[]` | known exclusions, prohibited actions | `# Out Of Scope` bullets |
| `toolEnvelope[]` | tool and connector requirements | `# Tools Available` grant keys |
| `authorityBoundary` | local authorization classes | registry `hitl_tier_default` + `CoworkerService.authorityBoundary` when a service backs the agent |
| `accountableOwner` | accountable owner | frontmatter `reports_to` |
| `positionId` | occupation anchor | new — §4.5 |
| `evidenceExpectations[]` | expected evidence and acceptance criteria | `# Operating Rules`, structured follow-up |
| `sourceDigest` | — | content hash of the composed persona, for drift detection |

**Keying.** The row is keyed by `canonicalAgentId`. The generator resolves the persona file's `agent_id` through `resolveCanonicalAgentId`, so both namespaces land on one row while `BI-620EBA53` is open.

**Generation.** `apps/web/scripts/audit-coworker-personas.ts` already parses every file, composes `composesFrom` includes, and validates the six sections. It gains a `--emit-job-profiles <path>` mode producing a deterministic JSON artifact, which the seed loads. The audit remains the parser; there is one implementation of "what the sections mean".

**Drift gate.** `sourceDigest` mismatch between the committed artifact and a fresh parse fails CI. The database can never disagree with the file.

### 4.2 Reachability — the defect fix

Two changes, small and independent of the rest of the spec.

**Resolve by canonical identity, then bridge to slug.** `loadPromptBackplane` takes the canonical agent id and searches, in order:

1. `route-persona` / `<canonicalAgentId>`
2. `specialist` / `<canonicalAgentId>`
3. `route-persona` / `<slug>` where slug comes from `CANONICAL_AGENT_ID_TO_COWORKER_SLUG`
4. `specialist` / `<slug>`
5. **the persona-file index** — a generated map from `canonicalAgentId` to `{category, slug}`, emitted by the same audit run as §4.1, which makes the lookup total rather than dependent on a hand-maintained bridge

Step 5 is what closes the 88. The index is derived from frontmatter `agent_id`, the field the audit already validates, so any file the audit accepts is reachable by construction.

**The fallback becomes an error signal.** Today a miss silently produces a one-liner. It will emit a `coworker_job_profile_unresolved` structured log with the canonical id and the paths tried, and increment a counter the capability-completeness `identity` plane reads. A coworker executing without its job is a defect, and must be visible as one.

The generated one-liner is retained as the last resort — a coworker with no job description must still be able to complete work in progress rather than throwing mid-run — but it is no longer silent.

**`PERSONA-011` (error): every selectable coworker resolves a job description through the runtime's own lookup.** The check calls the same resolution function the runtime calls. This is the invariant §1.3 was missing. It is baselined at the current 101 failures and is shrink-only, so the number can only fall.

### 4.3 Injection — the coworker is told its job

**One renderer.** `renderJobBrief(profile): string` produces the role block from the §4.1 fields: title, purpose, accountable-for, interfaces-with, out-of-scope, tool envelope, authority boundary. Deterministic, cacheable, one implementation.

**Autonomous paths** already receive the composed persona through the backplane; §4.2 makes it reach 100%. The backplane composes `renderJobBrief` output when a profile exists and the raw persona body otherwise, so the two converge without a flag day.

**Build Studio codegen** ([build-pipeline.ts:469](../../../apps/web/lib/build/build-pipeline.ts)) replaces the hardcoded `buildLead` with `renderJobBrief` for the executing coworker, keeping `buildContext` as undeclared turn data per `BI-CE93E314`. The build's phase prompt continues to describe the *task*; the job brief describes the *worker*.

**Build Studio specialists** keep their build-role prompt and gain the job brief above it, on both the agentic and external-CLI surfaces. A specialist is a coworker doing a build role, not a different entity.

**Deliberation** consumes the already-loaded `personaText`, or is changed to stop loading it. Dead intention-bearing code is a defect (`BI-B57CA395`); this spec requires the decision be made, not deferred again.

**Interactive chat, unified path** gains Block 1a immediately after `IDENTITY_BLOCK`, above the cache boundary since it is static per coworker. `agent-coworker.ts` stops labelling the page's `domainContext` as `persona`; the page description keeps its own honest label. Both are declared in `coworker-prompt-provenance` as instruction.

**Block 2 states both authorities.** Today: *"The employee you're working with holds role X … All actions you take execute under their authority. Never exceed it."* It becomes the intersection — the coworker's own authority boundary and prohibited actions, the employee's granted and denied capabilities, and the rule that the tighter of the two binds. This is the honest statement of what the execute gate already enforces.

### 4.4 Work shape resolves to a qualified job

`resolveQualifiedJobs(input): JobMatch[]` takes a `workroomShape` participant role, a `ReadinessShape.accountableRole`, or a `workShape` key, and returns job profiles qualified for it, with the reason for each match.

Consumed by `create_workroom`, `invite_room_participant`, `appoint_room_coordinator` and `get_staffing_coverage`. Room shape definitions gain `requiredJobs[]` beside the existing `inclusionOrder`; a room whose required job resolves to nobody reports a **named staffing gap** rather than filling the seat with whoever is routable.

The room-aware tool gate (`BI-947780FE`) derives its default allow-set from the matched profile's `toolEnvelope`, so room authority and job authority are the same statement. Where a job profile names the accountable role, it populates the ladder's `archetypePrincipalRef` rung, which is currently never populated (`BI-4B5E3443`).

### 4.5 The coworker holds a position

`CoworkerJobProfile.positionId` → `Position`. `Position` gains the reverse relation. The coworker's `title` and `jobFamily` come from the position, so a coworker and a person in the equivalent job are described by the same structure and can be compared, staffed and reported on together. `OccupationProfile.coworkerRoster` becomes derivable rather than hand-maintained.

This is the organizational-design claim made concrete: the platform hires to a job, and both kinds of worker fill jobs of the same shape.

### 4.6 Capability statement

`get_my_coworker_profile` and `assess_my_capabilities` return the job profile. A coworker asked what it can do answers from its job — purpose, accountable-for, boundaries, tools — rather than reconstructing an impression from its tool list.

`submit_coworker_capability_need` keeps `missionSummary`, but it changes meaning: the platform now states the mission, and the coworker's summary is checked against it. A divergence is a signal about the job description, and is surfaced as one.

### 4.7 `LIFE-010` — no coworker without a job

Added to `checkDefinitionConformance()`: every selectable coworker has a complete job profile — `purpose`, `accountableFor`, `outOfScope`, `authorityBoundary` and `toolEnvelope` all non-empty, `toolEnvelope` consistent with `LIFE-002` grants, `positionId` resolved. Baselined in `coworker-definition-baseline.json`, shrink-only.

`establish_coworker` gains the job-profile fields and refuses an incomplete definition with `incomplete_job_profile`, naming each missing item. Hiring without a job description stops being possible.

`PERSONA-*` and `LIFE-*` are reconciled so one derives from the other. Two gates checking overlapping propositions on different keys is how §1.3 happened.

---

## 5. Delivery Slices

| # | Backlog | Scope | Depends on |
|---|---|---|---|
| **0** | BI-5CCBF85B | §4.2 reachability fix + `PERSONA-011` + unresolved-job telemetry | — |
| **1** | BI-003816C1 | §4.1 `CoworkerJobProfile` projection, generator, drift gate, §4.5 `Position` link | 0 |
| **2** | BI-775E1669 | §4.3 `renderJobBrief` and injection on every executing path; §4.6 capability statement | 1 |
| **3** | BI-3ABE0149 | §4.4 work-shape → qualified job resolution and room staffing | 1 |
| **4** | BI-9F0978F3 | §4.7 `LIFE-010`, `establish_coworker` refusal, gate reconciliation | 1, 2 |

Slice 0 is a break-fix and delivers most of the founder-visible outcome on its own: it takes the share of coworkers that execute knowing their job from 22% to 100% using job descriptions that already exist and already pass review. It is sequenced first for that reason.

---

## 6. Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-CJP-001** | `PERSONA-011` passes for every selectable coworker: the runtime's own resolution function returns a job description, not the fallback. |
| **AC-CJP-002** | A coworker whose job cannot be resolved emits `coworker_job_profile_unresolved` with the canonical id and the paths tried, and the capability-completeness `identity` plane reflects it. |
| **AC-CJP-003** | `CoworkerJobProfile` exists for every selectable coworker and its `sourceDigest` matches a fresh parse of the persona file; a hand-edited row fails CI. |
| **AC-CJP-004** | A query answers, for any coworker: what it is accountable for, what it may not do, what tools its job requires, and which position it holds. |
| **AC-CJP-005** | Build Studio codegen and both specialist surfaces include the executing coworker's job brief; a test asserts the job's title and out-of-scope text in the assembled prompt. |
| **AC-CJP-006** | On the unified chat path the coworker's own title, accountable-for and out-of-scope appear in the system prompt, and no page description is labelled `persona`. |
| **AC-CJP-007** | Block 2 states the coworker's authority and the employee's, and names the tighter as binding. |
| **AC-CJP-008** | For every closed `workroomShape` participant role and every `ReadinessShape.accountableRole`, `resolveQualifiedJobs` returns at least one qualified coworker or a named staffing gap that `get_staffing_coverage` reports. |
| **AC-CJP-009** | `establish_coworker` refuses a definition with no purpose, accountable-for or out-of-scope, returning `incomplete_job_profile` and naming the missing items. |
| **AC-CJP-010** | `LIFE-010` is baselined and shrink-only; the count of coworkers without a complete job profile can only fall. |
| **AC-CJP-011** | Deliberation either consumes `personaText` or no longer loads it. No intention-bearing field is left with no reader. |
| **AC-CJP-012** | `get_my_coworker_profile` returns the job profile, and a coworker asked what it can do answers in job terms. |

---

## 7. Open Decisions

1. **The 88 with no persona keyed by runtime id.** §4.2 step 5 makes every audit-accepted file reachable, which resolves them by construction if their `agent_id` frontmatter is correct. Any residue after the index lands is genuine coverage work and must be counted, not estimated.
2. **`accountableRole` free text.** `ReadinessShape.accountableRole` is an unconstrained string. Binding it to job profiles either closes the vocabulary or accepts a resolver miss. Recommend closing it, with the existing values as the initial set.
3. **Deliberation roles are not coworkers.** `author` / `reviewer` / `skeptic` / `adjudicator` are debate positions. Whether they become jobs or stay roles decides AC-CJP-011's direction. Recommend they stay roles and the dead field is removed.
4. **Position for platform coworkers.** Some coworkers have no human counterpart. Either `positionId` is nullable for them or the platform defines positions that no person holds. Recommend nullable with a stated reason, so the exception is visible.
