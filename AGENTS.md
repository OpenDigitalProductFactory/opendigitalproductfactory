# DPF — Agent Rulebook

This is the canonical operating contract for AI agents working in the Digital Product Factory. Read in full before any action. ⟦model: front-loading over progressive disclosure is a model-era call — DI-F844365B0DCC Option B⟧ This root file is the only `AGENTS.md`. ⟦runtime: re-verify with `git ls-files '*AGENTS.md'` — snapshot 2026-07-31⟧

Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) are pointers to this file. Do not duplicate rules into them.

**Governance principles.** Durable doctrine is also published as tiered kernel principles under [`docs/founder-kernel/wiki/principles/`](docs/founder-kernel/wiki/principles/), retrievable via the `wiki_query` MCP tool. This file stays operationally authoritative for its **rules** when MCP is offline; the linked reasoning and the relocated runbooks are reads, not round-trips.

---

## 1. First Principles

Every rule here is a one-line statement; the kernel principle behind it carries the reasoning, and `wiki_query` retrieves it.

- **Never ask the user to run commands.** The user is non-technical; the agent runs the system and reports results. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- **Never assume — verify.** Resolve ambiguity by inspecting the environment, not by pattern-matching context. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/no-assumptions.md)
- **Never fabricate.** Ground every claim in code, specs, or DB state. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)
- **Single source of truth.** Each rule, fact or decision in exactly one place. Pointers, not copies. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)
- **Ground new work in existing platform work.** Inspect the specs, schema, principles, routes, primitives and backlog first; extend or refactor what exists. Net-new substrate only when prior work is proven unfit and the supersession is explicit. → [kernel principle](docs/founder-kernel/wiki/principles/consult-specs-first.md)
- **Architecture over shortcuts.** A quick fix that bypasses the design creates more debt than it saves. → [kernel principle](docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md)
- **Classify ambiguous requests before acting.** When a request could mean more than one work type, stop before code edits and have the operator classify it; prefer the highest-governance reading. → [kernel principle](docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md)
- **Learnings belong in the shared commons.** Route every durable finding to WWMD / WWWD / WSID / code+`AGENTS.md`. Local-only knowledge is a defect. → [kernel principle](docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md)
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. → [kernel principle](docs/founder-kernel/wiki/principles/plan-before-install-paths.md)
- **Fix the seed, not the runtime.** Patch the source, then add an invariant guard. → [kernel principle](docs/professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)
- **Live state over seed data.** Query the database for current epics, backlog, users, capabilities and status. → [kernel principle](docs/professions/data-architect/wiki/live-state-over-seed-data.md)
- **Research and use standards.** Cite sources; recommend the standard unless there is a project-specific reason to deviate. → [kernel principle](docs/founder-kernel/wiki/principles/research-and-use-standards.md)
- **Use paid AI capacity responsibly.** → [kernel principle](docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md)
- **Self-provision before working.** A client missing its `dpf` MCP connector or `dpf-platform` skills converges before doing project work — run the bootstrap script from the repo root, then restart the client. Idempotent; covers all four CLI surfaces. → [Agent Toolchain Bootstrap](docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)


## 2. Project Architecture

Stack, layout conventions, migration/prompt/skill/archetype mechanics and route map: [architecture orientation](docs/architecture/orientation.md) ⟦runtime: living doc — verify pins against `package.json` and the compose files, never cite them from doctrine⟧.

- **Every deployment target wraps the same canonical contracts.** Substrate-specific deltas live in their owning specs; universal rules live in the doctrine. Before adding anything host-coupled (scrape target, service, bind mount, host path, default URL/port, shell builtin), check `docs/install/platform-support-watchlist.md` and add a row when you fix a new platform-specific defect.
- **A migration must apply cleanly against ANY existing data state, not just a clean schema.** Migrations are forward-only and immutable after commit; backfill SQL goes inline in the same migration file.
- **Shell scripts run in Linux containers** (LF only, enforced by `.gitattributes`); **PowerShell scripts target Windows + PS 5.1+** and are plain ASCII only. Use `pnpm --filter <pkg> exec <tool>`, never `npx` — it ignores pinned versions.


## 3. Strongly-Typed String Enums (mandatory)

Generator, migration recipe and the closed-axis list: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Closed-set string fields are typed enums, never free-form strings.** A new closed axis gets a Prisma enum + generated TypeScript union; widening one is a migration, not a string literal. → [kernel principle](docs/professions/data-architect/wiki/strongly-typed-string-enums.md)


## 4. Branching, Commits & PRs

Procedure, recovery steps and rationale: [branch & worktree runbook](docs/architecture/branch-and-worktree-runbook.md). The rules:

- **All changes land via PR against `main`** — including the maintainer's. Branch protection enforces it. → [kernel principle](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **One concern per branch, one concern per PR.** Topic branches named by intent: `feat/`, `fix/`, `chore/`, `doc/`, `clean/<slug>`, branched from `main`. → [kernel principle](docs/founder-kernel/wiki/principles/one-concern-per-pr.md)
- **DCO sign-off on every commit** (`git commit -s`). The DCO bot blocks merge without it. → [kernel principle](docs/founder-kernel/wiki/principles/dco-sign-off-required.md)
- **Always push after committing.** Local-only commits are invisible to CI. → [kernel principle](docs/founder-kernel/wiki/principles/always-push-after-committing.md)
- **PR creation means ready to merge.** A pushed branch — not a PR — is the handoff/recovery artifact while work is in flight. No draft PRs, no `--draft`. Open only when the build gate is green and the author believes it is mergeable. → [kernel principle](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **Merge via the merge queue**, never by hand: `gh pr merge <n> --squash --auto`.
- **Verify merge-readiness mechanically** — `pnpm pr:health [<n>]`, never a visual scan of some checks.
- **One thread = one branch + one worktree**, in the dedicated sibling base. Never share a working tree across sessions. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-per-session.md)
- **Keep the root clone as the merge/release worktree** — read-only for active feature work. → [kernel principle](docs/founder-kernel/wiki/principles/keep-root-clone-as-merge-worktree.md)
- **Worktrees are source-control isolation, not runtime isolation.** Implement and commit from the worktree; route runtime-bound validation through the shared local-CI sandbox lease. Harness friction inside a worktree is a harness limitation, not a product defect. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)
- **Branch guard before implementation and commit:** never build on `HEAD (no branch)` or `main`. Completion requires a pushed branch or PR. → [kernel principle](docs/founder-kernel/wiki/principles/branch-guard-before-implementation.md)
- **Refresh a stale worktree base before serious implementation** (`git fetch origin main`), and **never run a bare `git rebase origin/main`** on this shallow clone — see the runbook for the recovery.

## 5. Verification — Build Gate (mandatory)

→ [kernel principle](docs/founder-kernel/wiki/principles/build-gate-mandatory.md). Where each gate runs, sandbox/portal handling, local hooks and rationale: [build gate runbook](docs/architecture/build-gate-runbook.md).

Work is not complete until all four pass:

1. **Unit tests** — `pnpm --filter <pkg> exec vitest run` for affected files.
2. **Production build** — `pnpm --filter web build` with zero errors. TypeScript errors surface only here, not in `vitest` or IDE checks.
3. **UX verification** — for any UI/agent/coworker/workflow/forms change, exercise the affected path against the running app.
4. **Migration applies cleanly** — if a migration was added.

- **Cheap source-local checks run in the worktree; runtime-bound gates run against the canonical runtime or the shared local-CI sandbox lease** — never inside the worktree. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)
- **Never rebuild the live `dpf` portal by hand.** The main portal update path is `/ops/self-upgrade`, which owns quiescence, recovery points and rollback.
- **Documentation impact is part of done.** Decide whether a change affects users, AI coworkers, positioning, install, operations, architecture, routes, prompts or external-agent behavior; update the right docs surface in the same branch, or record a concrete no-docs-needed reason. Do not claim done while docs exposed to users or coworkers are knowingly stale.
- **Pre-existing failures: note them and fix if feasible. Do not defer silently.**

## 6. Backlog & Planning

Tooling detail, hygiene cadence and the enforced-gate list: [backlog & planning runbook](docs/architecture/backlog-and-planning-runbook.md).

- **Backlog lives in PostgreSQL** (`Epic`, `BacklogItem`) — always query live state before planning or changing backlog work. Use the DPF MCP backlog tools first; a direct-DB fallback must be explicit and stated in the response. → [kernel principle](docs/professions/portfolio-management/wiki/backlog-lives-in-postgresql.md)
- **Work enters as a backlog item; plan before you build.** Specs and plans live under `docs/superpowers/`; check for an existing design before writing a new one, and give a plan live backlog coverage before implementing it.
- **Before creating a new epic, query existing epics for overlap** — prefer extending one over creating a near-duplicate. → [kernel principle](docs/professions/portfolio-management/wiki/check-epic-overlap-before-creating.md)
- **Update status in the DB immediately on completing items**, and record execution evidence as canonical-runtime evidence.


## 7. Subagent Dispatch Discipline

What to inject per work type: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Subagents do not read this file.** ⟦model: the injected "run the gate and fix errors" lines assume a subagent won't verify unprompted; newer models self-verify⟧ They know only what the dispatcher prompt tells them, so the dispatcher owns restating any rule the subagent must honour — the build gate, the UX verification path, theme-aware styling, and the documentation-impact check.


## 8. Tool Authorization

Transport, token issuance/rotation, worktree MCP sync and grant-intersection mechanics: [MCP tool authorization runbook](docs/architecture/mcp-tool-authorization-runbook.md).

- **External coding agents use the MCP JSON-RPC transport at `/api/mcp/v1`.** Bearer tokens follow the `dpfmcp_...` pattern, are issued from Admin > Platform Development > MCP, and live only in local credential files — never commit them.
- **Tokens carry a coarse scope (`read`/`write`/`admin`) plus granular per-tool grants; default tokens are `read` and cannot call side-effecting tools.** Agent `tool_grants` in `agent_registry.json` are enforced at runtime, intersected with the user's role capabilities.
- **Scope escalation is a stop, not a workaround.** On `insufficient_token_scope`, surface the required scope to the operator and stop the MCP workflow. Do not fall back to a direct database or filesystem route to achieve the same effect.
- **Advise-safe tool classification** — stated once in §8a below.

## 8a. Advise-safe tools, server-action exports, coworker coordination

Full statements and BI trail: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **A side-effect tool may stay visible in advise mode only if it is advise-safe** — read-shaped, reversible, and non-committing. Anything else is hidden, not merely warned about.
- **`"use server"` modules export only functions and concrete values.** Type aliases and interfaces stay local or move to a non-server module.
- **Coworker capability filtering is single-source:** grants live in `agent_registry.json` / `AgentToolGrant` and are intersected at runtime — never re-derived per surface. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)


## 9. External Tools

Per-tool setup and invocation reference: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Evaluate an external tool before adopting it** — security, architecture fit, compliance and integration — via the `tool-evaluation` skill. → [kernel principle](docs/professions/software-engineer/wiki/tool-evaluation-pipeline.md)


## 10. Design Research

Checklist detail and worked examples: [design research runbook](docs/architecture/design-research-runbook.md).

- **Every new feature spec must include a "Research & Benchmarking" section before finalization** — compare 2–3 open-source leaders and state what DPF adopts or rejects. → [kernel principle](docs/founder-kernel/wiki/principles/design-research-required.md)
- **Run the minimum architectural-alignment checklist before finalizing a spec:** deployment contracts, canonical identity, no parallel utilities, and no second home for a rule already stated here or in a kernel principle. → [kernel principle](docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md)


## 11. Data Model Stewardship

Micro-primitive inventory, helper boundaries and audit indicators: [data model stewardship runbook](docs/architecture/data-model-stewardship-runbook.md).

- **Audit the existing schema for refactoring opportunities before adding any large feature.** → [kernel principle](docs/professions/data-architect/wiki/schema-audit-before-features.md)
- **`Organization` is the canonical platform identity model.** Any feature needing org name, slug, logo, address or contact reads from it — never a parallel store. → [kernel principle](docs/professions/data-architect/wiki/organization-canonical-identity.md)
- **Use the shared micro-primitives rather than hand-inlining them** — action results, JSON coercion, route constants. A page-local helper under a route segment must not become a second home for a shared concern. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)


## 12. UI — Theme-Aware Styling (mandatory)

Token table, component patterns and migration detail: [theme-aware styling runbook](docs/architecture/theme-aware-styling-runbook.md).

- **No hardcoded colors.** All UI uses the `--dpf-*` CSS custom properties so light mode, dark mode and per-org branding work automatically. Hardcoded hex, `text-white`/`text-black`, and `*-gray-*` utilities are defects. → [kernel principle](docs/founder-kernel/wiki/principles/no-hardcoded-colors.md)
- **Compose from the shared UI primitives** rather than re-implementing surfaces, cards, tables or report chrome per page.


## 13. Login & Local QA

Credentials, seeded personas and the local QA loop: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Never weaken auth to make a test pass.** Use a seeded persona at its real privilege level; if a check blocks you, that is the finding.


## 14. Release Testing

Release test matrix and cadence: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Release validation runs against the canonical runtime via the self-upgrade pipeline**, never a hand-built portal image. → [kernel principle](docs/professions/release-service-management/wiki/release-qa-plan.md)


## 15. Communication

Tone examples and formatting detail: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Report outcomes faithfully.** If tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging. Never claim completion for work that is not finished. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)


## 16. Skill Discovery

Authoring/seeding mechanics, the process-spine health-check contract and `principle_decide` call detail: [skill surfaces runbook](docs/architecture/skill-surfaces-runbook.md). Per-skill catalogue: [agent skill index](docs/architecture/agent-skill-index.md). The precedence rules — they govern behaviour *before* an agent would know to fetch an index — stay here:

- **Dual-surface contract.** DPF platform skills are authored once at `packages/dpf-skill-pack/skills/<slug>/SKILL.md` — the source of truth for both the CLI plugin and in-portal coworker seeding. New DPF skills MUST use that superset format.
- **DPF skills win over generic ones.** Non-DPF packs are not project-default precedent: use `dpf-platform` first, install upstream packs only in local/user scope for a documented gap, and never seed them for in-portal coworkers. Surface A: a DPF skill beats superpowers when both apply. Surface B: a plugin `SKILL.md` beats a legacy `.skill.md` at seed time.
- **A session with retired process skills visible and no DPF replacement is DPF-precedence-unproven** — repair or restart before project work. Cleanup is disable-not-delete: never delete user-owned skill files or plugin caches.
- **Kernel principles (Surface C) are the durable doctrine store.** `wiki_query` for lookup, `principle_decide` for decisions.
- **`principle_decide` features are magnitudes, not goodness ratings.** Score "does this option EXHIBIT this axis?" — and on the five **cost** axes (`blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`, `operator_effort`) **higher is worse**. Supplying one as though higher were better inverts the decision. The closed key set travels in the tool schema; an unknown key is rejected.
- **WWMD vs WWWD — which decision surface governs.** `principle_decide` is the **platform-development (WWMD)** surface. A customer's business decision routes through the Decision Perspective Gate against the org's WWWD profile, which does **not** inherit platform business judgment as authority. Do not use raw `principle_decide` to settle a customer's business question. → [kernel principle](docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md)
- **Work-scope / altitude decisions are platform-owned (WWMD) — consult, don't ask cold.** How much to take on in a pass is a platform decision: route it through `principle_decide` **before** surfacing a menu. Act on a high-confidence recommendation and report the ledger; escalate only on low confidence or a commandment conflict. "Option 1/2/3, you pick" without a ledger is the anti-pattern. Harness-enforced by the `decision-routing-guard` hook; a `[governance-freshness]` warning means treat every decision as guard-off and route it manually.

## 17. Delivery Surfaces & Execution Alignment

Guard implementations, the BI trail and the full §7 decision text: [delivery surfaces runbook](docs/architecture/delivery-surfaces-runbook.md). Single source of truth for the decisions: [unified-delivery-surfaces spec](docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — §7 decisions are WWMD-ratified and final. The contract:

- **Four peer surfaces, one process.** Claude Code, Codex CLI, Grok and the embedded Build Studio are peers running the same process — no surface is mandatory, choose by fit. "Build Studio for all development" is retired. → [kernel principle](docs/founder-kernel/wiki/principles/one-common-process-three-surfaces.md)
- **MCP is the coordination plane.** Work tracking, claims and gate evidence live in the DPF MCP substrate — not in a surface's local state. Large/complex work may run externally and still be centrally tracked. → [kernel principle](docs/founder-kernel/wiki/principles/mcp-is-the-coordination-plane.md)
- **Claim a capsule before you work — every surface, including the external CLIs.** The unit of WIP is the WorkCapsule, not the Build Studio build (founder-directed 2026-06-26).
- **Governance approves evidence, not provenance — the keystone.** A gate reads its required evidence fields; it never asks which surface produced them. → [kernel principle](docs/founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md)
- **Thin adapters behind a stable contract.** The CLIs ship updates frequently; keep surface-specific code at the adapter edge so an upstream release never reaches the process.
- **Hide complexity from layman users.** The coordination plane is backstage; non-technical users see work, status and outcomes.
- **Worktree canonical location = the dedicated sibling base** ⟦runtime: install-local path — Windows shape; §4 gives the macOS/Linux equivalent⟧ for all three CLI surfaces, not the tool-native nesting. Every worktree is born governed and reaped when idle. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-selection-and-reaping.md)
- **Tooling upgrade = operator-triggered quiesce → reap → upgrade → resume.** Orphaned sidecars must never pin a tool against update. → [kernel principle](docs/founder-kernel/wiki/principles/reap-sidecars-to-upgrade-tools.md)
- **`:3001` and every shared singleton are lease-gated** ⟦runtime: install-local port — the lease rule is doctrine, the number is not⟧ via `claim_nonprod_environment_lease`. No per-branch CI images, no silent re-bind, no ad-hoc `docker run`/`compose up` from a surface. **Enforced by `PreToolUse` hooks** — ungoverned dev servers, root-clone mutation, raw Compose against root data volumes, and junction-unsafe worktree removal are all refused, not merely discouraged. → [kernel principle](docs/founder-kernel/wiki/principles/runtime-gates-via-shared-lease.md)
- **The live install advances only via the self-upgrade pipeline, and a built image carries the identity of its bytes** — stamp == built HEAD == target, asserted pre-swap. → [kernel principle](docs/founder-kernel/wiki/principles/image-identity-equals-bytes.md)

