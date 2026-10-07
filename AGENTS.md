# DPF — Agent Rulebook

This is the canonical operating contract for DPF agents. Read this core, then only the task references that apply. Nested generated instructions may add framework constraints; they do not replace this contract. ⟦model: task routing and disclosure are measured, not assumed — BI-3CC35D24⟧

Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) are pointers to this file. Do not duplicate rules into them.

**Governance principles.** Durable doctrine is also published as tiered kernel principles under [`docs/founder-kernel/wiki/principles/`](docs/founder-kernel/wiki/principles/), retrievable via the `wiki_query` MCP tool. This file stays operationally authoritative for its **rules** when MCP is offline; the linked reasoning and the relocated runbooks are reads, not round-trips.

---

## Start with the task

- **Broken upgrade, portal, MCP or CI:** read the local [recovery routing reference](packages/dpf-skill-pack/skills/dpf-systematic-debugging/references/recovery-routing.md) before applying ordinary coordination prerequisites. Recovery must not depend on the component being repaired. This selects an existing authorized procedure; it grants no override.
- **Normal delivery:** use §3–5 and claim the existing backlog/workroom. Run `pnpm gate:context` for constraints on the actual diff. Load one applicable DPF skill, then its references as needed; do not preload the skill catalog or all runbooks.
- **Known blocker:** `node scripts/gate-context.mjs --situation <normal|upgrade-failed|mcp-unavailable|ci-unavailable|permission-denied|break-fix-occupied>` prints a bounded local brief without portal or Git access. Classify from observed evidence; an occupied queue is not an outage.
- **Task brief:** keep objective, affected scope, applicable procedure, next tools, required evidence and stop condition. Refresh when facts change. Existing workroom stage briefs and gate context supply this information; do not paste the whole rulebook into each tool.

## 1. First Principles

Every rule here is a one-line statement; the kernel principle behind it carries the reasoning, and `wiki_query` retrieves it.

- **Never ask the user to run commands.** The user is non-technical; the agent runs the system and reports results. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- **Never assume — verify.** Resolve ambiguity by inspecting the environment, not by pattern-matching context. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/no-assumptions.md)
- **Never fabricate.** Ground every claim in code, specs, or DB state. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)
- **Platform function never depends on a client.** Servers guarantee agentic recovery across executor or credential changes; hooks only accelerate. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md)
- **Single source of truth.** Each rule, fact or decision in exactly one place. Pointers, not copies. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)
- **Ground new work in existing platform work.** Inspect the specs, schema, epics, principles, routes, primitives and backlog first; extend or refactor what exists. Net-new substrate only when prior work is proven unfit and the supersession explicit. → [kernel](docs/founder-kernel/wiki/principles/consult-specs-first.md) · [epics](docs/professions/portfolio-management/wiki/check-epic-overlap-before-creating.md) · [schema](docs/professions/data-architect/wiki/schema-audit-before-features.md) · [substrate](docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md)
- **Distinguish authorization denial from platform failure.** A refusal blocks the denied action, not unrelated authorized repair. If platform coordination is unavailable, explicit operator authorization permits bounded source repair in a governed worktree; record scope and skipped gates, then reconcile evidence after recovery. Never bypass grant intersection, PR protection, DCO, destructive or production-integrity controls, or route around authorization denial via DB/filesystem/shell. Report unrun checks as unrun, never passed.
- **The canonical runtime is the only source of runtime truth.** A hand-built image proves nothing about the live system. Runtime-bound verification, release validation and install advances route through the canonical runtime or shared local-CI lease; the live install advances only via `/ops/self-upgrade` — agents request it with `request_self_upgrade`, which waits for the maintenance window, never the operator's "Upgrade now" button (hand-tagging the image is hook-refused); an image carries the identity of its bytes. → [worktree](docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) · [release QA](docs/professions/release-service-management/wiki/release-qa-plan.md) · [image identity](docs/founder-kernel/wiki/principles/image-identity-equals-bytes.md)
- **Architecture over shortcuts.** A quick fix that bypasses the design creates more debt than it saves. → [kernel principle](docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md)
- **Classify ambiguous requests before acting.** When a request could mean more than one work type, stop before code edits and have the operator classify it; prefer the highest-governance reading. → [kernel principle](docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md)
- **Learnings belong in the shared commons.** Route every durable finding to WWMD / WWWD / WSID / code+`AGENTS.md`. Local-only knowledge is a defect. → [kernel principle](docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md)
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. → [kernel principle](docs/founder-kernel/wiki/principles/plan-before-install-paths.md)
- **Fix the seed, not the runtime.** Patch the source, then add an invariant guard. → [kernel principle](docs/professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)
- **Live state over seed data.** Query the database for current epics, backlog, users, capabilities and status. → [kernel principle](docs/professions/data-architect/wiki/live-state-over-seed-data.md)
- **Research and use standards.** Cite sources; recommend the standard unless there is a project-specific reason to deviate. → [kernel principle](docs/founder-kernel/wiki/principles/research-and-use-standards.md)
- **Self-provision before working.** A client missing its `dpf` MCP connector or `dpf-platform` skills converges before doing project work — run the bootstrap script from the repo root, then restart the client. Idempotent; covers all four CLI surfaces. → [Agent Toolchain Bootstrap](docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)


## 2. Project Architecture

Before changing this surface, read [orientation](docs/architecture/orientation.md).

---

## 3. Branching, Commits & PRs

All changes land through a DCO-signed PR against `main`; never push directly to `main`. One thread = one branch + one worktree in the dedicated sibling base. Keep the root clone read-only for feature work. Refresh `origin/main`; never use bare rebase on a shallow clone. Commit from a named topic branch and push it. Open a PR only when ready, never draft; merge through the queue and verify with `pnpm pr:health`.

Procedure and domain rules: [branch and worktree runbook](docs/architecture/branch-and-worktree-runbook.md). Read before this phase.

---

## 4. Verification — Build Gate (mandatory)

Run affected unit tests and package typecheck locally; heavy build runs in cloud/shared governed runtime, never a hand-built live image. Exercise UI/agent/workflow changes against the served target; apply added migrations. Docs need lint only. Reuse valid evidence. Infrastructure failure is inconclusive/unrun, never a product failure or pass. Update affected docs in the same branch. Recovery uses the task route above.

Procedure and domain rules: [build gate runbook](docs/architecture/build-gate-runbook.md). Read before this phase.

---

## 5. Backlog & Planning

Normal work enters the live PostgreSQL backlog and has a plan before implementation. Use MCP first; state any authorized direct-DB fallback. Reuse an existing spec and give plans live backlog coverage. Declare the delivery shape when claiming a workroom. Record canonical evidence and update completed status promptly.

Procedure and domain rules: [backlog and planning runbook](docs/architecture/backlog-and-planning-runbook.md). Read before this phase.

---

## 6. Tool Authorization

Discover before fallback: Codex/Claude use a full catalog with host-side lazy attachment; other clients default to core. Use `load_tools` by name/query, then refresh or use the programmatic catalog. Discovery cannot grant access. External agents use `/api/mcp/v1`; keep credentials local and uncommitted. Effective authority intersects token scope, coworker grants and user capabilities. A permission refusal stops the denied operation.

Procedure and domain rules: [mcp tool authorization runbook](docs/architecture/mcp-tool-authorization-runbook.md). Read before this phase.

---

## 7. Design Research & External Tools

Before changing this surface, read [design research runbook](docs/architecture/design-research-runbook.md).

---

## 8. Data Model Stewardship

Before changing this surface, read [data model stewardship runbook](docs/architecture/data-model-stewardship-runbook.md).

---

## 9. UI — Theme-Aware Styling (mandatory)

Before changing this surface, read [theme aware styling runbook](docs/architecture/theme-aware-styling-runbook.md).

---

## 10. Communication

Report outcomes and verification faithfully. Name failing, skipped and unrun checks; never claim incomplete work is done. Run commands for the user, and keep coordination details backstage.

Procedure and domain rules: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md). Read before this phase.

---

## 11. Skill Discovery

Read the [skill index](docs/architecture/agent-skill-index.md) only to find an applicable skill. DPF skills take precedence over generic packs. Author once at `packages/dpf-skill-pack/skills/<slug>/SKILL.md` for CLI and portal. Repair missing DPF replacements; cleanup disables competitive packs and never deletes user-owned skills.

- **Kernel principles (Surface C) are the durable doctrine store.** `wiki_query` for lookup, `principle_decide` for decisions.

Reuse settled WWMD platform direction; WWWD business and WSID profession decisions stay in their owning scope. `principle_decide` scores magnitudes, not goodness: on the five **cost** axes (`blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`, `operator_effort`) **higher is worse**.

Procedure and domain rules: [skill surfaces runbook](docs/architecture/skill-surfaces-runbook.md). Read before this phase.

---

## 12. Delivery Surfaces & Execution Alignment

Claude, Codex, Grok and Build Studio are peer execution surfaces; none is mandatory. Normal work claims a Workroom through MCP and follows one gated process. Reuse authorization and evidence across phases; no new consent solely for a phase change. Shared singleton runtimes require the canonical lease. Live advances use `/ops/self-upgrade` (agents via `request_self_upgrade`, which waits for the window); image identity must match its bytes. Recovery follows the independent task route above, without weakening production integrity.

Procedure and domain rules: [delivery surfaces runbook](docs/architecture/delivery-surfaces-runbook.md). Read before this phase.

---
