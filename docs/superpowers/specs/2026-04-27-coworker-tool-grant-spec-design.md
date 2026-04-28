# AI Coworker Tool Grant Audit & Specification — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform / AI Coworkers / Governance |
| **Status** | Draft |
| **Created** | 2026-04-27 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | `packages/db/data/agent_registry.json`, `skills/**/*.skill.md`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/mcp-tools.ts`, `prompts/route-persona/`, `prompts/specialist/`, `apps/web/scripts/audit-coworker-tool-grants.ts` (new), `.github/workflows/audit-coworker-tool-grants.yml` (new) |
| **Depends on** | [2026-04-27-coworker-persona-audit-design.md](./2026-04-27-coworker-persona-audit-design.md) — persona schema's `# Tools Available` section is the join point this spec automates |
| **Out of scope** | A2A communication substrate, model binding, runtime grant overrides per-conversation, capability-derived dynamic grants (a separate routing/grant overhaul) |
| **Primary goal** | One source of truth for what each coworker can do; every other surface (skill manifests, persona prompts, runtime grant table) is generated or audited against it. Over-grants and under-grants become CI failures, not runtime mysteries. |

---

## 1. Problem Statement

A coworker's effective tool envelope is currently the union of three independently-maintained lists, each with its own author and update cadence:

1. **`config_profile.tool_grants[]` in [agent_registry.json](../../packages/db/data/agent_registry.json)** — flat array of grant-key strings, seeded into `AgentToolGrant` (Prisma schema line 1582). This is what the runtime authorization layer enforces.
2. **`allowedTools:` frontmatter in `skills/**/*.skill.md`** — per-skill list, seeded into `SkillDefinition`. A coworker that runs a skill gets the skill's `allowedTools` *for the duration of that skill execution*, layered on top of its standing grants.
3. **`YOUR TOOLS:` prose in [prompts/route-persona/*.prompt.md](../../prompts/route-persona/coo.prompt.md:35-43)** — hand-written, model-facing list. This is the only one the model itself sees; the other two are platform-side.

These three lists are never cross-checked. Concrete consequences observed:

- **`coo.prompt.md` tells the model it has `query_backlog`, `propose_file_change`, `read_project_file`.** The registry grants the COO `backlog_read`, `backlog_write`, `registry_read`, etc. The names don't match. The model calls a name it was told to call; the platform looks up a different name; the call either fails or routes to a fallback. Either outcome is opaque to the operator.
- **Build-VS specialists like `build-specialist.prompt.md` list no tools at all.** The model is told nothing about its envelope; it discovers tools by trying. This is the "agent fabricated `verificationOut`" pattern's nearest cousin — the model invents a plausible API surface because the prompt didn't tell it the real one.
- **No detection of over-grants.** AGT-ORCH-000 has 12 grants; AGT-ORCH-300 has 12 grants; some of those overlap heavily, some don't, and there's no analysis of "does this coworker actually need `build_promote`, given that its job description says nothing about promotion?" The grant table grew by accretion.
- **No detection of under-grants.** A skill assigned to AGT-BUILD-SE may declare `allowedTools: [generate_code, edit_sandbox_file, run_sandbox_command]`. If the coworker's standing grant set lacks the runtime authority to even invoke the skill (e.g., missing a `skill_invoke` grant or a tool-class grant the skill assumes), the failure surfaces as a denied tool call mid-execution, not as a configuration error at boot.

The fix is the same shape as the persona spec: **one canonical declaration, one audit script, one CI gate**. The other two surfaces become derived.

## 2. Non-Goals

- **Rewriting the grant model.** Capability-first vs. role-pinned grants is its own design (called out as out-of-scope in the routing control-plane spec). This spec works within the existing `AgentToolGrant` model.
- **Adding new tools.** The audit catches misalignment between existing tools and grants; it does not propose tool additions or removals beyond surfacing them as findings.
- **Skill-marketplace activation.** The `skills/` directory has more skills authored than are seeded; this spec doesn't change which skills are active, only checks that *active* skills' tool requirements are satisfied by their assigned coworkers' grants.
- **Runtime grant elevation.** Mechanisms for an agent to request a temporary grant for a specific task are out of scope; this spec audits standing grants only.
- **A2A messaging.** Separate thread.

## 3. Architectural Model — One Source, Three Derivations

```
                  ┌──────────────────────────────────────┐
                  │        agent_registry.json           │
                  │   tool_grants[]  per agent_id        │  ← single source of truth
                  └──────────────┬───────────────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
        ▼                        ▼                         ▼
┌────────────────┐      ┌────────────────┐        ┌────────────────────┐
│ AgentToolGrant │      │ Persona file   │        │ Skill manifests    │
│  (DB, seeded)  │      │ # Tools section│        │ allowedTools must  │
│  enforces auth │      │ generated/     │        │ ⊆ assigned-agent's │
│                │      │ checked        │        │ standing grants    │
└────────────────┘      └────────────────┘        └────────────────────┘
```

**Registry is canonical.** The DB grant table is its mechanical projection (handled by existing seed). The persona's `# Tools Available` section is generated from the registry (or audited to match). Each skill's `allowedTools` is checked against the standing grants of every coworker the skill is `assignTo`'d to.

This makes drift impossible *by construction* in the persona path (it's generated) and *detectable at PR time* in the skill path (audit). The grant table itself stays the runtime authority — nothing about the dispatch hot path changes.

## 4. Grant Catalog

The registry today references grant keys by string (`backlog_read`, `iac_execute`, …) without a central definition of what each key authorizes or which tool implementations honor it. This spec adds an explicit catalog.

### 4.1 New file: `packages/db/data/grant_catalog.json`

```jsonc
{
  "version": "1.0.0",
  "grants": [
    {
      "key": "backlog_read",
      "description": "Read backlog items, epics, and status counts. Read-only.",
      "category": "backlog",
      "honored_by_tools": ["query_backlog", "list_backlog_items", "get_backlog_item"],
      "sensitivity": "internal",
      "implies": []
    },
    {
      "key": "backlog_write",
      "description": "Create and update backlog items. Includes implicit read.",
      "category": "backlog",
      "honored_by_tools": ["create_backlog_item", "update_backlog_item"],
      "sensitivity": "internal",
      "implies": ["backlog_read"]
    },
    // … one entry per grant key currently in agent_registry.json
  ]
}
```

Fields:
- **`key`** — the string used in `tool_grants[]`. Stable identifier.
- **`description`** — one sentence, operator-facing.
- **`category`** — coarse grouping for UI / audit reporting (`backlog`, `registry`, `build`, `infra`, `governance`, `external`).
- **`honored_by_tools`** — the tool names (matching `mcp-tools.ts` definitions) that check this grant. The audit verifies that every tool in this list actually checks the grant in code, and that no tool checks a grant key the catalog doesn't define.
- **`sensitivity`** — `public | internal | confidential`. Used by the persona audit to ensure a `sensitivity: public` persona file doesn't list grants of higher sensitivity.
- **`implies`** — transitive grants. `backlog_write` implies `backlog_read`, so a coworker with the former is treated as having the latter for audit purposes. Avoids hand-listing both in every registry entry.

The catalog is a flat JSON file, not a Prisma table. It's seed-time configuration, not runtime state, and changes go through PR review like the registry itself.

### 4.2 Migration of existing grant keys

The first task under this spec is to extract every distinct grant key currently used in `agent_registry.json`, create a catalog entry for each, and verify each is honored by at least one tool implementation in `apps/web/lib/mcp-tools.ts`. Findings produced during this extraction (orphan grants, undocumented categories) drive the first audit report.

## 5. Audit Script

A new script `apps/web/scripts/audit-coworker-tool-grants.ts`. Same shape as the persona audit and routing audit.

### 5.1 Inputs

- `packages/db/data/agent_registry.json` — `tool_grants[]` per agent.
- `packages/db/data/grant_catalog.json` — grant definitions and tool mappings.
- `skills/**/*.skill.md` — `allowedTools` and `assignTo` frontmatter.
- `apps/web/lib/mcp-tools.ts` — tool definitions, including their grant-check sites.
- `prompts/route-persona/*.prompt.md` and `prompts/specialist/*.prompt.md` — for cross-checking the `# Tools Available` section produced by the persona spec.

### 5.2 Invariants

| ID | Severity | Invariant | Check |
|----|----------|-----------|-------|
| **GRANT-001** | error | Every grant key in registry exists in catalog | Set diff: `registry.tool_grants ⊆ catalog.grants[].key` |
| **GRANT-002** | error | Every catalog grant is honored by at least one tool | For each catalog grant, at least one tool in `honored_by_tools` exists in `mcp-tools.ts` |
| **GRANT-003** | error | Every tool that checks a grant declares the grant in catalog | Static scan of `mcp-tools.ts` for grant-check call sites; the checked key must be in catalog |
| **GRANT-004** | error | Skill `allowedTools` ⊆ effective grants of every assigned agent | For each skill, for each agent in `assignTo` (or all agents if `["*"]`), every tool in `allowedTools` must be honored by some grant the agent has (transitively via `implies`) |
| **GRANT-005** | warn | No agent has unused grants | A grant key on an agent that none of its assigned skills or known invocation paths exercise is flagged. Warn-only because some grants are reserved for future skills |
| **GRANT-006** | error | Persona `# Tools Available` section matches registry | Persona's bulleted grant keys are a permutation of the registry `tool_grants` for that agent (was PERSONA-007 in the persona spec; promoted to error here) |
| **GRANT-007** | error | No grant of higher sensitivity than persona's frontmatter `sensitivity` | A `sensitivity: public` persona cannot have `confidential` grants |
| **GRANT-008** | warn | Orchestrator/specialist tier matches grant category profile | Heuristic check: orchestrators should have `*_read` and `*_triage` grants; specialists should have at least one write/execute grant. Advisory; flags suspicious shapes (e.g., a specialist with read-only grants is probably mis-tiered) |
| **GRANT-009** | error | `assignTo: ["*"]` skills' `allowedTools` are honored by every agent | Wildcard-assigned skills constrain the floor of every agent's grant set |
| **GRANT-010** | warn | Grant key naming convention | `<noun>_<verb>` pattern (`backlog_read`, `iac_execute`); flags off-pattern keys for stylistic consistency |

### 5.3 Output

Mirrors the persona audit:

- Console table grouped by severity, errors first.
- Markdown report at `docs/superpowers/audits/2026-04-27-coworker-tool-grant-audit.md` when run with `--write-report`.
- Per-agent breakdown: each agent's full effective grant set (registry + transitive `implies`), the skills it can run, and the tools each skill needs. This breakdown is the artifact operators use to answer "what can this coworker actually do?"

### 5.4 CI workflow

`.github/workflows/audit-coworker-tool-grants.yml`, triggered on PR paths: `packages/db/data/agent_registry.json`, `packages/db/data/grant_catalog.json`, `skills/**`, `apps/web/lib/mcp-tools.ts`, `prompts/**` (for GRANT-006), `apps/web/scripts/audit-coworker-tool-grants.ts`.

Promoted to required check after the bootstrapping PR (§7) lands clean.

## 6. Persona Generation

Once the catalog and audit are in place, the `# Tools Available` section of each persona file becomes **machine-generated**, not hand-written. A small script (`apps/web/scripts/regenerate-persona-tools-section.ts`, called by a pre-commit hook or as a `pnpm` task) does the following for each persona file:

1. Read the persona's `agent_id`.
2. Look up the registry's `tool_grants[]` for that agent.
3. Replace the `# Tools Available` section's body with a generated bulleted list of `<grant_key> — <description from catalog>`.
4. Leave all other sections untouched.

The generator is idempotent. Running it on a clean tree produces no diff. A persona PR that hand-edits this section will lose the edit on the next regeneration — which is the right behavior, because the registry is canonical.

This eliminates GRANT-006 violations by construction, leaving GRANT-001..005 as the meaningful invariants the audit enforces on every PR.

## 7. Bootstrapping

Three-stage rollout, mirroring the routing audit and persona audit:

1. **PR 1 — Catalog + audit script + CI gate, report-only.** Extract grant keys from the registry, hand-write `grant_catalog.json` entries, land the audit script with `continue-on-error`, generate the initial report. Findings are visible but non-blocking. This PR depends on the persona spec's PR 1 having landed (so the persona schema's `# Tools Available` section exists as a slot).

2. **PR 2..N — Reconciliation.** One PR per category of findings:
   - Backfill missing catalog entries.
   - Fix tool implementations that check undeclared grants.
   - Resolve over-grants by removal (with a one-line rationale per removed grant in the PR description).
   - Resolve under-grants by either adding the grant or constraining the skill.
   Each PR shrinks the report.

3. **PR final — Promote to blocking + enable persona generation.** Flip audit to error-on-violation, remove `continue-on-error`, and run the persona-tools-section generator across all persona files in one mechanical commit. From then on, drift is a CI failure.

## 8. Open Questions

- **Should the catalog live in the registry rather than a separate file?** Argument for: one file to read. Argument against: registry is per-agent, catalog is per-grant; mixing them complicates schema validation. Recommendation: keep separate, both under `packages/db/data/`.
- **Should `implies` chains be allowed to be longer than one hop?** A `backlog_admin` that implies `backlog_write` that implies `backlog_read` is convenient but makes audit reasoning harder. Recommendation: allow multi-hop, but the audit reports the *transitive closure* in the per-agent breakdown so operators see the full effective set.
- **Do skill-injected tools need to appear in the persona?** If AGT-BUILD-SE has a standing grant set that excludes `external_web_fetch` but a skill it can run injects that capability for the skill's duration, does the persona say so? Recommendation: persona shows standing grants only; skill manifests document their own injected scope.

## 9. Acceptance Criteria

This spec is implemented when:

- [ ] `packages/db/data/grant_catalog.json` exists and contains an entry for every grant key referenced in `agent_registry.json`.
- [ ] `apps/web/scripts/audit-coworker-tool-grants.ts` exists and runs.
- [ ] `.github/workflows/audit-coworker-tool-grants.yml` exists and runs on the relevant paths.
- [ ] An initial report at `docs/superpowers/audits/2026-04-27-coworker-tool-grant-audit.md` is committed.
- [ ] `apps/web/scripts/regenerate-persona-tools-section.ts` exists and is idempotent.
- [ ] Every persona's `# Tools Available` section is generated, not hand-written.
- [ ] Every skill in `skills/` either passes the `allowedTools ⊆ assigned-agent grants` check or has a tracked reconciliation item.
- [ ] After bootstrap, the audit is a required check in branch protection.
- [ ] No tool implementation in `mcp-tools.ts` checks a grant key absent from the catalog.
