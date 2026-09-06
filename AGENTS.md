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
- **Platform function never depends on a client.** Every guarantee runs server-side, on every install, with no AI client present; a hook may accelerate one, never own it. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md)
- **Single source of truth.** Each rule, fact or decision in exactly one place. Pointers, not copies. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)
- **Ground new work in existing platform work.** Inspect the specs, schema, epics, principles, routes, primitives and backlog first; extend or refactor what exists. Net-new substrate only when prior work is proven unfit and the supersession explicit. → [kernel](docs/founder-kernel/wiki/principles/consult-specs-first.md) · [epics](docs/professions/portfolio-management/wiki/check-epic-overlap-before-creating.md) · [schema](docs/professions/data-architect/wiki/schema-audit-before-features.md) · [substrate](docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md)
- **An enforcement refusal stops work unless a checked-in override records operator authorization for that run.** Use only it; record reason/scope; report **skipped/unrun, never passed**. Never override PR protection, DCO, grant intersection, destructive or production-integrity controls, or route around refusal via DB/filesystem/shell. Otherwise stop. ⟦situational: hook support varies by host; enforce these rules yourself when unverified—review at EP-ANTIGRAVITY-001⟧ → [PR](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md) · [DCO](docs/founder-kernel/wiki/principles/dco-sign-off-required.md) · [lease](docs/founder-kernel/wiki/principles/runtime-gates-via-shared-lease.md)
- **The canonical runtime is the only source of runtime truth.** A hand-built image proves nothing about the live system. Runtime-bound verification, release validation and install advances route through the canonical runtime or shared local-CI lease; the live install advances only via `/ops/self-upgrade` (hand-tagging the image is hook-refused); an image carries the identity of its bytes. → [worktree](docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) · [release QA](docs/professions/release-service-management/wiki/release-qa-plan.md) · [image identity](docs/founder-kernel/wiki/principles/image-identity-equals-bytes.md)
- **Architecture over shortcuts.** A quick fix that bypasses the design creates more debt than it saves. → [kernel principle](docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md)
- **Classify ambiguous requests before acting.** When a request could mean more than one work type, stop before code edits and have the operator classify it; prefer the highest-governance reading. → [kernel principle](docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md)
- **Learnings belong in the shared commons.** Route every durable finding to WWMD / WWWD / WSID / code+`AGENTS.md`. Local-only knowledge is a defect. → [kernel principle](docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md)
- **Commons are curated, not just appended.** Each corpus is reviewed on a cadence by its accountable human for altitude (is this an instance of a rule already here?), lapsed contingency, scope drift, and rules a machine now enforces. Guards nominate; only the human consolidates or retires. A rule true only under conditions carries them in a contingency marker — three clocks: environment, model era, circumstance. → [kernel principle](docs/founder-kernel/wiki/principles/commons-are-curated-not-just-appended.md)
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. → [kernel principle](docs/founder-kernel/wiki/principles/plan-before-install-paths.md)
- **Fix the seed, not the runtime.** Patch the source, then add an invariant guard. → [kernel principle](docs/professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)
- **Live state over seed data.** Query the database for current epics, backlog, users, capabilities and status. → [kernel principle](docs/professions/data-architect/wiki/live-state-over-seed-data.md)
- **Research and use standards.** Cite sources; recommend the standard unless there is a project-specific reason to deviate. → [kernel principle](docs/founder-kernel/wiki/principles/research-and-use-standards.md)
- **Use paid AI capacity responsibly.** → [kernel principle](docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md)
- **An autonomous directive is bounded by descent, not effort.** Fix a blocker of the named objective; hand back at a blocker of *that* blocker, or on a second same-class failure. → [kernel principle](docs/founder-kernel/wiki/principles/autonomous-directives-are-blanket-approval.md)
- **Self-provision before working.** A client missing its `dpf` MCP connector or `dpf-platform` skills converges before doing project work — run the bootstrap script from the repo root, then restart the client. Idempotent; covers all four CLI surfaces. → [Agent Toolchain Bootstrap](docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)


## 2. Project Architecture

Stack, layout conventions, migration/prompt/skill/archetype mechanics and route map: [architecture orientation](docs/architecture/orientation.md) ⟦runtime: living doc — verify pins against `package.json` and the compose files, never cite them from doctrine⟧.

- **Every deployment target wraps the same canonical contracts.** Substrate-specific deltas live in their owning specs; universal rules live in the doctrine. Before adding anything host-coupled (scrape target, service, bind mount, host path, default URL/port, shell builtin), check `docs/install/platform-support-watchlist.md` and add a row when you fix a new platform-specific defect.
- **A migration must apply cleanly against ANY existing data state, not just a clean schema.** Migrations are forward-only and immutable after commit; backfill SQL goes inline in the same migration file.
- **Shell scripts run in Linux containers** (LF only, enforced by `.gitattributes`); **PowerShell scripts target Windows + PS 5.1+** and are plain ASCII only. Use `pnpm --filter <pkg> exec <tool>`, never `npx` — it ignores pinned versions.


## 3. Branching, Commits & PRs

Procedure, recovery steps and rationale: [branch & worktree runbook](docs/architecture/branch-and-worktree-runbook.md). The rules:

- **All changes land via PR against `main`, DCO-signed, scoped to one clean revert.** Including the maintainer's. Topic branches named by intent: `feat/`, `fix/`, `chore/`, `doc/`, `clean/<slug>`, from `main`. → [kernel principle](docs/founder-kernel/wiki/principles/one-concern-per-pr.md)
- **Always push after committing.** Local-only commits are invisible to CI. → [kernel principle](docs/founder-kernel/wiki/principles/always-push-after-committing.md)
- **PR creation means ready to merge.** A pushed branch — not a PR — is the handoff/recovery artifact while work is in flight. No draft PRs, no `--draft`. Open only when the build gate is green and the author believes it is mergeable. → [kernel principle](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **Merge via the merge queue**, never by hand: `gh pr merge <n> --squash --auto`.
- **Verify merge-readiness mechanically** — `pnpm pr:health [<n>]`, never a visual scan of some checks.
- **One thread = one branch + one worktree**, in the dedicated sibling base. Never share a working tree across sessions. Implement and commit from the worktree — it is source-control isolation only (§1), so harness friction inside one is a harness limitation, not a product defect. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-per-session.md)
- **Keep the root clone as the merge/release worktree** — read-only for active feature work. → [kernel principle](docs/founder-kernel/wiki/principles/keep-root-clone-as-merge-worktree.md)
- **Branch guard before implementation and commit:** never build on `HEAD (no branch)` or `main`. Completion requires a pushed branch or PR. → [kernel principle](docs/founder-kernel/wiki/principles/branch-guard-before-implementation.md)
- **Refresh a stale worktree base before serious implementation** (`git fetch origin main`), and **never run a bare `git rebase origin/main`** on this shallow clone — see the runbook for the recovery.

## 4. Verification — Build Gate (mandatory)

→ [kernel principle](docs/founder-kernel/wiki/principles/build-gate-mandatory.md). Where each gate runs, sandbox/portal handling, local hooks, subagent injection lists, and credentials/seeded personas for the QA loop: [build gate runbook](docs/architecture/build-gate-runbook.md) and [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

Work is not complete until all four pass:

1. **Unit tests** — `pnpm --filter <pkg> exec vitest run` for affected files.
2. **Production build** — `pnpm --filter web build` with zero errors. TypeScript errors surface only here, not in `vitest` or IDE checks.
3. **UX verification** — for any UI/agent/coworker/workflow/forms change, exercise the affected path against the running app.
4. **Migration applies cleanly** — if a migration was added.

- **Cheap source-local checks run in the worktree; runtime-bound gates do not** (§1) — never rebuild the live portal by hand; `/ops/self-upgrade` owns quiescence, recovery points and rollback.
- **Tier the gate to the change; the heavy build runs once, in the cloud.** Fast local checks (typecheck, lint, affected tests — no Docker) gate the push; the full build is the cloud merge-queue safety net; docs → lint only. → [process spec](docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md)
- **Documentation impact is part of done.** Decide whether a change affects users, AI coworkers, positioning, install, operations, architecture, routes, prompts or external-agent behavior; update the right docs surface in the same branch, or record a concrete no-docs-needed reason. Do not claim done while docs exposed to users or coworkers are knowingly stale.
- **Pre-existing failures: note them and fix if feasible. Do not defer silently.**
- **Never weaken auth to make a test pass.** Use a seeded persona at its real privilege level; if a check blocks you, that is the finding.
- **A gate that could not run is not a verdict.** Infrastructure failure — a fenced lease, a killed child, a starved host — is recorded as inconclusive and re-runs on the same SHA. Never a FAIL against the diff. Fail closed on safety; fail open on infrastructure. → [kernel principle](docs/founder-kernel/wiki/principles/report-only-the-verdict-you-reached.md)

## 5. Backlog & Planning

Tooling detail, hygiene cadence and the enforced-gate list: [backlog & planning runbook](docs/architecture/backlog-and-planning-runbook.md).

- **Backlog lives in PostgreSQL** (`Epic`, `BacklogItem`) — always query live state before planning or changing backlog work. Use the DPF MCP backlog tools first; a direct-DB fallback must be explicit and stated in the response. → [kernel principle](docs/professions/portfolio-management/wiki/backlog-lives-in-postgresql.md)
- **Work enters as a backlog item; plan before you build.** Specs and plans live under `docs/superpowers/`; check for an existing design before writing a new one, and give a plan live backlog coverage before implementing it. Epic overlap is the §1 check applied to the backlog.
- **Update status in the DB immediately on completing items**, and record execution evidence as canonical-runtime evidence.


## 6. Tool Authorization

- **Discover MCP tools before fallback.** Codex/Grok start with a lean `tools/list`; call `load_tools` by name/query (`search_tool_marketplace` if needed), refresh the list, then declare it absent. → [MCP authorization runbook](docs/architecture/mcp-tool-authorization-runbook.md)
- **External coding agents use the MCP JSON-RPC transport at `/api/mcp/v1`.** Bearer tokens follow the `dpfmcp_...` pattern, are issued from Admin > Platform Development > MCP, and live only in local credential files — never commit them.
- **Tokens carry a coarse scope (`read`/`write`/`admin`) plus granular per-tool grants; default tokens are `read` and cannot call side-effecting tools.** Agent `tool_grants` in `agent_registry.json` are enforced at runtime, intersected with the user's role capabilities. `insufficient_token_scope` is a §1 refusal.
- **A side-effect tool may stay visible in advise mode only if it is advise-safe** — read-shaped, reversible, and non-committing. Anything else is hidden, not merely warned about.
- **`"use server"` modules export only functions and concrete values.** Type aliases and interfaces stay local or move to a non-server module.
- **Coworker capability filtering is single-source:** grants live in `agent_registry.json` / `AgentToolGrant` and are intersected at runtime — never re-derived per surface. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)


## 7. Design Research & External Tools

Checklist detail and worked examples: [design research runbook](docs/architecture/design-research-runbook.md). Per-tool setup and invocation: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Evaluate an external tool before adopting it** — security, architecture fit, compliance and integration — via the `tool-evaluation` skill. → [kernel principle](docs/professions/software-engineer/wiki/tool-evaluation-pipeline.md)
- **Every new feature spec must include a "Research & Benchmarking" section before finalization** — compare 2–3 open-source leaders and state what DPF adopts or rejects. → [kernel principle](docs/founder-kernel/wiki/principles/design-research-required.md)
- **Finalizing a spec runs the §1 check at spec altitude:** deployment contracts, canonical identity, no parallel utilities, no second home for a rule already stated here or in a kernel principle.


## 8. Data Model Stewardship

Micro-primitive inventory, helper boundaries, audit indicators, and the enum generator + migration recipe: [data model stewardship runbook](docs/architecture/data-model-stewardship-runbook.md) and [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md).

- **Closed-set string fields are typed enums, never free-form strings.** A new closed axis gets a Prisma enum + generated TypeScript union; widening one is a migration, not a string literal. → [kernel principle](docs/professions/data-architect/wiki/strongly-typed-string-enums.md)
- **`Organization` is the canonical platform identity model.** Any feature needing org name, slug, logo, address or contact reads from it — never a parallel store. → [kernel principle](docs/professions/data-architect/wiki/organization-canonical-identity.md)
- **Compose from the shared micro-primitives** — action results, JSON coercion, route constants. A page-local helper under a route segment must not become a second home for a shared concern. Schema audit before a large feature is the §1 check at data-model altitude. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)


## 9. UI — Theme-Aware Styling (mandatory)

Token table, component patterns and migration detail: [theme-aware styling runbook](docs/architecture/theme-aware-styling-runbook.md).

- **No hardcoded colors.** All UI uses the `--dpf-*` CSS custom properties so light mode, dark mode and per-org branding work automatically. Hardcoded hex, `text-white`/`text-black`, and `*-gray-*` utilities are defects. → [kernel principle](docs/founder-kernel/wiki/principles/no-hardcoded-colors.md)
- **Compose from the shared UI primitives** rather than re-implementing surfaces, cards, tables or report chrome per page.


## 10. Communication

Tone examples and formatting detail: [contributor procedure runbook](docs/architecture/contributor-procedure-runbook.md). Release test matrix and cadence live in the same runbook; release validation itself is the §1 canonical-runtime rule.

- **Report outcomes faithfully.** If tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging. Never claim completion for work that is not finished. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)


## 11. Skill Discovery

Authoring/seeding mechanics, the process-spine health-check contract and `principle_decide` call detail: [skill surfaces runbook](docs/architecture/skill-surfaces-runbook.md). Per-skill catalogue: [agent skill index](docs/architecture/agent-skill-index.md). The precedence rules — they govern behaviour *before* an agent would know to fetch an index — stay here:

- **Dual-surface contract.** DPF platform skills are authored once at `packages/dpf-skill-pack/skills/<slug>/SKILL.md` — the source of truth for both the CLI plugin and in-portal coworker seeding. New DPF skills MUST use that superset format.
- **DPF skills win over generic ones.** Non-DPF packs are not project-default precedent: use `dpf-platform` first, install upstream packs only in local/user scope for a documented gap, and never seed them for in-portal coworkers. Surface A: a DPF skill beats superpowers when both apply. Surface B: a plugin `SKILL.md` beats a legacy `.skill.md` at seed time.
- **A session with retired process skills visible and no DPF replacement is DPF-precedence-unproven** — repair or restart before project work. Cleanup is disable-not-delete: never delete user-owned skill files or plugin caches.
- **Kernel principles (Surface C) are the durable doctrine store.** `wiki_query` for lookup, `principle_decide` for decisions.
- **`principle_decide` features are magnitudes, not goodness ratings.** Score "does this option EXHIBIT this axis?" — and on the five **cost** axes (`blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`, `operator_effort`) **higher is worse**. Supplying one as though higher were better inverts the decision. The closed key set travels in the tool schema; an unknown key is rejected.
- **WWMD vs WWWD — which decision surface governs.** `principle_decide` is the **platform-development (WWMD)** surface. A customer's business decision routes through the Decision Perspective Gate against the org's WWWD profile, which does **not** inherit platform business judgment as authority. Do not use raw `principle_decide` to settle a customer's business question. → [kernel principle](docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md)
- **WWMD resolves platform direction.** Reuse settled direction; consult `principle_decide` for open trade-offs. Inspect facts; escalate unresolved judgment or authority. See [decision doctrine](docs/founder-kernel/wiki/principles/consult-scopes-before-asking.md).

## 12. Delivery Surfaces & Execution Alignment

Guard implementations, the BI trail and the full §7 decision text: [delivery surfaces runbook](docs/architecture/delivery-surfaces-runbook.md). Single source of truth for the decisions: [unified-delivery-surfaces spec](docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — §7 decisions are WWMD-ratified and final. The contract:

- **Four peer surfaces, one process.** Claude Code, Codex CLI, Grok and the embedded Build Studio are peers running the same process — no surface is mandatory, choose by fit. "Build Studio for all development" is retired. → [kernel principle](docs/founder-kernel/wiki/principles/one-common-process-three-surfaces.md)
- **MCP is the coordination plane.** Work tracking, claims and gate evidence live in the DPF MCP substrate — not in a surface's local state. Large/complex work may run externally and still be centrally tracked. → [kernel principle](docs/founder-kernel/wiki/principles/mcp-is-the-coordination-plane.md)
- **Claim a workroom before you work — every surface, including the external CLIs.** The unit of WIP is the Workroom (founder-directed 2026-06-26, renamed 2026-08-15), not the Build Studio build. → [kernel principle](docs/founder-kernel/wiki/principles/claim-a-workroom-before-you-work.md)
- **Governance must earn its cost.** Reuse relevant evidence and authorization; a phase change alone needs no fresh consent. Gates serve a decision or protection, not ceremony or client identity. See [evidence doctrine](docs/founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md).
- **One resilient pipeline, enforced by gates not client rigor.** Compile-ready worktree, fast local gate, evidence contract at workroom transition, cloud heavy-build safety net, liveness reaping — every surface applies it because each stage is a platform gate. → [process spec](docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md) · EP-056D2A5E
- **Thin adapters behind a stable contract.** The CLIs ship updates frequently; keep surface-specific code at the adapter edge so an upstream release never reaches the process.
- **Hide complexity from layman users.** The coordination plane is backstage; non-technical users see work, status and outcomes.
- **Worktree canonical location = the dedicated sibling base** ⟦runtime: install-local path — Windows shape; §3 gives the macOS/Linux equivalent⟧ for all three CLI surfaces, not the tool-native nesting. Every worktree is born governed and reaped when idle. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-selection-and-reaping.md)
- **Tooling upgrade = operator-triggered quiesce → reap → upgrade → resume.** Orphaned sidecars must never pin a tool against update. → [kernel principle](docs/founder-kernel/wiki/principles/reap-sidecars-to-upgrade-tools.md)
- **`:3001` and every shared singleton are lease-gated** ⟦runtime: install-local port — the lease rule is doctrine, the number is not⟧ via `claim_nonprod_environment_lease`. No per-branch CI images, no silent re-bind, no ad-hoc `docker run`/`compose up` from a surface. Hook-refused, so §1's refusal rule governs what to do when one fires.
- **A built image carries the identity of its bytes** — stamp == built HEAD == target, asserted pre-swap.
