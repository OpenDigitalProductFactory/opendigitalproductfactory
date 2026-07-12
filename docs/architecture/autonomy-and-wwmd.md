---
title: Autonomy, WWMD, and trusted coworker decisions
description: How DPF uses the founder-kernel wiki, principle vectors, decision profiles, and audit ledgers to let AI coworkers answer ambiguity without silently overreaching.
---

DPF is not trying to make AI coworkers autonomous by removing humans from the loop. It is trying to make autonomy gradual, inspectable, and recoverable.

> **Scope note (2026-07-12).** This page predates the **three-scope** partition of the decision
> substrate and uses "WWMD" loosely for all of it. The current frame (kernel principle
> [`decisions-belong-to-their-scope`](../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md);
> spec [`2026-07-04-decision-governance-surface-redesign-design.md`](../superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md))
> separates three scopes that do not inherit each other's authority: **WWMD** (platform/founder
> doctrine — `principle_decide`), **WWWD** (an organization's own business stance — the org Decision
> Perspective Gate), and **WSID** (a profession's craft). Where this page says "WWMD" for a customer's
> business call, read **WWWD**; the mechanics below (gate, confidence, ledger) are common to all three.

WWMD is the working name for that decision substrate: "What Would Mark Do?" In product terms, it is a Decision Perspective Gate that lets a coworker ask the governed wiki how to resolve an ambiguity, then return an outcome with confidence, sources, and an audit record.

The important architectural point is that the judgment is no longer trapped in chat. It becomes a reusable platform capability that can be called by Build Studio, in-product coworkers, and external MCP clients under the same governance rules.

## Why this matters

AI coworkers hit open questions constantly:

- Should this feature be generalized for the Hive Mind or kept local to one install?
- Is this a quick fix, or does it violate an architectural principle?
- Should Build Studio start implementation, revise the plan, or escalate?
- Is the evidence strong enough for a coworker to continue?
- Does a low-risk action fit the autonomy policy, or does a human need to decide?

Without a shared decision substrate, every agent answers those questions from prompt memory, recent conversation, or model preference. That does not scale. At scale, trust requires the coworker to show:

- which principles were consulted
- which options were compared
- which criteria pulled the answer up or down
- how confident the gate was
- where the answer was too close, stale, risky, or under-supported
- who approved, overrode, escalated, or deferred the decision

WWMD is the step from "the agent seems reasonable" to "the platform can explain how this recommendation was reached."

## How the WWMD flow works

### 1. Retrieve grounded knowledge

The coworker starts with the wiki instead of guessing. The MCP `wiki_query` tool searches the founder-kernel wiki plus the organization overlay for entities, stances, heuristics, principles, decisions, runbooks, summaries, and index pages.

Retrieval has two modes:

- **Vector search:** semantic search over embedded wiki content. This is the default and works when the query directly resembles the right pages.
- **PPR search:** vector search seeds a Personalized PageRank pass over the wiki-link graph. This helps multi-hop questions where the best answer is connected to the first relevant pages rather than textually similar to the prompt.

Principle queries can also filter by tier, calling population, and public classification. That keeps an external coding agent, an in-platform coworker, and a human review surface from accidentally using the wrong guidance.

Code references:

- [`wiki_query` MCP tool](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp-tools.ts)
- [`recallWikiContext`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/recall.ts)
- [`searchByPPR`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/ppr.ts)

### 2. Frame concrete options

The coworker must turn the ambiguous question into candidate options. WWMD is useful when there are at least two real choices, not when the model is asked for an unconstrained opinion.

Each option has:

- a stable id
- a short plain-language description
- optional feature scores on the principle dimension registry

Feature scores are intentionally explicit. They force the caller to say which option increases or reduces things like maintainability, blast radius, evidence density, human load, governance compliance, data privacy, or vendor lock-in.

### 3. Select applicable principles

The `principle_decide` MCP tool retrieves the principles in scope for the decision:

- commandment principles are always included from Postgres
- relevant core and contextual principles are retrieved semantically
- `callingPopulation` filters the population the principle applies to: in-platform coworker, external coding agent, or human
- `ringScope` narrows the decision to the relevant Reduction Gear ring where provided
- callers can cap how many relevant principles are considered so the result stays inspectable

The tier weights come from the wiki taxonomy:

| Tier | Meaning | Default weight |
|------|---------|----------------|
| Commandment | Non-negotiable doctrine in its declared scope | 1.0 |
| Core | Strong platform default | 0.4 |
| Contextual | Narrow operational rule | 0.1 |

Code references:

- [`principle_decide` MCP tool](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp-tools.ts)
- [`PRINCIPLE_TIER_DEFAULT_WEIGHT`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/wiki-taxonomy.ts)

### 4. Run multiple vector analyses

WWMD's answer is deliberately multi-vector. It is not only "nearest wiki page wins."

| Vector | What it evaluates | Why it matters |
|--------|-------------------|----------------|
| Semantic retrieval vector | Which wiki pages and principles are meaningfully related to the question | Grounds the answer in current platform knowledge |
| Wiki-link vector | Which pages are connected to the relevant pages in the wiki graph | Surfaces second-order context for multi-hop questions |
| Principle dimension vector | How each option aligns with signed principle axes | Makes trade-offs inspectable instead of rhetorical |
| Tier weighting vector | Whether the pull comes from commandment, core, or contextual doctrine | Prevents weak contextual preferences from overruling hard rules |
| Authority and scope vector | Calling population, domain class, ring scope, profile chain | Keeps guidance local to the right actor and surface |
| Evidence quality vector | Freshness, evidence grade, review status, promotion state, recent overrides | Reduces autonomy when the material is stale, weak, rejected, revoked, or often overridden |
| Risk vector | Low, medium, high, critical decision risk | High-risk calls escalate even when the recommendation looks strong |

The principle dimension registry currently includes:

- long-term maintainability
- blast radius
- reusability
- evidence density
- human cognitive load
- capacity utilization
- governance compliance
- public safety
- speed to value
- schema grounding
- operational independence
- data privacy
- cost efficiency
- vendor lock-in

Code references:

- [`PRINCIPLE_DIMENSIONS`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/wiki-taxonomy.ts)
- [`computeStructuredAlignment`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/principle-decide.ts)
- [`computeSemanticAlignment`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/principle-decide.ts)
- [`scorePerspectiveMaterial`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/material.ts)

### 5. Return an outcome, not just prose

WWMD returns a structured outcome:

| Outcome | Meaning |
|---------|---------|
| `recommend` | The gate has enough signal to advise a path. Execution and approval still belong to the caller. |
| `arbitrate` | For low-risk decisions with high enough confidence, the coworker may continue under the declared autonomy policy. |
| `escalate` | Risk, conflict, low confidence, or policy boundaries require a human resolver. |
| `defer` | The wiki or decision profile lacks enough coverage. The correct answer is to capture the gap, not guess. |

The `principle_decide` result also returns:

- the winning option
- composite scores
- confidence and margin
- commandment-conflict flags
- weak structured-coverage flags
- a per-principle contribution ledger
- short reasoning naming the strongest contributors

Code references:

- [`decide`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/principle-decide.ts)
- [`DecisionOutcomeType`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/types.ts)

### 6. Persist the decision ledger

Build Studio's current WWMD gate writes a `DecisionInteraction` record. That record captures the profile, domain class, outcome type, confidence values, material count, source summaries, rationale, trigger user, feature build, and whether escalation or deferral follow-up was captured.

This is what makes trust scale. A coworker can act faster over time, but the organization can still reconstruct:

- what question was asked
- what the options were
- what guidance was consulted
- why the gate allowed, blocked, escalated, or deferred
- whether a human overrode the recommendation
- whether the unresolved decision became improvement material

Code references:

- [`evaluateBuildStudioPlanAdvancementGate`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/build-studio-gate.ts)
- [`persistDecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/persistence.ts)
- [`DecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/prisma/schema.prisma)

## A worked example

The flow above is abstract until you watch a question move through it. Here is a representative WWMD
run — the numbers illustrate the real `decide()` math (`composite = Σ principle.weight × alignment`),
they are not a captured transcript.

A `build-specialist` coworker has built an "overdue jobs" widget for an HVAC dispatcher board and hits
an open product question before shipping: *should this be generalized into the reusable workspace-home
primitive library for the Hive Mind, or kept local to this install?* (`domainClass:
architecture-tradeoff`, `riskTier: medium`).

It frames two options and scores each against the principles in scope. Each cell is a contribution
(`weight × alignment`); the composite is the column sum.

| Principle (tier, weight) | Option A — keep local | Option B — parameterize for the hive |
|--------------------------|----------------------:|-------------------------------------:|
| Learnings belong in the shared commons (commandment, 1.0) | +0.10 | **+0.85** |
| Architecture over shortcuts (core, 0.4) | +0.12 | **+0.32** |
| Speed to value (contextual, 0.1) | **+0.09** | +0.05 |
| **Composite** | **0.31** | **1.22** |

Option B wins with `margin = 0.91`, far above the default `tieMargin` of `0.2`, so `confidence` is
high; `structuredCoverage` is strong and `commandmentConflict` is false. The contextual "ship faster"
pull toward Option A is genuine, but at weight `0.1` it cannot overcome a commandment-tier reusability
pull at weight `1.0` — which is exactly what tier weighting is for. The gate returns `recommend`
Option B with the full contribution ledger; execution and approval still belong to the caller.

The same engine, pointed at a customer's WWWD corpus or a profession's WSID corpus, produces the
right *kind* of answer for the kind of doubt it faces — an honest `escalate` when an organization
hasn't authored a policy yet, or a source-cited `recommend` (with a `commandmentConflict` flag on the
tempting-wrong option) when a profession corpus has crisp doctrine. The user-guide walkthrough runs all
three scopes end-to-end with their ledger rows: [Decision Perspective in
Practice](/user-guide/ai-workforce/decision-perspective-in-practice).

## The learning loop

The most important output is not only the recommendation. It is the gap signal.

When WWMD escalates or defers, the platform has discovered that its kernel is under-specified, conflicted, stale, or too weakly evidenced for the current class of work. Human resolution can then become reviewed perspective material or a founder-kernel improvement candidate. Once that material is promoted, future coworkers can answer the same class of question with higher confidence and less interruption.

That creates the autonomy flywheel:

1. Coworker encounters ambiguity.
2. WWMD consults the wiki and decision profiles.
3. The gate recommends, arbitrates, escalates, or defers.
4. Human resolution is captured when needed.
5. Reviewed resolutions improve the kernel.
6. Future coworkers inherit the better decision substrate.

This is how DPF moves toward autonomy while preserving trust. The platform does not hide uncertainty. It turns uncertainty into governable work.

## Current boundaries

WWMD is advisory unless a caller's autonomy policy explicitly allows arbitration for the risk tier. It is not a bypass around approval, authorization, test gates, source control, or runtime safety controls.

The current public posture is:

- `wiki_query` and `principle_decide` are MCP-facing governance tools.
- The Build Studio plan-advancement gate persists decision interactions.
- Voice narration can read a WWMD rationale, but voice does not change authority.
- Runtime commandment enforcement is related but separate: it blocks or escalates execution attempts that violate tier-1 rules.
- Public A2A exposure is future-facing; internal task-native work comes first.

The north star is simple: AI coworkers should gain more room to act only when the decision path is more inspectable, better evidenced, and easier to override.
