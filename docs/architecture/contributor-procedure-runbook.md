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

Coworker tool authority resolves through `lib/coworker-identity.ts` to one
canonical Agent row for administrator actions, tokens, runtime reads and profile
reports. Runtime alias records still own their skills and service references.
Do not combine grants across those records or replace revoked database state
with registry defaults. See the
[administrator reconciliation procedure](../user-guide/coworker-permission-reconciliation.md).

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

**Typecheck compiler:** `scripts/run-tsc.mjs` type-checks with TypeScript 7, the native compiler (BI-2B8D67A9); it has no V8 heap to exhaust. `DPF_TSC=6` runs the workspace's TypeScript 6 instead, with the 8 GB heap that version needs for `apps/web`. Use it to compare verdicts, not as a workaround. `DPF_SKIP_TYPECHECK=1` remains only for a justified, attested skip.

## 3. Strongly-Typed String Enums (mandatory)

→ [kernel principle](../professions/data-architect/wiki/strongly-typed-string-enums.md)

DB string columns with fixed valid values are canonical enums. Source of truth: `apps/web/lib/backlog.ts` (`EPIC_STATUSES`, union types) and `apps/web/lib/mcp-tools.ts` (`enum:` arrays). Match exactly.

| Model         | Field      | Valid values                                                                |
| ------------- | ---------- | --------------------------------------------------------------------------- |
| `Epic`        | `status`   | `open`, `in-progress`, `done`                                               |
| `BacklogItem` | `status`   | `triaging`, `open`, `in-progress`, `awaiting-acceptance`, `done`, `deferred`, `retired` |
| `BacklogItem` | `type`     | `portfolio`, `product`                                                      |
| `BacklogItem` | `workType` | `bug`, `feature`, `chore`, `doc`, `tool`, `skill`, `refactor`               |
| `BacklogItem` | `source`   | `user-request`, `automated-detection`                                       |
| `Agent`       | `kind`     | `orchestrator`, `specialist`, `advisor`, `engineer`, `analyst`, `coordinator` |

Hyphens, not underscores. Adding a new value requires updating both `backlog.ts` and the MCP tool definition in the same commit, before any data uses it.

`Agent.kind` is the coworker role-type facet (EP-COWORKER-RT); its canonical list is `AGENT_KINDS` in `packages/db/src/agent-identity.ts`, enforced by `packages/db/src/agent-identity.test.ts`. `Agent.displayName` is the one human-facing coworker label (free-form Title Case, derived by `resolveAgentIdentity` — not an enum).

`BacklogItem.workType` is the closed *work-type* axis (the WHAT) and `BacklogItem.source` is the closed *intake-origin* axis (the HOW). Together they replace the legacy mixed-axis `source` enum (which had `feature-gap`, `bug`, `tool-gap`, `skill-gap`, `doc-gap`, `user-request`, `automated-detection` in one list). `FeatureBuild.kind` is derived from `workType` at promote time (`workType==="bug" ? "fix" : "feature"`). Spec: [`docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md`](../superpowers/specs/2026-05-30-unified-backlog-worktype-design.md).

## Routine maintenance and recovery authority

Report the evidence and continue routine repair within current scoped operator
authorization. Do not ask for ratification solely because a diagnosis precedes
a mutation or a task changes phase. A diagnosis never grants authority: missing
authorization, material scope expansion and consequential actions retain their
actual governing gates. Honor host and tool refusals; a shell, database or
alternate client is never a remedy for an authorization denial.

For a stale toolchain declaration, inspect the signed updater's dry-run before
applying changes. The declaration describes the loaded connection, not the files
currently on disk. Request one client restart only when the dry-run finds no
relevant file, connector, credential-wiring or plugin-pin repair. Continue
independent authorized work. For required repairs, reuse
existing authorization only within its scope; the dry-run never approves its own
application. Keep signature, expected-installation identity and client settings
checks. Record a refused apply and its supported remedy rather than retrying it
through another execution path.
## 13. Login & Local QA

- Login email: `admin@dpf.local` unless told otherwise.
- Read the install's admin password from `ADMIN_PASSWORD` in repo-root `.env` — not from `apps/web/.env.local` (which may omit it). Seeded by `packages/db/src/seed.ts` (bcrypt, falls back to `changeme123`); both installers print it in their completion summary. Never copy the value into a tracked file, a commit, a PR body, or an issue.
- **Establish the verification session before diagnosing auth.** A preview or automation browser may have no portal session and redirect to the sign-in chooser. Inspect `/api/auth/session` in the driven browser, then use the platform-owned sign-in procedure below when granted. Use the supported browser on the current client; no particular client or operator session is required. A null or stale session calls for restoring that verification session. A real authorization refusal remains a finding, not a reason to switch identities.
- **Agents own authenticated verification on declared DEV/test installs.** Read the canonical installation context from MCP initialization or `get_my_coworker_profile` before applying an environment assumption. Its `installationContext` reports host capability, stance and operating instructions; a coworker's `lifecycleStage` does not classify the install. Routine granted exercise and local test credential management require no repeated operator hand-off. Environment never widens token/coworker grants, capabilities, action gates or paired-peer limits.
- **Use the platform-owned browser sign-in.** Call `issue_ux_verification_sign_in` with the intended `nextPath` and open its one-time link in the driven browser. The tool resolves DEV/test permission, issues an audited automation persona session and requires no password entry. Keep the link and credentials out of transcripts, commits, PRs, issues and fixtures. Use an existing authenticated session when suitable. Production sign-in remains subject to the tool's explicit recorded operator grant; a refusal stops the refused action and names its supported remedy.
- **Local seeded-admin credentials remain a fallback on verified local nonproduction installs.** When platform sign-in is unavailable and the harness permits credential entry, read `ADMIN_PASSWORD` from the install's ignored local `.env` and use `/login`. Never use this fallback on a hosted/shared/production surface or with another credential. A harness-level credential-entry refusal does not make DPF require the operator's browser: first discover and use the platform-owned sign-in route. If no authorized route works, report the concrete unavailable capability or denial.
- If `/build` or another shell route redirects to `/welcome`, inspect its session and response before inferring a login failure. Establish the platform-owned verification session when permitted; use the local credential fallback only under its stated conditions.
- Verify production-path UI changes against the **canonical local install** only after the target has reached it through `/ops/self-upgrade` / the governed self-upgrade runner, or against a leased shared nonprod environment. Do not use a worktree-local `next dev` / `next build` harness, stale `next dev` sessions, or a direct main-portal compose rebuild as production-path UX evidence. Direct compose rebuilds of `portal`/`portal-init` on the main `dpf` project are recovery/bootstrap actions, not the normal validation path.

## 9. External Tools

→ [kernel principle](../professions/software-engineer/wiki/tool-evaluation-pipeline.md)

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: 6 agents covering security, architecture, compliance, integration. Approved tools are version-pinned in `packages/db/data/approved_tools_registry.json` with re-evaluation scheduled.

- Spec: `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`
- Run: `/project:tool-evaluation`

**Dependency security & pnpm overrides.** Dependabot alerts on this repo are almost all *transitive* npm vulns. Fix them by flooring the package in the `pnpm-workspace.yaml` `overrides:` block — **not** by bumping a manifest. While a floor still changes resolution, it IS the fix, and removing it re-introduces the CVE. Once every consumer's range already selects the patched version, the floor is dead weight. Remove it only after the empirical prune screen in [Pruning overrides](dependency-reduction-routine.md#pruning-overrides), never by reading its comment. Two hard rules, both enforced/tooled so no surface rediscovers them:
- **Every security floor carries a comment naming its `GHSA-…` / `Dependabot #NN` / `CVE-…`.** The Override Provenance Guard (`scripts/check-override-comments.mjs`, `pnpm check:override-comments`) fails CI on an untagged new floor, so the stale-override audit can later check whether the alert is still open.
- **Regenerate the lockfile only via `pnpm regen:lockfile` (`scripts/regen-lockfile.mjs`).** Editing `overrides:` re-resolves the whole tree, and a naive `pnpm install` resolves that offline from the stale local store (`downloaded 0` is the tell) and silently downgrades ~40 unrelated packages to invalid versions. The helper forces fresh metadata via a fresh empty store and proves the diff is scoped + stable.

Runbook skill: `dpf-clear-dependabot-alerts`. Posture / prune / vendoring strategy: `EP-DEP-SOVEREIGNTY` (`docs/superpowers/specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`). Detection / SBOM / SCA: `EP-ASSURANCE-LEDGER` (`docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`).

## 7. Subagent Dispatch Discipline

**Subagents do not read this file.** They only know what the dispatcher prompt tells them. When dispatching: ⟦model: the injected "run the gate and fix errors" lines assume a subagent won't verify unprompted; newer models self-verify⟧

- **For TypeScript work:** include "run `pnpm --filter web typecheck` before committing and fix any errors."
- **For final-task-in-epic work:** include "run `pnpm --filter web build` and fix any errors" plus the required UX verification path. **Instruct the subagent to route that build through the shared local-CI convergence sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) or the canonical local install — not inside the worktree itself.** (See §5 "Where each gate runs" and [kernel principle](../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).)
- **For UI work:** include the Theme-Aware Styling rules from §11. Without them, components ignore the platform's branding system.
- **For any implementation work:** include "perform a documentation impact check; update the relevant docs surface or record a concrete no-docs-needed attestation before claiming done."
- **For any text an agent writes (code, tests, commit messages, PR bodies):** write invisible or special characters as braced escapes (\u{200B}), never the four-digit form. Agent tooling has decoded the four-digit escape into the literal invisible character in file writes, heredocs and PR bodies; one such character reached `main` in 418eaac44 (BI-5D412E3C). The instruction-file guard and the commit-text guard refuse literal hidden characters; braced escapes pass.
- **For governed product surfaces:** register or update the Authorized Surface Contract from the same shared read model that renders the human UX. Keep persistent actions behind `governedExecuteTool`, mark secrets write-only, and run the DOM/accessibility conformance plus governed-surface guard. A route name or raw DOM scrape is not sufficient page knowledge.

## 14. Release Testing

→ [kernel principle](../professions/release-service-management/wiki/release-qa-plan.md)

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with repro steps under the active QA epic. Test results are release evidence. Release QA phases run against the canonical local install or a leased shared nonprod environment per §5 — never against a worktree's local harness. A worktree is the source-control container for the change under test, not a release-QA runtime.

## 15. Communication

### Ending an unfinished thread

Before handing the thread back, determine whether its objective is complete,
the user explicitly paused it, or an observed dependency prevents further
authorized progress. A recoverable tool failure, completed intermediate phase,
or unexamined configuration error is not by itself a reason to stop. Continue
useful authorized work that does not depend on a pending answer.

For a decision that needs direction, consult the recorded WWMD platform,
WWWD organization and WSID profession context, reuse valid decisions, and
identify the owning scope. Record which applicable scopes were inconclusive
or silent and the specific unresolved fact or authority. Do not substitute
another scope's doctrine for the owner's decision. See
[Consult the Governed Scopes Before Asking a Human](../founder-kernel/wiki/principles/consult-scopes-before-asking.md)
and [Escalation Is a Gate, Not a Trust Tier](../founder-kernel/wiki/principles/escalation-is-a-gate-not-a-trust-tier.md).

An unfinished handoff must state:

- The remaining objective and the observed reason progress stopped.
- The recovery or recorded direction checked, and why it did not resolve the dependency.
- Who owns the next action and exactly what action or evidence permits resumption.
- A direct, answerable question when human input is needed, with the missing fact or authority explained.

If an external dependency is the owner, say that no user action is required
and name the observable condition needed to resume. Do not imply monitoring
or automatic resumption unless it has actually been arranged. If the user
paused the work, identify what remains without inventing another approval.
Avoid vague endings such as "blocked", "waiting for review", or "ready for
the next phase" without that actionable explanation. A blocker report is
not a completion claim, and the user must never have to ask whether the work
is done or what the agent needs from them.

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

## Task-specific operating rules

- **Report outcomes faithfully.** If tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging. Never claim completion for work that is not finished. → [kernel principle](../founder-kernel/wiki/principles/never-fabricate.md)
