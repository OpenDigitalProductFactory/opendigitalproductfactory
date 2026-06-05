---
title: Autonomy, WWMD, and trusted coworker decisions
description: How DPF uses the founder-kernel wiki, principle vectors, decision profiles, and audit ledgers to let AI coworkers answer ambiguity without silently overreaching.
lastUpdated: 2026-05-26
updatedBy: Codex
---

DPF is not trying to make AI coworkers autonomous by removing humans from the loop. It is trying to make autonomy gradual, inspectable, and recoverable.

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
