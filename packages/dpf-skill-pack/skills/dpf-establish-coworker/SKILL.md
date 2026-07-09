---
name: dpf-establish-coworker
description: "Use when creating a NEW AI coworker on the DPF platform, from any dev surface (Claude/Codex session, Build Studio, MCP client) — or when a coworker idea is floated and needs the paved road. Walks the enforced lifecycle: establish a draft through the establish_coworker factory door, complete the code-side definition checklist the CI conformance gate enforces, earn a behavioral certification from the nightly golden-journey sweep, then promote to production. A coworker created any other way ships incomplete and unsummonable; this skill is the single paved road that makes it robust by construction."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob Edit Write Bash mcp__dpf__establish_coworker mcp__dpf__manage_coworker_tool_grant mcp__dpf__query_backlog mcp__dpf__create_backlog_item

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["platform-engineer", "admin-assistant", "build-specialist", "coo"]
capability: manage_platform
taskType: code_generation
triggerPattern: "new coworker|create .* coworker|add .* coworker|establish .* coworker|new agent role|hire .* (ai|digital) (coworker|worker)"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "mcp__dpf__establish_coworker", "mcp__dpf__manage_coworker_tool_grant", "mcp__dpf__query_backlog", "mcp__dpf__create_backlog_item"]
composesFrom: ["dpf-verify-substrate-first", "dpf-file-backlog-item", "dpf-pr-with-dco"]
contextRequirements: []
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/single-source-of-truth
  - kernel/principles/verify-substrate-before-proposing-new
  - kernel/principles/ship-real-functionality
---

# DPF Establish Coworker

The lifecycle is `draft → defined → certified → active`, and it is ENFORCED, not
conventional: a draft coworker is not summonable (lifecycle gate at every chat,
scheduled, and summon/handoff chokepoint), an incomplete definition fails the
required Unit Tests job (coworker-definition conformance gate), and promotion is
refused until the nightly certification sweep has passed the coworker through
its golden journeys on the real execution path.

## Step 0 — Verify the coworker doesn't already exist

Compose `dpf-verify-substrate-first`. Check `COWORKER_AGENT_SEEDS`
(`packages/db/src/workforce-seed.ts`), `agent_registry.json`, and the live
roster. Many "new coworker" ideas are an existing coworker missing a grant or a
route — fix that instead (`manage_coworker_tool_grant`, route binding).

## Step 1 — Establish the draft (factory door)

Call the `establish_coworker` MCP tool with `action: "establish"`:

- `agentId`: kebab-case slug (e.g. `field-safety-auditor`)
- `name`, `description`: display name + one-sentence role
- `valueStream`: explore | evaluate | integrate | consume | operate | cross-cutting
- `sensitivity`: internal | confidential | restricted
- `grants`: keys from the closed grant vocabulary only — unknown keys are
  rejected because a grant no tool honors authorizes nothing (the false-refusal
  failure class)
- `minimumTier`: model floor (default adequate; confidential/regulated work
  should be strong) — a missing floor is how weak local models produce
  fabricated "Done" replies

This creates the DB-side draft (Agent row at `lifecycleStage: "draft"`, grants,
model floor, principal link) and returns the definition checklist. The draft is
visible on the workforce roster but NOT summonable.

## Step 2 — Land the definition (one PR)

The checklist returned by the door is authoritative; it covers, in order:

1. `COWORKER_AGENT_SEEDS` roster entry (`packages/db/src/workforce-seed.ts`)
2. `HARDCODED_COWORKER_GRANTS` in the same file — the DURABLE grant source
   (DB grant rows are re-seeded from this map on every boot)
3. Route binding: `ROUTE_AGENT_MAP` persona (`apps/web/lib/tak/agent-routing.ts`)
   + sensitivity mirror in `route-context-map.ts`
4. Model floor row in `packages/db/src/agent-model-defaults.ts`
5. Profession family in `docs/professions/registry.json`
6. Optional: curated golden journey
   (`apps/web/lib/coworker-lifecycle/golden-journeys.ts` — otherwise the derived
   read-probe certifies it), service-catalog offer, self-task entry

The conformance gate (`apps/web/lib/coworker-lifecycle/
coworker-definition-conformance.test.ts`) fails CI naming any missing axis. Do
NOT extend the baseline for a new coworker — complete the definition. Finish
with `dpf-pr-with-dco`.

## Step 3 — Certify

After the definition PR merges and deploys, the nightly sweep
(`ops/coworker-certification-nightly`, 04:40) exercises the coworker's golden
journeys through the real execution path. To run it immediately, emit the
`ops/coworker-certification.requested` Inngest event. A failed oracle lands as
an assurance finding (`coworker-cert:<agentId>:…`) — fix and re-run. The roster
shows certification state honestly (certified / failed / stale / never).

## Step 4 — Promote

Call `establish_coworker` with `action: "promote"`. Promotion is refused unless
the coworker is (a) in the canonical roster and (b) holds a passing
certification. On success the coworker is `production` and summonable
everywhere.

## Hard rules

- Never create an Agent row by hand or in an ad-hoc seed — the factory door is
  the single entry point; anything else recreates the two-population drift this
  lifecycle exists to close.
- Never grant keys outside the closed vocabulary; never park a new coworker's
  gaps in the conformance baseline.
- A coworker that cannot pass a read-only golden journey does not go to
  production — that is the lifecycle working, not an obstacle to route around.
