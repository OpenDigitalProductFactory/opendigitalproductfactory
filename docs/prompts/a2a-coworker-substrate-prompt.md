# Prompt — A2A Coworker Communication & Background-Work Substrate

**Use this in a fresh thread.** Paste everything below the line.

---

I'm working on the DPF (Digital Product Factory) codebase at `d:\DPF`. I need you to design the **A2A (agent-to-agent) communication substrate** that lets AI coworkers collaborate productively, including in the background and on schedule, without a human in the loop on every hop.

This is the third part of a three-spec sweep. Two siblings already exist and are **out of scope for this thread** — read them only as context, do not duplicate their content:

- `docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md` — defines the canonical persona schema (every coworker has `# Role`, `# Accountable For`, `# Interfaces With`, `# Out Of Scope`, `# Tools Available`, `# Operating Rules`). This spec will give you the structured `# Interfaces With` section that names peers by `agent_id` — that's the join point your A2A design plugs into.
- `docs/superpowers/specs/2026-04-27-coworker-tool-grant-spec-design.md` — defines the grant catalog and the audit that keeps tool envelopes truthful. A2A messaging itself will likely be gated by a new grant key (probably `coworker_message_send`, `coworker_message_subscribe`); design the grant additions cleanly.

## What you should produce

A design spec at `docs/superpowers/specs/2026-04-27-coworker-a2a-substrate-design.md` covering:

### 1. Current state (grounded inventory, not theory)

Read and cite the actual code. Specifically:

- `apps/web/lib/tak/agent-event-bus.ts` — the existing **in-memory** event emitter. Document exactly what it does, what its event taxonomy is, and why it cannot serve cross-process / cross-restart / scheduled-work needs.
- `apps/web/lib/actions/skill-discovery.ts` — `discoverCoworkerSkills`, `delegateToCoworker` (the synchronous delegation path).
- `apps/web/lib/tak/delegation-authority.ts` — chain-of-custody, depth limits, authority intersection.
- `packages/db/prisma/schema.prisma` — `DelegationChain`, `ScheduledAgentTask`, and any related models.
- `apps/web/lib/queue/functions/agent-task-dispatch.ts` — the cron polling / dispatch path that exists today.
- `packages/db/data/agent_registry.json` — `delegates_to[]` and `escalates_to` per agent.

Map the gaps: what's missing for coworker A↔B messaging that survives a restart, what's missing for scheduled coworker-initiated work, what's missing for fan-out / pub-sub between coworkers.

### 2. Three message classes

Design and motivate three distinct interaction shapes. They must have crisp, non-overlapping semantics so callers know which to pick:

1. **Synchronous request / response** — `delegateToCoworker` extended or replaced. Caller blocks for a result. Used when the parent is reasoning *about* the child's answer.
2. **Asynchronous fire-and-forget** — caller emits a message, doesn't block. Recipient processes when picked up. Used when the parent needs the child to *act* but doesn't gate on the result.
3. **Scheduled / time-triggered** — a coworker (not just admin cron) can schedule itself or a peer to run later, with cron or one-shot semantics. Built on or replacing `ScheduledAgentTask`.

For each: durable storage model, dispatch path, idempotency, retry/dead-letter, observability, and how authority propagates (the delegation-chain pattern already exists for synchronous; extend cleanly to async and scheduled).

### 3. AgentCard adoption

The routing control-plane spec at `docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md` explicitly defers **A2A AgentCard** as a separate concern (see line 12 and §2). This is that concern. Design the AgentCard schema for DPF coworkers — capability advertisement, version, endpoint reference, authentication shape — drawing on the public A2A AgentCard pattern but adapted to the DPF in-process and cross-process realities. Show how the persona spec's `# Accountable For` and `# Interfaces With` sections feed the card content, and how the grant spec's catalog feeds the capability list.

### 4. Background work pattern

Coworkers must be able to:

- Initiate work without a user request (scheduled triggers, event-driven triggers from other coworkers).
- Park long-running work and wake it on a condition or timer.
- Show their work-in-flight in the coworker panel UI as "busy" with a notification when complete (memory: `feedback_agent_as_work_conduit.md` — long-running work shown through coworker panel busy state + notification; `feedback_background_eval_probes.md` — Run Eval / Run Probes should be async, not UI-blocking).

Design how this layers on top of the message classes in §2. Inngest is already in the stack — use it where it fits, but don't propose adding new infrastructure unless the existing infra genuinely can't serve.

### 5. Authority, audit, and refusal

Every A2A message is a tool call from one principal to another. It must carry the same chain-of-custody guarantees as `delegateToCoworker` does today: depth limit, loop detection, authority intersection, recorded in `DelegationChain` (or its successor). Design how async and scheduled paths preserve this. Design how a recipient coworker refuses a message that exceeds its scope (memory: `feedback_proper_fix_over_quick_fix.md`).

### 6. Migration from the in-memory bus

`agent-event-bus.ts` carries 40+ event variants today, used inside a single request's deliberation. Document which of those events should *stay* in-memory (intra-request UI streaming) vs. which should *graduate* to the durable substrate (cross-coworker, cross-restart). The current bus stays — it just stops being asked to do things it was never built for.

## Constraints / context to honor

- DPF is **single-org per install** (no multi-tenancy). All coworkers in one install share one DB. Don't design for cross-org messaging.
- Inngest, Postgres, Neo4j, Qdrant are already in the stack. Prefer them over new infra.
- Memory: `feedback_research_standards_first.md` — A2A AgentCard is an emerging standard; cite the source you're drawing from and recommend it unless there's a project-specific reason not to.
- Memory: `feedback_proper_fix_over_quick_fix.md` — design the architecturally correct substrate, not a shim on top of the in-memory bus.
- Memory: `feedback_consult_specs_first.md` — read the routing control-plane spec and the IT4IT references before designing; don't reinvent.
- The two sibling specs (persona, tool-grant) define schemas you should extend cleanly, not duplicate.

## Form of the output

A single design spec, same shape as the two siblings (`Field | Value` table at the top with Epic / Status / Created / Author / Scope / Depends-on / Out-of-scope / Primary goal; numbered sections with Problem Statement, Non-Goals, Architectural Model, …; ending with Open Questions and Acceptance Criteria).

**Before writing**, give me a 200-word outline with the section headings and a one-line summary of each. I'll confirm or redirect, then you write the spec.
