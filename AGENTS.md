# DPF — Agent Rulebook

This is the canonical operating contract for AI agents working in the Digital Product Factory. Read in full before any action. ⟦model: front-loading over progressive disclosure is a model-era call — DI-F844365B0DCC Option B⟧ Subdirectory `AGENTS.md` files MAY extend this with area-specific detail in the future (e.g. `apps/web/AGENTS.md`, `packages/db/AGENTS.md`); none exist today, so this root file is the only AGENTS.md to consult. ⟦runtime: re-verify with `git ls-files '*AGENTS.md'` — snapshot 2026-07-31⟧

Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) are pointers to this file. Do not duplicate rules into them.

**Governance principles.** Durable DPF governance is also published as tiered kernel principles under [`docs/founder-kernel/wiki/principles/`](docs/founder-kernel/wiki/principles/) and retrievable at runtime via the `wiki_query` MCP tool (filter on `pageKind='principle'`, optionally `tier`, `appliesTo`, `publicOnly`) when the connector is available. AGENTS.md remains operationally authoritative when MCP is offline — every command, path, and procedure here works without any retrieval round-trip.

---

## 1. First Principles

- **Never ask the user to run commands.** The user is non-technical. The agent runs the system. No "you can verify by running …", no "open a terminal", no SQL/shell/`gh`/`docker` for the user to copy-paste. Run it yourself via Bash / DPF MCP / Chrome MCP / computer-use MCP and report results. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- **Never fabricate.** Ground claims in code, specs, or DB state. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)
- **Research and use standards.** Cite sources; recommend the standard unless you have a project-specific reason to deviate. → [kernel principle](docs/founder-kernel/wiki/principles/research-and-use-standards.md)
- **Fix the seed, not the runtime.** Patch the source script, then add an invariant guard. → [kernel principle](docs/professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)
- **Live state over seed data.** Query the database for current epics, backlog, users, capabilities, status. → [kernel principle](docs/professions/data-architect/wiki/live-state-over-seed-data.md)
- **Single source of truth.** Each rule, fact, or decision in exactly one place. Pointers, not copies. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)
- **Ground new work in existing platform work.** Unless explicitly told otherwise, every new DPF design and implementation starts from existing and previous platform work: inspect the relevant specs, schema, principles, routes, primitives, and backlog; extend or refactor what exists; create net-new substrate only when prior work is proven unfit and the supersession is explicit. → [kernel principle](docs/founder-kernel/wiki/principles/consult-specs-first.md)
- **Learnings belong in the shared commons.** A finding confirmed by any agent (Claude, Codex, a Build Studio coworker, or the local model) is a team asset. Route every durable learning to the commons — WWMD (kernel principle) / WWWD (platform fact) / WSID (profession technique) / code+`AGENTS.md` — and contribute it to the hive so every agent and every install inherits it. The `dpf-route-learning-to-commons` skill is the path of least resistance. Local, client-only storage is reserved for genuinely install-specific config; local-only knowledge is a defect. → [kernel principle](docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md)
- **Architecture over shortcuts.** Choose the architecturally sound solution. Quick fixes that bypass the design create more debt than they save. → [kernel principle](docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md)
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. Use `writing-plans` for anything touching setup, seeds, or shared templates. → [kernel principle](docs/founder-kernel/wiki/principles/plan-before-install-paths.md)
- **Use paid AI capacity responsibly.** → [kernel principle](docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md)
- **Never assume — verify.** Ambiguous terms get resolved by inspecting the environment (installed apps, running processes, files, live DB), not by pattern-matching against project context. A wrong action taken confidently costs more than one verification step. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/no-assumptions.md)
- **Classify ambiguous requests before acting.** When an operator request could reasonably mean more than one work type - for example an immediate product fix, runtime investigation, spec/doc update, governance decision, backlog/capsule coordination, or autonomous self-improvement loop - stop before code edits and ask the operator to classify the request. Offer concrete choices, prefer the highest-governance interpretation when the request mentions AI coworkers, proactivity, autonomy, backlog, WWMD, process gaps, or the platform improving itself, and route that work through the relevant DPF MCP / Work Capsule / WWMD tools before implementation. A quick product fix may be sequenced first only for an explicit incident or operator-approved urgent repair; it never waives the documentation, decision, and follow-up record. → [kernel principle](docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md)
- **Self-provision before working.** If your client is missing its DPF tools — no `dpf` MCP connector in `/mcp`, no `dpf-platform` skills — converge it before doing project work. This happens on a fresh clone, a new worktree, **or after the client is reinstalled/reset** (which wipes the user-scope plugin cache and any unexported MCP token). Run `scripts/dpf-bootstrap-agent-toolchain.ps1` (Windows) or `bash scripts/dpf-bootstrap-agent-toolchain.sh` (macOS / Linux) from the repo root, then restart the client so `/mcp` and skills reload. The bootstrap is idempotent — a converged session is a no-op — and detect→plan→apply covers Claude Code, Codex CLI, Grok CLI, and Google Antigravity (AGY CLI / IDE) from one entry point. This is the generic, client-agnostic install-on-use contract; §4 covers the worktree-create case specifically with the same script. → [Agent Toolchain Bootstrap](docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)

## 2. Project Architecture (current as of 2026-04-27)

- **Stack.** Next.js 16 monorepo (pnpm workspaces): `apps/web`, `packages/db` (Prisma 7.x). Docker Compose: postgres:16-alpine (including pgvector and graph tables), portal, portal-init. Local AI via Docker Model Runner (Docker Desktop 4.40+). All inference uses OpenAI-compatible `/v1/chat/completions` (`apps/web/lib/ai-inference.ts`). ⟦runtime: pins drift every upgrade — re-verify against `package.json` + compose files, never cite from here; snapshot 2026-04-27⟧
- **Deployment doctrine.** Every deployment target (Windows installer today; macOS / Linux / cloud / TAPPaaS per the architecture work in flight) wraps the same canonical contracts. See `docs/superpowers/specs/2026-05-09-deployment-contracts.md` for the 10 contracts and the spec ownership map. Substrate-specific deltas live in their owning specs; universal rules live in the doctrine. **Before adding anything host-coupled (a scrape target, service, bind mount, host path, default URL/port, or shell builtin), check the cross-platform gotcha tally at `docs/install/platform-support-watchlist.md` and add a row when you fix a new platform-specific defect.**
- **Shell scripts** run in Linux containers — LF endings only, enforced by `.gitattributes`. Use `pnpm --filter <pkg> exec <tool>`, never `npx <tool>` (npx ignores pinned versions).
- **PowerShell scripts** target Windows 10/11 + PS 5.1+. Plain ASCII only — no Unicode, BOM, smart quotes, em-dashes, emoji. Bash equivalents for macOS / Linux are landing per `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`; both surfaces remain canonical going forward. ⟦runtime: in-flight — "landing" expires when that plan closes; check it before trusting Bash parity⟧
- **Migrations** live in `packages/db/prisma/migrations/`. Create with `pnpm --filter @dpf/db exec prisma migrate dev --name <name>`. Never `npx prisma`. Migration files are immutable after commit — Prisma stores checksums; modifying a committed migration causes drift.
- **Backfill SQL** for any data-moving migration goes inline in the same migration file, not a separate script.
- **A migration must apply cleanly against ANY existing data state, not just a clean schema.** Migrations are forward-only and self-upgrade is fail-closed (migrate runs pre-swap under `set -e`), so a "tightening" migration that fails on an install's existing rows does not just error — it **wedges** that install's forward-only chain, freezing the busiest installs (most data) on the old version. Before adding a constraint that existing rows could violate — `UNIQUE`, `EXCLUDE`, `CHECK`, `FOREIGN KEY`, `PRIMARY KEY`, `SET NOT NULL`, or `ADD COLUMN … NOT NULL` without a `DEFAULT` — do ONE of: **(1)** remediate the offending rows idempotently in the SAME migration *before* the constraint (quarantine/backfill in a `DO $$` block or `UPDATE`/`DELETE` — precedents: `20260521120000_fix_wiki_backslash_slug_duplicates`, `20260426150500_backfill_missing_principals`, `20260413170000_rename_ollama_to_local`; **prefer quarantine over destruction** per kernel decision D5); **(2)** split **expand → contract** across two releases (add the loose form + backfill now, tighten in a later release once the fleet has converged); **(3)** add the constraint `NOT VALID` (FK/CHECK) and `VALIDATE` in a later release; or **(4)** if genuinely data-safe, attest in-file with `-- @migration-safety: data-safe: <why no existing row can violate this>`. This is **enforced**, not advisory: the `migration-safety-guard` (`.githooks/pre-commit` Guard 7 + `.github/workflows/migration-safety-guard.yml`) blocks a tightening migration that has none of the above. See `docs/superpowers/specs/2026-07-03-fleet-safe-schema-evolution-design.md` (EP under BI-5B3FA415); the shadow-DB dry-run preflight (BI-UPGRADE-008) is the planned real-data backstop.
- **Prompts** live in `prompts/<category>/<slug>.prompt.md` with YAML frontmatter, seeded to `PromptTemplate` on deploy, editable via Admin > Prompts. Hardcoded TS constants are fallback only.
- **Skills** live in `skills/<category>/<name>.skill.md`, seeded to `SkillDefinition` + `SkillAssignment`. Belong to coworkers, not routes.
- **Portal archetype.** `StorefrontConfig.archetypeId` is the single source of truth for portal industry. `Organization.industry` and `BusinessContext.industry` are derived. Vocabulary resolution: `resolveVocabularyKey({ archetypeCategory, industry })` — archetype wins.
- **Adding a business archetype.** Use the `dpf-add-archetype` skill (`packages/dpf-skill-pack/skills/dpf-add-archetype/SKILL.md`) — do not copy a prior archetype design doc. An archetype provisions four dimensions, not one: template substrate, WSID profession corpus, an AI-coworker decision, and skills/tools. The `Archetype Completeness Guard` CI job enforces this — structural presence blocks all categories; the depth floor (≥1 corpus page + a recorded coworker decision in `scripts/archetype-coworker-decisions.txt`) hard-blocks NEW archetypes, while pre-existing gaps ratchet down from `scripts/archetype-completeness-baseline.txt`. A new archetype must meet the full floor, never be parked in the baseline. Spec: [`docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`](docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md).
- **Portal routes.** Internal management lives at `/storefront`. `/portal` is reserved for external/customer experience. `/admin/storefront`, `/admin/business-context`, `/admin/operating-hours` are legacy redirects.
- **Channel adapter capabilities (BI-IMP-27126FA9).** When an operation is contractually defined on a channel adapter interface but operationally unsupported by a specific provider, the adapter must explicitly signal support status using capability flags rather than silent failure. Unimplemented methods must throw a typed error or return a structured unsupported response (e.g., throwing an `IntegrationApiError` with status code `UNSUPPORTED_OPERATION` or returning a `supported: false` status) to allow the caller to degrade gracefully. For example, a marketing channel adapter that contractually implements engagement tracking but lacks underlying API support on a specific provider must advertise this via its capability registration.

## 3. Strongly-Typed String Enums (mandatory)

→ [kernel principle](docs/professions/data-architect/wiki/strongly-typed-string-enums.md)

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

`BacklogItem.workType` is the closed *work-type* axis (the WHAT) and `BacklogItem.source` is the closed *intake-origin* axis (the HOW). Together they replace the legacy mixed-axis `source` enum (which had `feature-gap`, `bug`, `tool-gap`, `skill-gap`, `doc-gap`, `user-request`, `automated-detection` in one list). `FeatureBuild.kind` is derived from `workType` at promote time (`workType==="bug" ? "fix" : "feature"`). Spec: [`docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md`](docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md).

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

- **Backlog lives in PostgreSQL** (`Epic`, `BacklogItem`). Always query live state before planning or changing backlog work. → [kernel principle](docs/professions/portfolio-management/wiki/backlog-lives-in-postgresql.md)
- **Use the DPF MCP backlog tools first when available.** Local agent clients are configured by the untracked `.mcp.json` generated from Admin > Platform Development. It points the `dpf` server at the canonical MCP endpoint `/api/mcp/v1`, which exposes backlog/planning tools such as `list_backlog_items`, `get_backlog_item`, `create_backlog_item`, `update_backlog_item_status`, `list_epics`, `link_backlog_item_to_epic`, `search_specs_and_plans`, and `record_execution_evidence` according to the caller's token scopes.
- **DB fallback must be explicit.** If the `dpf` MCP server is unavailable in the current agent session, query the live Postgres database directly and say that you used DB fallback. Do not substitute `packages/db/src/seed.ts`, generated Prisma files, or stale docs for current backlog state. → [kernel principle](docs/founder-kernel/wiki/principles/db-fallback-explicit.md)
- **Specs and plans** live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check for an existing design before starting work — some are ready to implement.
- **Plans need live backlog coverage before implementation.** Use `dpf-writing-plans` and the governed `record_plan_backlog_coverage` receipt. Every independently shippable deliverable maps to a live new or existing `BacklogItem`; an `xlarge` BI always records a decomposition decision. Keeping one BI is allowed only with an auditable rationale that its phases are sequencing, not independent work. Copy the receipt, BI mappings, and dependencies into the plan. MCP/tool/scope failure stops the workflow — Markdown checkboxes are never backlog coverage. The plugin pre-source guard is the earliest hard boundary; the Plan Backlog Coverage CI check is the repository backstop.
- **Enforced process/docs/data CI gates (mandatory, surface-agnostic).** A substantial implementation surface needs a spec/plan/doc touch or a `Process-Spine-Decision:` trailer; a UX / workflow / queue / nav / attention surface needs a `## Design grounding` section or `Design-Grounding-Decision:` trailer naming the specs/plans AND code substrate reviewed; a documented user-facing route change needs the doc edit or a `Docs-Impact-Decision:` trailer; a persistent Prisma model / migration / projection / AI-context source needs a generated `*.data-impact.json` manifest (or exception) AND a `packages/db/src/table-classification.ts` sensitivity + exactly one retention disposition. Internal doc links are source-relative `.md` paths — regenerate with `pnpm docs:index` on add/rename/delete. **Each gate self-enforces in CI, so a missing trailer fails the PR, not your memory** — the reason this detail need not stay always-on. Full per-gate trigger + trailer mechanics (Spec/Plan/Doc, Design Grounding, Doc Reference Integrity, Docs Link, Docs Impact, Data-Impact, Stewardship Scope): [`docs/architecture/enforced-ci-gates.md`](docs/architecture/enforced-ci-gates.md).
- **Before creating a new epic:** query existing epics for overlap. Prefer extending an existing epic over creating a new one. If superseding an old epic, mark it done in the same operation. → [kernel principle](docs/professions/portfolio-management/wiki/check-epic-overlap-before-creating.md)
- **On completing items:** update status in the DB immediately. The system auto-closes epics when all items are done/deferred. Direct DB ops require manually flipping the parent epic.
- **Periodic hygiene:** epics with 0 items + status `open` are noise — add items or delete. Epics where all items are done but status is still `open` must be flipped.
- **Execution evidence is canonical-runtime evidence.** When recording build-gate, UX, or migration evidence via `record_execution_evidence` (or the Build Studio equivalent), the command + output must come from the canonical local install per §5 after the governed self-upgrade path has deployed the target, or from the shared local-CI convergence sandbox. A worktree-only "green" for a runtime-bound gate is a source-control checkpoint, not execution evidence.

## 7. Subagent Dispatch Discipline

**Subagents do not read this file.** They only know what the dispatcher prompt tells them. When dispatching: ⟦model: the injected "run the gate and fix errors" lines assume a subagent won't verify unprompted; newer models self-verify⟧

- **For TypeScript work:** include "run `pnpm --filter web typecheck` before committing and fix any errors."
- **For final-task-in-epic work:** include "run `pnpm --filter web build` and fix any errors" plus the required UX verification path. **Instruct the subagent to route that build through the shared local-CI convergence sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) or the canonical local install — not inside the worktree itself.** (See §5 "Where each gate runs" and [kernel principle](docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).)
- **For UI work:** include the Theme-Aware Styling rules from §11. Without them, components ignore the platform's branding system.
- **For any implementation work:** include "perform a documentation impact check; update the relevant docs surface or record a concrete no-docs-needed attestation before claiming done."

## 8. Tool Authorization

Transport, token issuance/rotation, worktree MCP sync and grant-intersection mechanics: [MCP tool authorization runbook](docs/architecture/mcp-tool-authorization-runbook.md).

- **External coding agents use the MCP JSON-RPC transport at `/api/mcp/v1`.** Bearer tokens follow the `dpfmcp_...` pattern, are issued from Admin > Platform Development > MCP, and live only in local credential files — never commit them.
- **Tokens carry a coarse scope (`read`/`write`/`admin`) plus granular per-tool grants; default tokens are `read` and cannot call side-effecting tools.** Agent `tool_grants` in `agent_registry.json` are enforced at runtime, intersected with the user's role capabilities.
- **Scope escalation is a stop, not a workaround.** On `insufficient_token_scope`, surface the required scope to the operator and stop the MCP workflow. Do not fall back to a direct database or filesystem route to achieve the same effect.
- **Advise-safe tool classification** — stated once in §8a below.

## 8a. Advise-safe tools, server-action exports, coworker coordination (pointers)

**Advise-safe tool classification (BI-IMP-F710F41C).** A side-effect tool (`sideEffect: true` in `mcp-tools.ts`) may stay visible in **advise mode** only when it (1) preserves human visibility (SSE + UI cards), (2) writes an audit trail (e.g. `ToolExecution` / delegation chain), (3) is grant- and lifecycle-gated, and (4) is listed in a **shared constant** imported by every filter path (see `adviseHeldBackTools` / coworker tool filter). Do not invent a parallel allowlist per route. Prefer pure reads in advise mode; only promote a side-effect into advise when those four hold.

**`"use server"` modules export only functions and concrete values (BI-IMP-21C466DE).** Type aliases and interfaces stay **local** (or live in a non-`"use server"` module). Exporting types from a server-action file breaks Turbopack registration. Prefer `export type` from a sibling `*.types.ts` or `lib/` module.

**Coworker capability filtering is single-source (BI-IMP-60B0893E).** Agent tool grants live in `agent_registry.json` / `AgentToolGrant`; runtime intersection is `getAvailableTools` + `TOOL_TO_GRANTS` + coworker filter helpers under `apps/web/lib/actions/coworker-tool-filter.ts` and `apps/web/lib/tak/agent-grants.ts`. Route-local allowlists that re-express the same policy are defects — extend the shared filter, do not fork it. Peer coordination tools (`request_coworker`, `summon_coworker`) follow the advise-safe pattern above.

## 9. External Tools

→ [kernel principle](docs/professions/software-engineer/wiki/tool-evaluation-pipeline.md)

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: 6 agents covering security, architecture, compliance, integration. Approved tools are version-pinned in `packages/db/data/approved_tools_registry.json` with re-evaluation scheduled.

- Spec: `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`
- Run: `/project:tool-evaluation`

**Dependency security & pnpm overrides.** Dependabot alerts on this repo are almost all *transitive* npm vulns. Fix them by flooring the package in the `pnpm-workspace.yaml` `overrides:` block — **not** by bumping a manifest. The overrides ARE the fix; reverting/removing them re-introduces the CVEs. Two hard rules, both enforced/tooled so no surface rediscovers them:
- **Every security floor carries a comment naming its `GHSA-…` / `Dependabot #NN` / `CVE-…`.** The Override Provenance Guard (`scripts/check-override-comments.mjs`, `pnpm check:override-comments`) fails CI on an untagged new floor, so the stale-override audit can later check whether the alert is still open.
- **Regenerate the lockfile only via `pnpm regen:lockfile` (`scripts/regen-lockfile.mjs`).** Editing `overrides:` re-resolves the whole tree, and a naive `pnpm install` resolves that offline from the stale local store (`downloaded 0` is the tell) and silently downgrades ~40 unrelated packages to invalid versions. The helper forces fresh metadata via a fresh empty store and proves the diff is scoped + stable.

Runbook skill: `dpf-clear-dependabot-alerts`. Posture / prune / vendoring strategy: `EP-DEP-SOVEREIGNTY` (`docs/superpowers/specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md`). Detection / SBOM / SCA: `EP-ASSURANCE-LEDGER` (`docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`).

## 10. Design Research

→ [kernel principle](docs/founder-kernel/wiki/principles/design-research-required.md)

Every new feature spec must include a "Research & Benchmarking" section before finalization. Compare 2–3 open-source leaders (read their data models, not just feature lists) and 2–3 commercial products. Document patterns adopted, patterns rejected, anti-patterns identified, and gaps the design fills. Reference specific projects, not abstract "best practices."

**Minimum Architectural Alignment Checklist (BI-IMP-25A07E52).** Before finalizing a feature spec (or rubber-stamping a PR that changes contracts), confirm:

1. **Deployment contracts** — if the change alters a public API response shape, install path, host-coupled default, service boundary, or self-upgrade step, review [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](docs/superpowers/specs/2026-05-09-deployment-contracts.md) and name the affected contract(s). Substrate-specific deltas stay in owning specs; universal rules stay in the doctrine.
2. **Canonical identity** — name/display/org identity reads from `Organization` (and Principal convergence for identity-bearing entities), not a parallel field. → §11 and [organization-canonical-identity](docs/professions/data-architect/wiki/organization-canonical-identity.md).
3. **No parallel utilities** — before adding a helper, verify the substrate (grep + code graph / `search_code_graph`) so existing shared modules are extended rather than duplicated. → [verify-substrate-before-proposing-new](docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md).
4. **This rulebook** — the change does not invent a second home for a rule already stated here or in a kernel principle; use pointers, not copies. → [single-source-of-truth](docs/founder-kernel/wiki/principles/single-source-of-truth.md).

**Validating prioritization against archetype load-bearing stages (BI-IMP-3EC2E558).** Specs that change global order, default priority, cockpit ranking, or storefront activation sequence for an industry archetype must check the **operational value stream** for that archetype — not invent a parallel stage list.

1. **Read the SSOT** — [`docs/architecture/archetype-business-value-streams.md`](docs/architecture/archetype-business-value-streams.md). Stable stage family: `attract · capture · qualify · deliver · settle · retain` (per-archetype load-bearing emphasis is named in that doc, not here).
2. **Checklist before shipping a global priority change** — (a) name the archetype(s) affected; (b) list which stream stages the change reorders or demotes; (c) confirm no **load-bearing** stage for those archetypes is pushed behind a non-load-bearing one without an explicit per-archetype policy override; (d) cite the section of the value-stream doc you checked.
3. **Per-archetype overrides** — when one industry must differ from the global default, document the override in the design (and seed/config owner), do not hardcode a second ranking table in a random page helper.
4. **Do not duplicate stage names** in AGENTS.md or feature specs — always point at the value-stream doc so stage vocabulary stays single-source.

## 11. Data Model Stewardship

Before adding any large feature, audit the existing schema for refactoring opportunities. Indicators that refactoring is needed: a domain model being reused as a shared concept; the same logical data appearing in two+ existing models; a new feature needing meta-data with no canonical home. → [kernel principle](docs/professions/data-architect/wiki/schema-audit-before-features.md)

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, env vars, or bespoke fields elsewhere. → [kernel principle](docs/professions/data-architect/wiki/organization-canonical-identity.md)

The `Organization.address` JSON has one canonical shape + helpers in [`apps/web/lib/shared/org-address.ts`](apps/web/lib/shared/org-address.ts) (`OrgAddress`, `parseOrgAddress` / `serializeOrgAddress` / `formatOrgAddressLines`, `resolveTimezoneFromAddress`). Read and write the address through those — do **not** hand-roll a parallel address field or shape. It is captured at setup via the business-context step (`/storefront/settings/business`) and is the precise source for state-accurate timezone derivation (BI-AAAA0691).

**Shared micro-primitives (BET-6, BI-6A505BFF).** Cross-cutting helpers that were hand-inlined at hundreds of sites now have one home each — import them, do **not** re-copy:
- Server-action result: [`apps/web/lib/shared/action-result.ts`](apps/web/lib/shared/action-result.ts) — `ActionResult<T>` (`{ ok: true; data: T } | { ok: false; error: string }`) with `ok(data?)` / `err(message)` constructors. The canonical shape for a server action's return.
- JSON coercion: [`apps/web/lib/shared/coerce.ts`](apps/web/lib/shared/coerce.ts) — `isRecord(v)` (object guard), `asString(v, fallback?)`, `asNumber(v, fallback?)` for narrowing `Prisma.JsonValue` / `unknown`. A CI ratchet (`scripts/check-no-local-isrecord.mjs`) freezes the count of legacy local `isRecord` copies; new code must import this one.
- Route paths: [`apps/web/lib/routes.ts`](apps/web/lib/routes.ts) — `ROUTES.*` named constants for the high-frequency section roots passed to `revalidatePath` / `redirect` / `<Link>`, so a rename is a single compiler-checked edit.

**Route-segment helpers vs shared domain modules (BI-IMP-BC5AA87E).** Page-local helpers under a route segment (e.g. `apps/web/app/(shell)/…/_helpers.ts` or a colocated `*.ts` next to `page.tsx`) may format, adapt, or present **canonical** domain data for that surface only. They must **not** invent a second home for reusable agent/delegation policy, tool metadata, grant maps, persisted outcome contracts, or identifiers that other routes need — those live in shared modules under `apps/web/lib/` (or packages). If a helper is imported from a second route or encodes policy that would change coworker behavior platform-wide, promote it to a shared canonical module in the same PR.

**Metadata governance (BI-IMP-FA900452).** JSON metadata columns (e.g., unstructured payload fields) are reserved for optional, unstructured, or rapidly-evolving context. They must not be used as primary query or reporting sources. Any property that becomes frequently filtered, queried, or joined must be promoted to a typed schema field (via a database migration). When reading or writing JSON metadata in code, use typed accessor helpers and centralized key constants rather than raw string indexing. → [kernel principle](docs/professions/data-architect/wiki/schema-audit-before-features.md)

**Principal convergence (2026-05-09).** Per the addendum on `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`, any new identity-bearing entity introduced after 2026-05-09 must be modeled as a `PrincipalAlias` linked to a single `Principal`, not as a parallel identity table. The convergence target covers `User`, `CustomerContact`, `Agent`, `EdgeNode`, `MobileDevice`, and `ServiceAccount`. Authorization decisions resolve on the `Principal`; alias kind tells the platform which surface authenticated the request. → [kernel principle](docs/professions/data-architect/wiki/principal-convergence.md)

## 12. UI — Theme-Aware Styling (mandatory)

→ [kernel principle](docs/founder-kernel/wiki/principles/no-hardcoded-colors.md)

**No hardcoded colors.** All UI uses CSS custom properties so light mode, dark mode, and branding all work automatically.

| Role              | Use                                                       | Never                                              |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Body/heading text | `text-[var(--dpf-text)]`                                  | `text-white`, `text-black`, `text-gray-*`, `#xxx`  |
| Muted text        | `text-[var(--dpf-muted)]`                                 | `text-gray-400`                                    |
| Surfaces          | `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`  | `bg-white`, `bg-[#xxx]`                            |
| Borders           | `border-[var(--dpf-border)]`                              | `border-gray-*`                                    |
| Accent            | `text-[var(--dpf-accent)]`, `bg-[var(--dpf-accent)]`      | Hardcoded hex                                      |
| Page background   | `bg-[var(--dpf-bg)]`                                      | `bg-[#xxx]`                                        |

Sole exception: `text-white` on `bg-[var(--dpf-accent)]` buttons. Inline `style={{ color: "#xxx" }}` is equally prohibited — use `var(--dpf-text)`. `<option>` elements need explicit `bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]`. Variables defined in `globals.css`, overridden at runtime by branding tokens.

→ [kernel principle](docs/professions/frontend-engineer/wiki/compose-report-kit-for-reporting-ux.md)

**Compose the report-kit palette for reporting UX.** Where the rule above binds *colors* to tokens, this binds whole *reporting components* to a shared palette. Reporting/data-display UX (status badges, list/detail tables, KPI cards, filters, CSV export, charts) is composed from `apps/web/components/ui/report-kit/` — `StatusBadge`, `DataTable`, `StatCard`, `FilterBar`, `ExportButton`/`toCsv`, `Chart`, and the `statusColors` intent registry. Never hand-roll a badge, `<table>`, per-page status color map, or KPI div. Status/severity colors resolve through `statusColors.ts` (status → semantic intent → `--dpf-*` token), never a local map or raw hex. **Discover before building:** read `apps/web/components/ui/report-kit/README.md`, and query the curated catalog via `search_design_intelligence` (domain `ux`/`chart`). If a primitive doesn't cover the case, extend report-kit rather than building a parallel one-off.

→ [kernel principle](docs/founder-kernel/wiki/principles/no-native-browser-dialogs.md)

**No native browser dialogs.** Portal code never calls `window.confirm()`, `window.alert()`, or `window.prompt()` (bare or `window.`-prefixed). They are a dead end for agent automation: a native dialog **blocks all browser automation** — CDP `Input.dispatchMouseEvent` times out while it is open, and the action only commits when a **human** clicks OK (proven live — an operator had to click OK twice to abandon two builds, BI-297863B2). They also block the JS thread, ignore branding/light-dark theming, and can't be tested. Use the in-app primitive instead: `import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/Dialog";` — async, same call shape as the natives (`if (!(await confirmDialog({ title, message, tone: "danger" }))) return;`). It renders real DOM (`role="dialog"`, `aria-modal`, `--dpf-*` themed) with stable `data-dialog-action="confirm|cancel"` / `data-dialog-input` refs an agent can find and click; destructive flows keep a confirm step in `danger` tone. **Enforced in CI** by the `Repo Guard Loop` check (`scripts/check-no-native-dialogs.mjs`, run by `scripts/check-guards.mjs`), which fails any `apps/web` PR that (re)introduces one — surface-agnostic across Claude Code, Codex, Grok, and Build Studio (§17). Build Studio's code-gen agent carries the same rule in its prompt (`apps/web/lib/integrate/build-agent-prompts.ts`).

**Never call a dialog helper inside a React transition.** `confirmDialog` / `alertDialog` / `promptDialog` dispatch a `DialogHost` state update (`setQueue`) to render. When that update is deferred inside a `startTransition(...)` callback (bare, `React.startTransition`, or the fn from `useTransition()`), it never renders **interactively** — the dialog silently never appears and the triggering button wedges forever in its `isPending`/disabled state, with no error and no way to complete the action (bit EP-LABOR-ECONOMICS Phase 4 live; fixed in PR #2649, BI-FE7C543C). Always `await` the dialog **first, outside** the transition, then run the work inside `startTransition` — canonical shape in `apps/web/components/storefront-admin/ItemsManager.tsx` `handleDelete`: `const ok = await confirmDialog({ title, message }); if (!ok) return; startTransition(async () => { /* work */ });`. For an error surfaced from *inside* the transition, set React state and render an inline banner — never `alertDialog` inside the callback. **Enforced in CI** by the `Repo Guard Loop` check (`scripts/check-no-dialog-in-transition.mjs`, run by `scripts/check-guards.mjs`), which fails any `apps/web` PR that calls a dialog helper inside a `startTransition(...)` block — surface-agnostic across Claude Code, Codex, Grok, and Build Studio (§17).

Full standard: `docs/platform-usability-standards.md`. Other UI conventions: tab-nav with sub-routes for sections, progressive disclosure (3–5 essential fields, advanced via coworker), wizard-first setup with quick-edit on return, consistent welcome messages (identity → 2-3 capabilities → skills hint).

**UX-fit gate (mandatory, enforced — BI-D967DEE0).** Any UI-impacting change — a new user-facing form control, a numeric/raw input, a new route/tab, or a metric/status component — MUST carry MEASURED UX-fit evidence before it lands. Run the `dpf-ux-fit-review` skill and score options with `principle_decide` on `human_cognitive_load`. Progressive disclosure wins by default: auto-derive what the platform can compute (model context, hardware limits) and keep the default view to 3–5 plain choices — never ask a layman to type a token count. Commit `docs/ux-fit/<date>-<slug>.ux-fit.json` with `evidence.kind` = `sweep-measurement` (the route's real budget axes, adjudicated against the committed route-budget baseline) or `propose-n-pick` (`decisionInteractionId` + ≥2 `consideredOptions`). An acknowledgement does NOT qualify; the `UX-Fit-Decision:` trailer is RETIRED. **Enforced in CI** by the `UX-Fit Gate` (`scripts/check-ux-fit-decision.mjs`), surface-agnostic across Claude Code, Codex, Grok, and Build Studio, because all changes land via PR (§4) and the gate reads evidence, not provenance (§17). The rule lived here unenforced once — #2004 shipped a raw "Context window: 22000 tokens" input a non-technical user can't answer — which is why a passive document is not enough.

## 13. Login & Local QA

- Login email: `admin@dpf.local` unless told otherwise.
- Read the install's admin password from `ADMIN_PASSWORD` in repo-root `.env` — not from `apps/web/.env.local` (which may omit it). Seeded by `packages/db/src/seed.ts` (bcrypt, falls back to `changeme123`); both installers print it in their completion summary. Never copy the value into a tracked file, a commit, a PR body, or an issue.
- **Pick the right browser surface before blaming auth.** An authenticated portal route reached from an agent's own sandboxed/preview browser has NO session and silently redirects to the sign-in chooser — it looks like the portal is broken when it is only anonymous. For any authenticated surface (`/ops/*`, `/build`, `/platform/*`, coworker panels) drive **Claude-in-Chrome**, which carries the operator's existing session. Confirm with `fetch('/api/auth/session')` BEFORE diagnosing anything else; a `null` user there explains most "page won't load" reports (see also the phantom-session case where a stale non-DB session id yields a null lookup — sign out and back in).
- Agents must not type the password into a login form. Credentials are documented so the OPERATOR can sign in (or so a scripted install can seed); the agent's path to an authenticated surface is the operator's existing browser session, not credential entry.
- If `/build` or another shell route redirects to `/welcome`, authenticate at `/login` first.
- Verify production-path UI changes against the **canonical local install** only after the target has reached it through `/ops/self-upgrade` / the governed self-upgrade runner, or against a leased shared nonprod environment. Do not use a worktree-local `next dev` / `next build` harness, stale `next dev` sessions, or a direct main-portal compose rebuild as production-path UX evidence. Direct compose rebuilds of `portal`/`portal-init` on the main `dpf` project are recovery/bootstrap actions, not the normal validation path.

## 14. Release Testing

→ [kernel principle](docs/professions/release-service-management/wiki/release-qa-plan.md)

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with repro steps under the active QA epic. Test results are release evidence. Release QA phases run against the canonical local install or a leased shared nonprod environment per §5 — never against a worktree's local harness. A worktree is the source-control container for the change under test, not a release-QA runtime.

## 15. Communication

- If uncommitted changes exist, mention them before starting new work. → [kernel principle](docs/founder-kernel/wiki/principles/mention-uncommitted-changes.md)
- When committing, list what's included.
- State results and decisions directly. No running commentary on internal deliberation. → [kernel principle](docs/founder-kernel/wiki/principles/state-results-directly.md)
- Maintain forward momentum: when the current work naturally implies a next step, name the next smallest useful step from the thread direction and company context. Keep it quiet and operational - no sales pitch, no broad re-planning unless asked.
- End-of-turn summary: one or two sentences — what changed, what's next.
---
- **Name the substrate when reporting verification results.** "Tests passed" or "build succeeded" is incomplete without naming where it ran. State the substrate (canonical local install, shared local-CI convergence sandbox lease, or — for source-local-only gates — the worktree). See §6 for what counts as canonical-runtime evidence and §5 for which gates require it.
---

## 16. Skill Discovery

Authoring/seeding mechanics, the process-spine health-check contract and `principle_decide` call detail: [skill surfaces runbook](docs/architecture/skill-surfaces-runbook.md). Per-skill catalogue: [agent skill index](docs/architecture/agent-skill-index.md). The precedence rules — they govern behaviour *before* an agent would know to fetch an index — stay here:

- **Dual-surface contract.** DPF platform skills are authored once at `packages/dpf-skill-pack/skills/<slug>/SKILL.md` — the source of truth for both the CLI plugin and in-portal coworker seeding. New DPF skills MUST use that superset format.
- **DPF skills win over generic ones.** Non-DPF packs are not project-default precedent: use `dpf-platform` first, install upstream packs only in local/user scope for a documented gap, and never seed them for in-portal coworkers. Surface A: a DPF skill beats superpowers when both apply. Surface B: a plugin `SKILL.md` beats a legacy `.skill.md` at seed time.
- **A session with retired process skills visible and no DPF replacement is DPF-precedence-unproven** — repair or restart before project work. Cleanup is disable-not-delete: never delete user-owned skill files or plugin caches.
- **Kernel principles (Surface C) are the durable doctrine store.** `wiki_query` for lookup, `principle_decide` for decisions.
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

