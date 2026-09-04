---
name: dpf-establish-coworker
description: "Use when creating a new AI coworker on the DPF platform, or when a coworker idea is floated and needs the paved road."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Edit Write Bash mcp__dpf__establish_coworker mcp__dpf__manage_coworker_tool_grant mcp__dpf__query_backlog mcp__dpf__create_backlog_item

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["platform-engineer", "admin-assistant", "build-specialist", "coo"]
capability: manage_platform
taskType: code_generation
triggerPattern: "new coworker|create .* coworker|add .* coworker|establish .* coworker|new agent role|hire .* (ai|digital) (coworker|worker)"
userInvocable: true
agentInvocable: false
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
   + sensitivity mirror in `route-context-map.ts`. **Prefer an EXISTING page route
   that has no persona yet** (see Step 2.5) — a new top-level route triggers a
   large gate cascade for no benefit; the coworker is summonable everywhere either
   way.
4. Model floor row in `packages/db/src/agent-model-defaults.ts`
5. Profession family in `docs/professions/registry.json` — AND a seeded corpus
   page `docs/professions/<professionKey>/wiki/<slug>.md` (frontmatter: title,
   pageKind, status, abstract, professionCompetencyLevel, sources). The coverage
   lint (`resolve-profession-profile.test.ts`) fails a family with an empty wiki
   dir. Set `contextSlugs` to the route slug the persona binds.
6. Optional: curated golden journey
   (`apps/web/lib/coworker-lifecycle/golden-journeys.ts` — otherwise the derived
   read-probe certifies it), service-catalog offer, self-task entry

The conformance gate (`apps/web/lib/coworker-lifecycle/
coworker-definition-conformance.test.ts`) fails CI naming any missing axis. Do
NOT extend the baseline for a new coworker — complete the definition.

## Step 2.5 — The CI gates BEYOND the conformance gate

The conformance test is necessary but NOT sufficient — several other required
checks fail on a new coworker and the conformance test says nothing about them.
Handle these in the same PR or the PR bounces:

- **Route choice is the biggest lever.** Binding the persona to a **new top-level
  route** cascades into five more gates (below). Bind instead to an EXISTING page
  route that currently has no `ROUTE_AGENT_MAP` entry (e.g. a CRM sub-page like
  `/customer/opportunities` for a research coworker): longest-prefix match makes
  your persona win there, and you touch NONE of the new-route machinery. The
  coworker is summonable globally regardless of route. Only create a new
  route/page when the coworker genuinely needs its own surface.

- **Grant-source consistency** (`packages/db/src/coworker-grant-consistency.test.ts`,
  a `Unit Tests (packages)` shard): a seed-defined coworker's
  `HARDCODED_COWORKER_GRANTS` "diverge" from the `agent_registry.json` mirror
  (which has no entry for it). Add the agentId to `KNOWN_GRANT_DIVERGENCES` in
  `packages/db/src/coworker-grant-consistency.ts` — the sanctioned "seed is the
  runtime grant source; the JSON mirror is intentionally not duplicated" record.
  **This shard usually does NOT run in the local-CI pregate, so it fails only on
  GitHub** — check it explicitly (`pnpm --filter @dpf/db exec vitest run
  src/coworker-grant-consistency.test.ts`) before you push.

- **Seed Contribution Fit** (`scripts/check-seed-fit-decision.mjs`): adding to
  `COWORKER_AGENT_SEEDS` requires a `Seed-Fit-Decision: <value>` trailer in the
  **PR BODY** (not a commit trailer) or a `seed-fit:<value>` label. Values:
  global-default | archetype-scoped | vertical-scoped | parameterize-first |
  install-local-only | reject-as-seed. A broadly-useful coworker → `global-default`.

- **ONLY if you added a new route/page** — regenerate + register each, or CI fails:
  - `pnpm --filter web build:route-manifest`  (Route Manifest Freshness)
  - `pnpm --filter web build:route-shells`     (route-shell registry)
  - `pnpm --filter web build:page-purpose`     — a net-new route also needs a
    ratified/quarantined Page Purpose contract in `apps/web/lib/ux-budget/purpose-contracts/`
  - Navigation inventory gate (`apps/web/lib/ea/navigation-inventory-gate.test.ts`):
    the route's top-level segment must be in the nav model or `KNOWN_NAV_TOPLEVEL`
  - UX-Fit manifest `docs/ux-fit/<date>-<slug>.ux-fit.json` (propose-n-pick with a
    `principle_decide` interactionId, or a sweep-measurement)

- **UX Route Budget Sweep** (GitHub runtime check, not in the local pregate):
  adding a coworker adds it to the GLOBAL coworker selector, so every route's
  sweep sees "choices in one control: N → N+1" and a few more words — a regression
  against the frozen budget baseline on many routes at once. Recovery is a
  reviewed baseline re-freeze (BI-26DA1AEB): `gh workflow run ux-route-sweep.yml
  --ref <branch> -f update_baseline=true`, download the `ux-route-budget-baseline`
  artifact, splice ONLY the affected routes into
  `apps/web/lib/ux-budget/route-budget-baseline.json` (never wholesale-replace),
  and commit. Expect this whenever you add a coworker.

- **Standard doc gates** (same as any PR): Spec/Plan/Doc (a plan under
  `docs/superpowers/plans/`), Docs-Impact (`Docs-Impact-Decision:` trailer or the
  route's user-guide page), design-grounding.

Then finish with `dpf-pr-with-dco`.

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
