# AGENTS.md Principle Inventory

**Date:** 2026-05-13
**Author:** Claude (design partner) for Mark Bodman
**Purpose:** Classify every rule in [`AGENTS.md`](../../../AGENTS.md) (158 lines) as a candidate principle for promotion to the founder-kernel wiki, or as an operational rule that stays inline. Lands before the actual Phase 4 promotion PR so tier assignments are reviewable on their own.
**Phase:** Phase 4 prep — principles-as-wiki-kind plan
**Audit scope:** every paragraph or bullet that could plausibly be a durable principle. Pure-operational mechanics (commands, paths, exact procedures, token formats) are listed under §Keep-inline.

---

## 1. Commandment-tier candidates (≤10 cap)

These are non-negotiable doctrine — DPF doesn't function correctly without them, and there is no realistic context where they should be overridden. Promotion to commandment must clear the cap of 10 published kernel commandments enforced by the `principle-commandment-cap-exceeded` lint detector.

| # | Rule | AGENTS.md section | Already crystallized? |
|---|------|-------------------|------------------------|
| C1 | **Never fabricate.** Ground claims in code, specs, or DB state — not training patterns. | §1 First Principles | feedback memory: `feedback_evidence_before_diagnosis.md` (closely related) |
| C2 | **Research and use standards before designing.** Cite sources; recommend the standard unless deviating for a project-specific reason. | §1 First Principles | feedback memory: `feedback_research_standards_first.md` |
| C3 | **Single source of truth.** Each rule, fact, or decision lives in exactly one place. Pointers, not copies. | §1 First Principles | new |
| C4 | **Architecture over shortcuts.** Choose the architecturally sound solution. Quick fixes that bypass the design create more debt than they save. | §1 First Principles | feedback memory: `feedback_architecture_over_shortcuts.md` |
| C5 | **All changes land via PR against `main`.** No direct pushes; branch protection enforces it. | §4 Branching | feedback memory: `feedback_pr_based_workflow.md` |
| C6 | **DCO sign-off required on every commit.** `git commit -s`. | §4 Branching | feedback memory: `feedback_dco_signoff_required.md` |
| C7 | **Build Gate (mandatory):** unit tests + production build + UX verification + clean migration. Work is not complete until all four pass. | §5 Verification | new |
| C8 | **No hardcoded colors; use theme tokens.** All UI uses CSS custom properties (`var(--dpf-text)` etc.) so light/dark/branding work automatically. | §12 UI | feedback memory: implied in `feedback_actionable_coworker_responses.md` and chief-architect plan reviews |

**Cap math:** Phase 3 lands 1 commandment (HITL at Phase Boundaries from PR #566) + these 8 here = 9. Headroom: 1 commandment slot before the lint blocks further promotions. PR #565's three principles are core-tier; safe.

**Open question for review:** Is `Build Gate (C7)` really one commandment or four? The plan's §5.1 says commandments express ONE durable governance rule each; the Build Gate is a four-part contract. Reviewer call: keep as one combined commandment (preferred) or split into four (uses 4 slots).

---

## 2. Core-tier candidates

These are strong defaults that govern most decisions but can yield to commandments or to specific operational exceptions. Targets ~20-30 total across the kernel.

| # | Rule | AGENTS.md section | Already crystallized? |
|---|------|-------------------|------------------------|
| K1 | **Fix the seed, not the runtime.** Recurring config/data regressions mean the seed wasn't patched. Patch source + invariant guard. | §1 First Principles | feedback memory: `feedback_fix_seed_not_runtime.md` |
| K2 | **Live state over seed data.** For current epics, backlog, users, capabilities, query the DB. Treat seed as bootstrap defaults only. | §1 First Principles | feedback memory: `feedback_never_ask_about_infra_state.md` (related) |
| K3 | **Strongly-typed string enums.** DB string columns with fixed valid values are canonical enums; update enum source + MCP tool definition in the same commit. | §3 Enums | new |
| K4 | **One concern per branch, one concern per PR.** Topic branches named by intent. | §4 Branching | new |
| K5 | **One thread = one branch + one git worktree.** Never share a working tree across concurrent sessions. | §4 Branching | feedback memory: `feedback_worktree_per_session.md` |
| K6 | **Branch guard before implementation.** `git branch --show-current` must not be `main` or detached before serious work; completion requires a pushed branch or PR. | §4 Branching | new |
| K7 | **Backlog lives in PostgreSQL.** Query live state before planning or changing backlog work. | §6 Backlog | new |
| K8 | **External tools pass the Tool Evaluation Pipeline before adoption.** Six agents covering security / architecture / compliance / integration; results pinned in `approved_tools_registry.json`. | §9 External Tools | new |
| K9 | **Design Research required for every new feature spec.** Compare 2-3 OSS + 2-3 commercial products; document adopted patterns, rejected patterns, anti-patterns, gaps. | §10 Design Research | new |
| K10 | **Audit existing schema before adding large features.** Refactor before bolting on new tables. | §11 Data Model Stewardship | new |
| K11 | **`Organization` is the canonical platform identity model.** Anything needing org name, slug, logo, address reads from `Organization` — not from bespoke fields. | §11 Data Model Stewardship | new |
| K12 | **Principal convergence.** New identity-bearing entities after 2026-05-09 model as `PrincipalAlias` linked to a `Principal`, not parallel identity tables. | §11 Data Model Stewardship | new |
| K13 | **Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases).** Failures get a backlog item under the active QA epic. | §14 Release Testing | new |
| K14 | **State results directly; no running commentary on internal deliberation.** | §15 Communication | feedback memory: `feedback_actionable_coworker_responses.md` (related but distinct) |

---

## 3. Contextual-tier candidates

Situational rules — applies in specific contexts only, narrow blast radius, less weight in decision aggregation.

| # | Rule | AGENTS.md section | Already crystallized? |
|---|------|-------------------|------------------------|
| X1 | **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. Use `writing-plans`. | §1 First Principles | new |
| X2 | **Always push after committing.** Local-only commits are invisible to CI. | §4 Branching | new |
| X3 | **Keep the root clone as the merge/release worktree.** Read-only for active feature work; topic worktrees go alongside. | §4 Branching | new |
| X4 | **DB fallback must be explicit.** When MCP backlog tools unavailable, query Postgres directly AND say you used DB fallback. | §6 Backlog | feedback memory: `feedback_never_ask_about_infra_state.md` (overlaps) |
| X5 | **Before creating a new epic, query existing epics for overlap.** | §6 Backlog | feedback memory: `feedback_pr_overlap_check_before_pushing.md` (related shape) |
| X6 | **If uncommitted changes exist, mention them before starting new work.** | §15 Communication | new |

---

## 4. Already promoted in earlier batches (skip — no new work)

These have already landed via Phase 3 PRs or were promoted by other contributors:

- **Use paid AI capacity responsibly** (§1) → promoted as `responsible-capacity-utilization` (Phase 3b PR #570)
- **Human-in-the-Loop at Phase Boundaries** is its own AI coworker development principle (PR #566)
- The three data-architecture principles from PR #565 (`one-data-model`, `trust-the-data-spine`, `contextualize-before-transforming`) cover similar conceptual ground but are tagged for data-architecture not agent governance

**Action:** Reviewer confirms these are out-of-scope for Phase 4. The AGENTS.md sections that reference them get pointer paragraphs in the Phase 4.2 promotion PR.

---

## 5. Keep-inline-only (operational mechanics, not principles)

These are commands, paths, version-pinned configurations, or step-by-step procedures. They must stay in AGENTS.md because they are the operational contract the agent runs against — the agent reads AGENTS.md before any MCP retrieval can happen. Promoting them would force every agent to query the wiki before knowing how to do its job.

- §2 Project Architecture stack list (Next.js 16, pnpm workspaces, Docker Compose service set, etc.)
- §2 Deployment doctrine pointer (one line; the spec it points to is the principle source)
- §2 Shell scripts encoding rules (LF endings, `pnpm --filter` not `npx`)
- §2 PowerShell scripts ASCII restriction
- §2 Migration directory + immutability + Prisma command
- §2 Backfill SQL inline rule
- §2 Prompts location + frontmatter pattern
- §2 Skills location + ownership rule
- §2 Portal archetype + vocabulary resolution
- §2 Portal route conventions
- §3 Enum table (the specific Epic/BacklogItem status/type values)
- §4 Squash-and-delete merge command
- §4 Worktree MCP seed scripts
- §5 Pre-commit hook command and bypass env var
- §5 Build Studio mirror status note
- §6 MCP tool list (`list_backlog_items`, `get_backlog_item`, etc.) and endpoint `/api/mcp/v1`
- §6 Specs/plans locations
- §6 Epic auto-close behavior + hygiene mechanic
- §7 Subagent dispatch checklist
- §8 MCP transport, token format, grant intersection algorithm, ToolExecution audit fields
- §9 Tool Evaluation Pipeline spec link + slash command
- §12 Theme token table (the specific class names)
- §12 Exceptions list (white-on-accent buttons, `<option>` styling)
- §13 Login email, admin password location, redirect behavior, Docker rebuild command
- §14 QA plan location

---

## 6. Cap-math summary

After Phase 3 + 4:

| Tier | Phase 3 | Phase 4 (this audit) | Total kernel principles |
|------|---------|----------------------|--------------------------|
| Commandment | 1 (HITL) | +8 candidates | 9 — within cap of 10 |
| Core | 11 (8 AI-coworker + 3 data-architecture) | +14 candidates | 25 — within soft cap of 30 |
| Contextual | 0 | +6 candidates | 6 — uncapped |

Commandment headroom after Phase 4: 1 slot. If reviewer splits Build Gate (C7) into four separate commandments, we exceed the cap by 3; one of C1-C6 or C8 would need to demote to core to fit, OR Build Gate stays as one commandment (preferred — the Build Gate IS a single contract, just with four checks).

---

## 7. Promotion sequence (after this audit lands)

1. **This PR (audit only)** — review and approve tier assignments.
2. **Phase 4.2 commandment PR** — author the 8 commandment kernel pages from §1 above. Each replaces the corresponding AGENTS.md prose with a one-line pointer to the kernel page.
3. **Phase 4.2 core PR** — author the 14 core kernel pages from §2. Same pointer pattern for AGENTS.md.
4. **Phase 4.2 contextual PR** — author the 6 contextual kernel pages from §3.
5. **AGENTS.md preamble update** — add the "for durable governance principles, query `wiki_query` with `pageKind='principle'` when MCP is available" pointer near the top, only after the external MCP tools (PR #564) are confirmed merged and visible to `registry_read` tokens.

Each promotion PR follows the Phase 3 template: kernel markdown + manifest bump + replace AGENTS.md prose with pointer. The all-operational §Keep-inline rules stay untouched throughout.

---

## 8. Open questions

1. **Build Gate as one or four commandments?** (See §1 above.) Reviewer call.
2. **Section §7 Subagent Dispatch Discipline** — could "Subagents do not read this file" become a principle, OR is it operational reality not durable governance? Currently classified as Keep-inline.
3. **`Communication` section §15** — most bullets are conventions about how the agent should talk; only "State results directly" feels durable enough for promotion. The rest stay inline.
4. **Some §2 Project Architecture rules (e.g., "treat `packages/db/src/seed.ts` as bootstrap defaults only")** overlap with K1 / K2. Should the AGENTS.md sentences be replaced with pointers to the kernel pages once K1/K2 promote?

## 9. Refs

- BI: `BI-EBDFBA34` (umbrella)
- Epic: `EP-TAK-3F9A21`
- Spec: [`docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md`](../specs/2026-05-12-principles-as-wiki-kind-design.md) §1.1 (verified-state audit) and §15 (Phase 4)
- Plan: [`docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md`](../plans/2026-05-12-principles-as-wiki-kind.md) Phase 4
