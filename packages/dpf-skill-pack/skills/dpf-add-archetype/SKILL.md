---
name: dpf-add-archetype
description: "Use when adding a new business archetype, industry, or vertical the DPF storefront taxonomy does not yet cover."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Edit Write Bash mcp__dpf__principle_decide mcp__dpf__query_backlog mcp__dpf__create_backlog_item mcp__dpf__establish_coworker

# DPF fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["platform-engineer", "ea-architect", "coo"]
capability: manage_platform
taskType: code_generation
triggerPattern: "new archetype|add .* archetype|new industry|new vertical|add .* vertical|archetype for|cover .* industry"
userInvocable: true
agentInvocable: false
allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "mcp__dpf__principle_decide", "mcp__dpf__query_backlog", "mcp__dpf__create_backlog_item", "mcp__dpf__establish_coworker"]
composesFrom: ["dpf-verify-substrate-first", "dpf-decision-via-kernel", "dpf-file-backlog-item", "dpf-writing-plans", "dpf-establish-coworker", "dpf-pr-with-dco"]
contextRequirements: []
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/verify-substrate-before-proposing-new
  - kernel/principles/single-source-of-truth
  - kernel/principles/architecture-over-shortcuts
---

# DPF Add Archetype

A complete archetype provisions **four** things, not one. The taxonomy substrate
is only dimension 1; an archetype that ships that alone is present but shallow.
This skill walks all four and ends at the completeness gate that enforces them.

Design: `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`.
Coworker-side sibling this mirrors: `dpf-establish-coworker`.

## The four dimensions

| # | Dimension | Home | Gate tier |
|---|---|---|---|
| 1 | Template substrate | `packages/storefront-templates` + ~16 category-keyed consumers | Tier 1 — blocks all |
| 2 | Profession corpus (WSID) | `docs/professions/<family>/wiki/*.md` | Tier 2 — blocks new |
| 3 | AI coworker | `COWORKER_AGENT_SEEDS` / `establish_coworker` | Tier 2 — blocks new |
| 4 | Skills & tools | `skills/<category>/*.skill.md` + grants | Tier 2 — blocks new |

## Step 0 — Verify it isn't already covered

Compose `dpf-verify-substrate-first`. The most common "new archetype" is really:

- a missing **leaf** on an existing category (add the leaf, not a category); or
- a **variant** expressible by an axis value (e.g. cold storage is a
  temperature attribute on a custody leaf, not its own category).

`grep -rl "<nearest-existing-category>"` to enumerate the ~16 touchpoints you
will mirror. Watch the reverse trap too: a name that *looks* reusable may not
be — `inventory-specialist` is the IT-estate coworker, not a warehouse one.

## Step 1 — Research + route the taxonomy shape

Research the market and the open standards it aligns to (cite sources — the
research-and-use-standards principle). Compose `dpf-decision-via-kernel`: score
2–4 candidate taxonomy shapes through `principle_decide`
(`ringScope: ["ring-3-archetype", "universal-ring"]`). Record the returned
ledger id in the design doc. New category vs new-leaf vs new-axis-value is the
decision this step exists to make.

## Step 2 — File the BI + write the design doc (one plan)

Compose `dpf-file-backlog-item` then `dpf-writing-plans`. The design doc must
name the **four-dimension provisioning plan**, not just the template — a
`## Provisioning plan` section listing the corpus pages, the coworker decision,
and the skills, so reviewers see the whole archetype, not half of it.

## Step 3 — Implement the template substrate (dimension 1)

The Tier-1 touchpoints (all required — the gate blocks any category missing one):

1. `ArchetypeCategory` union — `packages/storefront-templates/src/types.ts`
2. leaves module + register in `packages/storefront-templates/src/archetypes/index.ts`
3. `PROFESSION_ARCHETYPES` — `packages/db/src/wiki-taxonomy.ts`
4. `INDUSTRY_OPTIONS` (+ length test) — `apps/web/lib/storefront/industries.ts`
5. finance profile — bespoke `archetypeCategory` entry **or** a category default
6. value-stream defaults — `operational-value-stream.ts` (commercial model /
   demand / capacity; add a new stage/`CapacityUnitType` only if the operating
   loop genuinely needs one, as custody's `receive-store` did)
7. twin template mapping — `twin-profile.ts` (add a new `TwinTemplate` only for a
   genuinely new spatial grammar; `DOCK` was the 13th)

Graceful-default consumers (populate for correct UX, but they fall back safely):
`archetype-vocabulary.ts`, `marketing-playbooks.ts`,
`archetype-business-context.ts`, `workspace-home/profiles.ts` (**and register any
new component key in BOTH `registry.ts` and the `types.ts` union — a mismatch
typechecks clean then fails the production build**), `demo-flavor.ts`,
`archetype-supply-manifest.ts`, `contribution-review.ts`, `public-web-tools.ts`.

## Step 4 — Provision the corpus (dimension 2)

At least one WSID page per the frontmatter contract, in
`docs/professions/<family>/wiki/`, declaring the category in
`professionArchetype:`. Bind the profession family in
`docs/professions/registry.json`. These are the profession techniques the
archetype's coworker retrieves — the dispatch heuristics, compliance gates, and
craft rules that make its advice competent rather than generic. Ground them in
cited standards (open-class sources fetched; licensed-class checklist-only).

## Step 5 — Decide the coworker (dimension 3)

Every archetype gets a recorded coworker decision — one of:

- **Extend an existing coworker**: record in the design doc *which* one and
  *why* no new one is needed (e.g. a shared role already covers the value
  stream). This is a legitimate, common outcome.
- **New coworker**: run `dpf-establish-coworker` end to end (its own enforced
  `draft → defined → certified → active` lifecycle).

"No decision recorded" is the failure this dimension exists to prevent.

## Step 6 — Skills & tools (dimension 4)

Author archetype-relevant `skills/<category>/*.skill.md` where the coworker needs
a capability the generic set lacks, and grant the tools via the coworker's grant
map. Reuse before authoring.

## Step 7 — Run the gate + finish

```
node scripts/check-archetype-completeness.mjs
```

Tier 1 must pass for every category. A **new** category must clear the full
depth floor (≥1 corpus page + a coworker decision) — it is NOT added to the
grandfather baseline; that list only shrinks. Then finish with `dpf-pr-with-dco`,
carrying the `Seed-Fit-Decision:` and `Design-Grounding-Decision:` trailers in
the PR body.

## Hard rules

- Never ship a new category template-only. The gate blocks it; do not add a new
  category to the grandfather baseline to get around the gate — that baseline is
  pre-existing debt that ratchets down, never a parking spot for new work
  (mirrors "never park a new coworker's gaps in the conformance baseline").
- A new category vs a new leaf is a kernel-routed decision, not a reflex —
  route it (Step 1). Most ideas are leaves.
- Corpus grounded in cited standards, never invented. A profession page with no
  source is a fabrication, not craft.
