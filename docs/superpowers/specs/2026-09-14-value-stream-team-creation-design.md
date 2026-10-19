---
title: A Value Stream Team can be created — the governed path for the platform's only team-routing substrate
slug: 2026-09-14-value-stream-team-creation-design
status: draft
authoredAt: 2026-09-14
backlog_item: BI-8E51C422
decision_interaction: DI-74D5B80513F3
---

# A Value Stream Team can be created

## Problem

`ValueStreamTeam` is load-bearing substrate with no way to create a row.

- `apps/web/lib/queue/queue-router.ts` resolves a team by id and routes work to
  its roles' agents. With no teams it returns `no-team-found` on every call, so
  team-based routing has never executed on any install.
- Four relations hang off it: `ValueStreamTeamRole`, `ValueStreamHitlGate`,
  `WorkQueue`, `WorkItem.teamId`.
- The EA Workrooms page groups rooms by it.

Verified by grepping every `create`/`upsert` reference outside the generated
Prisma client across `apps/` and `packages/`: **there are none.** No seed, no
server action, no MCP tool, no UI. On the live install: 0 teams, 0 WorkItems
with a `teamId`.

This is not a dormant feature — it is a modelled capability with no entry point.
BI-0EB855CC made the Workrooms page state the absence honestly ("Team plans are
not configured on this install") rather than implying the operator forgot. This
spec gives the operator something to do about it.

## Decision already taken

Kernel decision `DI-74D5B80513F3` (stakes: high) chose **governed-creation-path**
(composite 9.33) over document-and-leave (4.69), seed-per-archetype (4.53) and
retire-the-substrate (3.54); margin 4.64, high confidence, zero flipping
principles.

Retiring lost because it deletes designed capability and is a schema migration
on every install. Seeding lost because it invents the operator's team structure
for them and is the widest blast radius. Leaving it lost because a router branch
and four relations stay permanently inert, to be rediscovered by the next reader.

## Research & Benchmarking

The question is how comparable systems let an operator define *who does the work*
for a class of work, and what they refuse to infer.

**Temporal — Task Queues + Worker registration.** A queue is just a name; workers
register against it at runtime and the routing is the pairing of the two. Nothing
in the control plane pre-declares a roster. *Adopt:* the queue is the routing
address, and binding is late. *Reject:* purely implicit membership — DPF needs a
declared, auditable roster because its workers include AI coworkers whose tool
grants must be intersected at dispatch, which an implicit registration cannot
express.

**Camunda 8 — process definitions with assignment rules.** Deployment-time
definitions carry user-task assignment (candidate groups/users), edited in a
modeller and deployed as an artifact. *Adopt:* the team is a declared artifact,
versioned and reviewable, not ambient config. *Reject:* modeller-as-the-only-path
— DPF's operator is explicitly non-technical (AGENTS.md §12 "hide complexity from
layman users"), so the primary path must be an in-product surface, not an
authored file.

**GitHub CODEOWNERS / Teams.** Ownership is a declared mapping from a scope
(path) to a team, with membership managed separately, and unmatched scopes
fall through to a default rather than erroring. *Adopt:* the two-level split —
team identity and membership are managed separately from the routing rule that
points at them. *Reject:* silent fall-through. DPF's router already returns an
explicit `no-team-found`; that honesty is the behaviour BI-0EB855CC restored on
the page and should not be traded for a default.

**What DPF adopts.** Declared, auditable team artifacts (Camunda) whose roles
bind to agent identities whose grants are intersected at dispatch (DPF's own
rule, §6); the queue as the routing address (Temporal); identity and membership
managed separately from the rule that points at them (CODEOWNERS). **What DPF
rejects:** inferring a team from archetype or activity history, and defaulting an
unrouted item to any team — both would reintroduce the "authoritative wrong
answer" that PR #5189 removed from portfolio placement.

## Design

### 1. The governed MCP tool is the contract

`create_value_stream_team` / `update_value_stream_team`, authority-gated, is the
single writer. Per AGENTS.md §12 MCP is the coordination plane, so the tool is
the contract and the UI composes it — not a server action with a tool bolted on
beside it.

Inputs map to the existing model with no new columns:

| input | column | notes |
| --- | --- | --- |
| `name` | `name` | required |
| `valueStream` | `valueStream` | IT4IT slug; closed set, validated |
| `teamPattern` | `teamPattern` | specialist-dispatch \| review-board \| pair \| swarm \| pipeline |
| `portfolioId` | `portfolioId` | optional; absence is reported, never defaulted (PR #5189) |
| `roles[]` | `ValueStreamTeamRole` | `agentId` MUST resolve in `agent_registry.json`; an invented coworker is a fabrication |
| `hitlGates[]` | `ValueStreamHitlGate` | `requiredRole` is a PlatformRole code |
| `coordinationPattern` | `coordinationPattern` | existing Json contract |

**Authority.** `write` scope plus a granular grant, intersected with the caller's
role capabilities (§6). A team defines who may act and which grants they carry,
so creating one is an authority-shaping act: it belongs behind the same bar as
other governed writes, not behind `read`.

**Closed sets.** `valueStream`, `teamPattern` and `workerType` are closed-set
strings today. Per AGENTS.md §8 they become Prisma enums, or — if that is
deferred — a `*_closed_set` CHECK plus a parity test. This spec does not get to
skip that: BI-A5EEB5D1 found a row that no code path could update precisely
because a closed set was enforced in one copy and not the other.

### 2. The admin surface composes the tool

Under Platform, composed from shared primitives (§9), theme tokens only. It is
the operator's path; the tool is the agent's. Both write through the same code.

### 3. `WorkItem.teamId` assignment

Without this the router still finds nothing. Assignment is a separate,
explicitly-scoped step in the sequence below — routing an item to a team is a
different decision from defining the team, and bundling them would hide it.

### 4. What stays absent

No backfill. No archetype-derived defaults. An install with zero teams keeps
saying "not configured on this install" until an operator creates one. That
sentence is now true and actionable rather than an accusation.

## Implementation sequence

1. Closed-set hardening for `valueStream` / `teamPattern` / `workerType` (§8),
   with the code↔DB parity test BI-A5EEB5D1 established as the pattern.
2. `create_value_stream_team` / `update_value_stream_team` MCP tools + grants,
   with unit tests for authority intersection and agent-identity validation.
3. Admin surface composing the tools.
4. `WorkItem.teamId` assignment path, so `queue-router` can leave
   `no-team-found`.
5. Docs: `docs/user-guide/architecture/index.md` currently states plans cannot be
   configured — that sentence changes only when step 3 lands.

Each step is a separate PR scoped to one clean revert (§3). Steps 1–2 are the
minimum that makes the substrate real; 3–4 make it usable.

## Non-goals

- Backfilling or inventing teams for existing installs.
- Changing `queue-router`'s `no-team-found` behaviour. It is correct; it has
  simply never had input.
- Retiring `ValueStreamTeam`, which `DI-74D5B80513F3` scored lowest.

## Risks

- **A team shapes authority.** Roles carry `grantScope`. If the creation path
  were under-gated, creating a team would become a privilege-escalation route.
  Mitigated by step 2's authority intersection and its tests; this is the single
  most important thing to get right, and it is why the tool precedes the UI.
- **Closed-set drift**, exactly as in BI-A5EEB5D1. Mitigated by step 1 landing
  first.
