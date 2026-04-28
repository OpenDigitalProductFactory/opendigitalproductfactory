# AI Coworker Persona & Job-Description Audit — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform / AI Coworkers / Governance |
| **Status** | Draft |
| **Created** | 2026-04-27 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | `packages/db/data/agent_registry.json`, `prompts/route-persona/`, `prompts/specialist/`, `apps/web/lib/tak/prompt-loader.ts`, `apps/web/scripts/audit-coworker-personas.ts` (new), `.github/workflows/audit-coworker-personas.yml` (new) |
| **Companion specs** | [2026-04-27-coworker-tool-grant-spec-design.md](./2026-04-27-coworker-tool-grant-spec-design.md) — runs second, depends on this spec's persona schema |
| **Out of scope** | A2A communication substrate (separate thread / spec), runtime persona overrides via Admin > Prompts, model binding, token budgets |
| **Primary goal** | Every agent in the registry has a complete, machine-checkable job description that names its role, accountability, peers, and out-of-scope work — and that fact is enforced by CI, not maintained by hope. |

---

## 1. Problem Statement

The agent registry at [packages/db/data/agent_registry.json](../../packages/db/data/agent_registry.json) declares **53 coworkers** across orchestrator, specialist, and infrastructure tiers. Each registry entry carries a `capability_domain` string (a sentence fragment of duties) plus structured fields for tier, value stream, supervisor, delegation targets, and IT4IT sections.

The narrative persona — what the model actually *reads* when invoked — lives in markdown files under `prompts/route-persona/` (13 files) and `prompts/specialist/` (8 files). That covers **21 personas for 53 agents**. The remaining ~32 agents have only their registry sentence to define them; when invoked, the prompt-loader either falls back to a generic persona or leaves the model to infer its role from context.

Three concrete failure modes follow from this gap:

1. **Hallucinated role boundaries.** An agent without a persona file infers what it does from the user's question rather than from a job description. Two invocations of the same agent on different topics behave like two different agents — no stable accountability.

2. **Drift between registry and persona.** Where personas exist, they are hand-written and not cross-checked against the registry. [coo.prompt.md](../../prompts/route-persona/coo.prompt.md:35-43) lists tool names in prose (`query_backlog`, `propose_file_change`, `read_project_file`) that do not match the registry's grant keys (`backlog_read`, `backlog_write`, `registry_read`). The model is told it has tools the platform never grants, and is not told about tools it actually has. (The grant-side fix lives in the companion tool-grant spec; this spec ensures the persona file *exists* and has the structural slot for tool listing.)

3. **No way to audit at scale.** Asking "does every coworker have a coherent job description?" today requires opening 53 entries by hand and reading each prompt file. There is no canonical schema to check completeness against, and no CI gate to keep it that way as new coworkers are added.

This is the same pattern the routing-spec boot-invariant audit fixed for routing ([2026-04-27-routing-spec-boot-invariants.md](../audits/2026-04-27-routing-spec-boot-invariants.md), CI workflow `.github/workflows/audit-routing-invariants.yml`): formalize the invariants, write a script that fails the build when they drift, run it on every PR. We apply the same shape here.

## 2. Non-Goals

- **Rewriting the personas.** This spec defines the schema and the audit. Filling in the missing persona files is follow-up work, surfaced as backlog items by the audit.
- **Runtime persona editing.** Admin > Prompts already lets operators override `PromptTemplate.content` at runtime; that path is unchanged. The audit reads the seed (canonical source), not the runtime override.
- **Tool-grant correctness.** Whether a coworker's tool list is the right list for its job is the [companion spec's](./2026-04-27-coworker-tool-grant-spec-design.md) problem. This spec only requires the persona to *have a tool-listing section* of the right structural shape.
- **A2A / inter-agent messaging.** Out of scope by request — see the standalone prompt for that thread.
- **Model binding.** Whether AGT-ORCH-300 should run on Opus 4.6 vs. Opus 4.7 is a routing concern, settled by the routing control-plane spec.
- **Adding new coworkers.** This spec audits the existing 53; it doesn't decide whether the roster is right.

## 3. Canonical Persona Schema

A persona file lives at `prompts/<category>/<slug>.prompt.md` where `category ∈ {route-persona, specialist}`. It uses YAML frontmatter plus a markdown body with mandatory sections.

### 3.1 Frontmatter (required fields)

```yaml
---
name: <slug>                          # matches filename, e.g. "coo"
displayName: <human-readable>         # e.g. "COO"
description: <one-line summary>       # one line, ≤ 120 chars
category: route-persona | specialist
version: <integer>                    # bump when content changes meaningfully

# NEW — required by this spec, additive to existing frontmatter
agent_id: <AGT-…>                     # exact match to agent_registry.json agent_id
reports_to: <HR-…> | <AGT-…> | null   # human supervisor or parent orchestrator
delegates_to: [<AGT-…>, …]            # mirrors registry; persona-side cross-check
value_stream: <slug>                  # mirrors registry; "" only for cross-cutting
hitl_tier: 0 | 1 | 2 | 3              # mirrors registry hitl_tier_default
status: active | draft | retired      # persona authoring status, distinct from registry status

# Existing optional fields kept as-is
composesFrom: [<category>/<slug>, …]
contentFormat: markdown
variables: []
sensitivity: public | internal | confidential
perspective: <one-sentence frame>
heuristics: <comma-separated decision frames>
interpretiveModel: <one-sentence success criterion>
---
```

The five new fields make the persona file a **first-class declaration of the agent's identity**, not a loose markdown blob. They are the join keys between the persona and the registry.

### 3.2 Body sections (required, in order)

The audit checks for these six headed sections by literal heading match. Wording inside each section is the author's; presence is mandatory.

1. **`# Role`** — one paragraph: who this coworker is, in role terms.
   Example: *"You are the Integrate Orchestrator. You own the build coordination, release planning, and acceptance-gate workflow for the Integrate value stream."*

2. **`# Accountable For`** — bulleted list of outcomes this coworker owns. Outcomes, not activities.
   Example: *"Build plan exists for every approved spec," "Release gate decision is recorded with rationale," "SBOM is current at every release."*

3. **`# Interfaces With`** — bulleted list naming each peer/parent/child by `agent_id` and the nature of the interface (delegates work to, escalates to, reports to, consumes artifacts from).
   Example: *"AGT-BUILD-SE — delegates implementation tasks to," "AGT-ORCH-200 — receives approved specs from."*

4. **`# Out Of Scope`** — bulleted list of things this coworker explicitly does **not** do, especially boundaries with neighboring roles. This section is what stops role drift at runtime.
   Example: *"Does not author specs (that is AGT-ORCH-200)," "Does not run deployments (that is AGT-ORCH-400)."*

5. **`# Tools Available`** — bulleted list of grant keys this coworker has, mirroring the registry's `tool_grants` exactly. The companion tool-grant spec generates this section; this spec only requires its presence and that it parses as a bulleted list of grant keys.

6. **`# Operating Rules`** — free-form markdown for heuristics, conversation rules, escalation triggers, refusal patterns. This is where the bulk of existing prompt content lands.

The first four sections together are the **job description**. The fifth is the **tool envelope**. The sixth is the **playbook**. Together they answer "who, what, with whom, and how" in a way the audit can check by structure rather than by reading.

### 3.3 Compatibility with existing prompt-loader

[apps/web/lib/tak/prompt-loader.ts](../../apps/web/lib/tak/prompt-loader.ts) reads the markdown body via `PromptTemplate.content` and the frontmatter as JSON via `PromptTemplate.metadata`. The new frontmatter fields land in `metadata` automatically; no schema change required on the runtime path. The body still renders as a single string to the model; the section headings become part of the rendered prompt and add structure the model can lean on.

`composesFrom` continues to work — `specialist/shared-identity` is included by reference, and the audit checks the *fully-composed* output for required sections, not just the leaf file.

## 4. Audit Script

A new script `apps/web/scripts/audit-coworker-personas.ts` runs the invariants. Modeled on [audit-routing-spec-boot-invariants.ts](../../apps/web/scripts/audit-routing-spec-boot-invariants.ts) — same exit-code discipline, same finding-table format.

### 4.1 Inputs

- `packages/db/data/agent_registry.json` — full agent list, source of truth for `agent_id`, `tier`, `value_stream`, `hitl_tier_default`, `delegates_to`, `human_supervisor_id`.
- `prompts/route-persona/*.prompt.md` and `prompts/specialist/*.prompt.md` — persona files on disk.
- `prompts/specialist/shared-identity.prompt.md` and any other `composesFrom` targets — resolved during composition.

The script does **not** read the database. The audit runs against the seed at PR time; runtime overrides are out of scope (operators can drift their override at their own risk).

### 4.2 Invariants (in order of severity)

| ID | Severity | Invariant | Check |
|----|----------|-----------|-------|
| **PERSONA-001** | error | Every registry agent has a persona file | For every `agent_id` in registry, there exists a persona file whose frontmatter `agent_id` matches |
| **PERSONA-002** | error | Every persona file maps to a registry agent | For every persona file, frontmatter `agent_id` exists in registry (orphan personas blocked) |
| **PERSONA-003** | error | Frontmatter has all required fields | All fields in §3.1 marked required are present and non-empty |
| **PERSONA-004** | error | Frontmatter mirrors registry truthfully | `value_stream`, `hitl_tier`, `delegates_to` in persona match registry; mismatches block merge |
| **PERSONA-005** | error | All six body sections present | Composed body contains the six headings of §3.2 in order |
| **PERSONA-006** | error | `# Interfaces With` references resolve | Every `AGT-…` mentioned in this section exists in the registry |
| **PERSONA-007** | warn | `# Tools Available` matches registry grants | Bulleted grant keys are a permutation of the registry's `tool_grants` for this agent. Severity is `warn` here because the companion tool-grant spec promotes it to `error` once that spec lands |
| **PERSONA-008** | warn | `description` ≤ 120 chars | Soft length cap on the one-liner |
| **PERSONA-009** | warn | Persona `status: draft` requires a backlog item | If persona is `draft`, expect a tracking row; advisory only |
| **PERSONA-010** | warn | `composesFrom` targets exist | Every referenced `category/slug` resolves to a real file |

`error` findings exit non-zero and block CI. `warn` findings print to the report but do not block.

### 4.3 Output

Two artifacts, mirroring the routing audit:

1. **Console table** — one row per finding, columns `id | severity | agent_id | file | message`. Printed grouped by severity, errors first.
2. **Markdown report** at `docs/superpowers/audits/2026-04-27-coworker-persona-audit.md` — generated when run with `--write-report`, committed alongside the script in the bootstrapping PR. Subsequent runs in CI print to console only; the report is regenerated on demand.

Exit codes: `0` clean, `1` errors found, `2` script-internal failure (file unreadable, registry malformed).

### 4.4 CI integration

New workflow `.github/workflows/audit-coworker-personas.yml` mirroring [audit-routing-invariants.yml](../../.github/workflows/audit-routing-invariants.yml):

- Triggers: pull_request on paths `packages/db/data/agent_registry.json`, `prompts/route-persona/**`, `prompts/specialist/**`, `apps/web/scripts/audit-coworker-personas.ts`.
- Steps: checkout, pnpm install, run `pnpm --filter @dpf/web exec tsx scripts/audit-coworker-personas.ts`.
- A failing audit blocks merge once the workflow is added to required checks (separate operator step in branch protection settings).

## 5. Bootstrapping the Backfill

The first audit run will produce a large number of findings — roughly 32 missing persona files, plus drift in the existing 21. The plan to land cleanly:

1. **PR 1 — Schema, script, and CI gate, no errors.** Land the schema (§3) as documentation, the audit script (§4) running in **report-only mode** (always exit 0), and the workflow at `continue-on-error: true`. Generate the initial audit report at `docs/superpowers/audits/2026-04-27-coworker-persona-audit.md` so the gap is visible.

2. **PR 2..N — Backfill personas.** Each backfill PR adds persona files for one tier or value stream at a time (e.g., "all evaluate-VS specialists," "all build-VS specialists"). Audit report shrinks with each PR. The author of each backfill PR uses the registry entry plus the canonical schema as a writing template; one persona per file, no batched mega-PRs.

3. **PR final — Promote audit to blocking.** Flip the script to error-on-violation and remove `continue-on-error` from the workflow. From then on, adding a coworker without a persona is a CI failure.

This is the same staged-rollout pattern used for the routing audit. It avoids a merge-blocking PR-1 and keeps the work shippable in pieces.

## 6. Open Questions

- **Should `# Operating Rules` have any structural sub-headings?** The current proposal leaves it free-form. An alternative is to mandate sub-sections like `## Escalation Triggers`, `## Refusal Patterns`, `## Conversation Style`. Recommendation: keep free-form for v1; revisit if persona drift recurs in the rules section specifically.
- **Where do persona authoring guidelines live?** A separate `docs/superpowers/guides/writing-coworker-personas.md` is probably the right home; out of scope for this spec but should be the first artifact produced during PR 2.
- **Do orchestrator personas need a different schema than specialist personas?** The current proposal uses one schema for both, with `tier` distinguishing. If orchestrators end up needing additional structured fields (e.g., a `coordinates_value_stream_stages: [§5.3.1, §5.3.2]` list), revise the schema in v2.

## 7. Acceptance Criteria

This spec is implemented when:

- [ ] `apps/web/scripts/audit-coworker-personas.ts` exists and runs.
- [ ] `.github/workflows/audit-coworker-personas.yml` exists and runs on PRs touching the relevant paths.
- [ ] An initial report at `docs/superpowers/audits/2026-04-27-coworker-persona-audit.md` is committed.
- [ ] Every existing persona file under `prompts/route-persona/` and `prompts/specialist/` either passes the audit or has a tracked backfill item.
- [ ] Every agent in `agent_registry.json` either has a persona file or is listed in the audit report as a known-missing item with a tracked backfill.
- [ ] The schema in §3 is the only authoritative description of a persona file's shape; no competing definition exists in code or docs.
- [ ] Once backfill is complete, the workflow is promoted to a required check in branch protection.
