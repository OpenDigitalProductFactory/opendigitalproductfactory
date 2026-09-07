# Contributor procedure runbook

**Status:** procedure reference. Collected from `AGENTS.md` §3, §7, §9, §13, §14 and §15 by BI-0020D511 Phase 1. The *rules* from each stay always-on in their original section; everything here is how-to, reference tables, and rationale. No rule was dropped.


> **Canonical identity bridge ⟦runtime: 2026-09-02⟧.** `COWORKER_SLUG_TO_CANONICAL_AGENT_ID`
> in `packages/db/src/agent-identity.ts` now bridges the eight value-stream
> orchestrators and the cross-cutting finance specialist. Seeding a coworker means
> four registries, not one: the roster seed, this bridge, `agent_registry.json`
> status, and a model floor in `AGENT_MODEL_CONFIG_DEFAULTS`. The coworker
> definition conformance gate (LIFE-001/LIFE-005) fails a seed that has the first
> three and not the last two — a coworker with no grants "boots with no tool
> surface", and one with no model floor can be served by a model too weak for it.

## New page routes — regenerate companions (BI-206DAB95)

Adding `apps/web/app/**/page.tsx` requires regenerating **four** derived artifacts. CI fails opaquely if any is stale. One command regenerates all of them against the **current** tree:

```bash
pnpm route:sync
```

That runs, in order:

| Artifact | Generator |
| --- | --- |
| `apps/web/lib/ea/route-manifest.json` | `pnpm --filter web build:route-manifest` |
| `apps/web/lib/ux-budget/route-shells.generated.json` | `pnpm --filter web build:route-shells` |
| `apps/web/lib/navigation/route-audience.generated.json` | `pnpm --filter web build:route-audience` |
| `apps/web/lib/docs/doc-index.generated.json` | `node scripts/gen-doc-index.mjs` |

**Base-drift trap:** regenerate **after** rebasing onto current `origin/main`. Checking/regenerating on a pre-rebase tree reports “fresh” and still fails CI on the merged tree.

**Typecheck heap:** if pre-commit typecheck OOMs, use `NODE_OPTIONS=--max-old-space-size=8192` (or `DPF_SKIP_TYPECHECK=1` only when justified and attested).

## 3. Strongly-Typed String Enums (mandatory)

→ [kernel principle](../professions/data-architect/wiki/strongly-typed-string-enums.md)

DB string columns with fixed valid values are canonical enums. Source of truth: `apps/web/lib/backlog.ts` (`EPIC_STATUSES`, union types) and `apps/web/lib/mcp-tools.ts` (`enum:` arrays). Match exactly.

| Model         | Field      | Valid values                                                                |
| ------------- | ---------- | --------------------------------------------------------------------------- |
| `Epic`        | `status`   | `open`, `in-progress`, `done`                                               |
| `BacklogItem` | `status`   | `open`, `in-progress`, `done`, `deferred`                                   |
| `BacklogItem` | `type`     | `portfolio`, `product`                                                      |
| `BacklogItem` | `workType` | `bug`, `feature`, `chore`, `doc`, `tool`, `skill`, `refactor`               |
| `BacklogItem` | `source`   | `user-request`, `automated-detection`                                       |
| `Agent`       | `kind`     | `orchestrator`, `specialist`, `advisor`, `engineer`, `analyst`, `coordinator` |

Hyphens, not underscores. Adding a new value requires updating both `backlog.ts` and the MCP tool definition in the same commit, before any data uses it.

`Agent.kind` is the coworker role-type facet (EP-COWORKER-RT); its canonical list is `AGENT_KINDS` in `packages/db/src/agent-identity.ts`, enforced by `packages/db/src/agent-identity.test.ts`. `Agent.displayName` is the one human-facing coworker label (free-form Title Case, derived by `resolveAgentIdentity` — not an enum).

`BacklogItem.workType` is the closed *work-type* axis (the WHAT) and `BacklogItem.source` is the closed *intake-origin* axis (the HOW). Together they replace the legacy mixed-axis `source` enum (which had `feature-gap`, `bug`, `tool-gap`, `skill-gap`, `doc-gap`, `user-request`, `automated-detection` in one list). `FeatureBuild.kind` is derived from `workType` at promote time (`workType==="bug" ? "fix" : "feature"`). Spec: [`docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md`](../superpowers/specs/2026-05-30-unified-backlog-worktype-design.md).

## 13. Login & Local QA

- Login email: `admin@dpf.local` unless told otherwise.
- Read the install's admin password from `ADMIN_PASSWORD` in repo-root `.env` — not from `apps/web/.env.local` (which may omit it). Seeded by `packages/db/src/seed.ts` (bcrypt, falls back to `changeme123`); both installers print it in their completion summary. Never copy the value into a tracked file, a commit, a PR body, or an issue.
- **Pick the right browser surface before blaming auth.** An authenticated portal route reached from an agent's own sandboxed/preview browser has NO session and silently redirects to the sign-in chooser — it looks like the portal is broken when it is only anonymous. For any authenticated surface (`/ops/*`, `/build`, `/platform/*`, coworker panels) drive **Claude-in-Chrome**, which carries the operator's existing session. Confirm with `fetch('/api/auth/session')` BEFORE diagnosing anything else; a `null` user there explains most "page won't load" reports (see also the phantom-session case where a stale non-DB session id yields a null lookup — sign out and back in).
- **Agents may sign in to a LOCAL install themselves.** Read `ADMIN_PASSWORD` from repo-root `.env` and type it into the `/login` form of the local, non-production install when driving the in-client browser. This is the normal path when the driven browser has no operator session; prefer an existing operator session when one is already authenticated. Scope limits, all hard: local/non-production installs only — never a hosted, shared or production surface; never a credential other than the seeded local admin; never echo, paste or log the value anywhere it persists (transcript summary, commit, PR body, issue, test fixture).
  ⟦situational: some agent harnesses carry their own blanket ban on entering credentials into any form and will refuse regardless of this rule. On such a host the refusal is a harness limitation, not a DPF rule — say so and fall back to the operator's authenticated session rather than reporting the surface as unverifiable. Re-check on harness upgrades — BI-1E23243F.⟧
- If `/build` or another shell route redirects to `/welcome`, authenticate at `/login` first.
- Verify production-path UI changes against the **canonical local install** only after the target has reached it through `/ops/self-upgrade` / the governed self-upgrade runner, or against a leased shared nonprod environment. Do not use a worktree-local `next dev` / `next build` harness, stale `next dev` sessions, or a direct main-portal compose rebuild as production-path UX evidence. Direct compose rebuilds of `portal`/`portal-init` on the main `dpf` project are recovery/bootstrap actions, not the normal validation path.

## 9. External Tools

→ [kernel principle](../professions/software-engineer/wiki/tool-evaluation-pipeline.md)

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: 6 agents covering security, architecture, compliance, integration. Approved tools are version-pinned in `packages/db/data/approved_tools_registry.json` with re-evaluation scheduled.

- Spec: `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`
- Run: `/project:tool-evaluation`

**Dependency security & pnpm overrides.** Dependabot alerts on this repo are almost all *transitive* npm vulns. Fix them by flooring the package in the `pnpm-workspace.yaml` `overrides:` block — **not** by bumping a manifest. The overrides ARE the fix; reverting/removing them re-introduces the CVEs. Two hard rules, both enforced/tooled so no surface rediscovers them:
- **Every security floor carries a comment naming its `GHSA-…` / `Dependabot #NN` / `CVE-…`.** The Override Provenance Guard (`scripts/check-override-comments.mjs`, `pnpm check:override-comments`) fails CI on an untagged new floor, so the stale-override audit can later check whether the alert is still open.
- **Regenerate the lockfile only via `pnpm regen:lockfile` (`scripts/regen-lockfile.mjs`).** Editing `overrides:` re-resolves the whole tree, and a naive `pnpm install` resolves that offline from the stale local store (`downloaded 0` is the tell) and silently downgrades ~40 unrelated packages to invalid versions. The helper forces fresh metadata via a fresh empty store and proves the diff is scoped + stable.

Runbook skill: `dpf-clear-dependabot-alerts`. Posture / prune / vendoring strategy: `EP-DEP-SOVEREIGNTY` (`docs/superpowers/specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`). Detection / SBOM / SCA: `EP-ASSURANCE-LEDGER` (`docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`).

## 7. Subagent Dispatch Discipline

**Subagents do not read this file.** They only know what the dispatcher prompt tells them. When dispatching: ⟦model: the injected "run the gate and fix errors" lines assume a subagent won't verify unprompted; newer models self-verify⟧

- **For TypeScript work:** include "run `pnpm --filter web typecheck` before committing and fix any errors."
- **For final-task-in-epic work:** include "run `pnpm --filter web build` and fix any errors" plus the required UX verification path. **Instruct the subagent to route that build through the shared local-CI convergence sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) or the canonical local install — not inside the worktree itself.** (See §5 "Where each gate runs" and [kernel principle](../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).)
- **For UI work:** include the Theme-Aware Styling rules from §11. Without them, components ignore the platform's branding system.
- **For any implementation work:** include "perform a documentation impact check; update the relevant docs surface or record a concrete no-docs-needed attestation before claiming done."
- **For governed product surfaces:** register or update the Authorized Surface Contract from the same shared read model that renders the human UX. Keep persistent actions behind `governedExecuteTool`, mark secrets write-only, and run the DOM/accessibility conformance plus governed-surface guard. A route name or raw DOM scrape is not sufficient page knowledge.

## 14. Release Testing

→ [kernel principle](../professions/release-service-management/wiki/release-qa-plan.md)

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with repro steps under the active QA epic. Test results are release evidence. Release QA phases run against the canonical local install or a leased shared nonprod environment per §5 — never against a worktree's local harness. A worktree is the source-control container for the change under test, not a release-QA runtime.

## 15. Communication

- If uncommitted changes exist, mention them before starting new work. → [kernel principle](../founder-kernel/wiki/principles/mention-uncommitted-changes.md)
- When committing, list what's included.
- State results and decisions directly. No running commentary on internal deliberation. → [kernel principle](../founder-kernel/wiki/principles/state-results-directly.md)
- Maintain forward momentum: when the current work naturally implies a next step, name the next smallest useful step from the thread direction and company context. Keep it quiet and operational - no sales pitch, no broad re-planning unless asked.
- End-of-turn summary: one or two sentences — what changed, what's next.
---
- **Name the substrate when reporting verification results.** "Tests passed" or "build succeeded" is incomplete without naming where it ran. State the substrate (canonical local install, shared local-CI convergence sandbox lease, or — for source-local-only gates — the worktree). See §6 for what counts as canonical-runtime evidence and §5 for which gates require it.
---


## 8a. Advise-safe tools, server-action exports, coworker coordination (pointers)

**Advise-safe tool classification (BI-IMP-F710F41C).** A side-effect tool (`sideEffect: true` in `mcp-tools.ts`) may stay visible in **advise mode** only when it (1) preserves human visibility (SSE + UI cards), (2) writes an audit trail (e.g. `ToolExecution` / delegation chain), (3) is grant- and lifecycle-gated, and (4) is listed in a **shared constant** imported by every filter path (see `adviseHeldBackTools` / coworker tool filter). Do not invent a parallel allowlist per route. Prefer pure reads in advise mode; only promote a side-effect into advise when those four hold.

**`"use server"` modules export only functions and concrete values (BI-IMP-21C466DE).** Type aliases and interfaces stay **local** (or live in a non-`"use server"` module). Exporting types from a server-action file breaks Turbopack registration. Prefer `export type` from a sibling `*.types.ts` or `lib/` module.

**Coworker capability filtering is single-source (BI-IMP-60B0893E).** Agent tool grants live in `agent_registry.json` / `AgentToolGrant`; runtime intersection is `getAvailableTools` + `TOOL_TO_GRANTS` + coworker filter helpers under `apps/web/lib/actions/coworker-tool-filter.ts` and `apps/web/lib/tak/agent-grants.ts`. Route-local allowlists that re-express the same policy are defects — extend the shared filter, do not fork it. Peer coordination tools (`request_coworker`, `summon_coworker`) follow the advise-safe pattern above.
