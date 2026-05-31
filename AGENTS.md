# DPF — Agent Rulebook

This is the canonical operating contract for AI agents working in the Digital Product Factory. Read in full before any action. Subdirectory `AGENTS.md` files MAY extend this with area-specific detail in the future (e.g. `apps/web/AGENTS.md`, `packages/db/AGENTS.md`); none exist today, so this root file is the only AGENTS.md to consult.

Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) are pointers to this file. Do not duplicate rules into them.

**Governance principles.** Durable DPF governance is also published as tiered kernel principles under [`docs/founder-kernel/wiki/principles/`](docs/founder-kernel/wiki/principles/) and retrievable at runtime via the `wiki_query` MCP tool (filter on `pageKind='principle'`, optionally `tier`, `appliesTo`, `publicOnly`) when the connector is available. AGENTS.md remains operationally authoritative when MCP is offline — every command, path, and procedure here works without any retrieval round-trip.

---

## 1. First Principles

- **Never ask the user to run commands.** The user is non-technical. The agent runs the system. No "you can verify by running …", no "open a terminal", no SQL/shell/`gh`/`docker` for the user to copy-paste. Run it yourself via Bash / DPF MCP / Chrome MCP / computer-use MCP and report results. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- **Never fabricate.** Ground claims in code, specs, or DB state. → [kernel principle](docs/founder-kernel/wiki/principles/never-fabricate.md)
- **Research and use standards.** Cite sources; recommend the standard unless you have a project-specific reason to deviate. → [kernel principle](docs/founder-kernel/wiki/principles/research-and-use-standards.md)
- **Fix the seed, not the runtime.** Patch the source script, then add an invariant guard. → [kernel principle](docs/founder-kernel/wiki/principles/fix-the-seed-not-the-runtime.md)
- **Live state over seed data.** Query the database for current epics, backlog, users, capabilities, status. → [kernel principle](docs/founder-kernel/wiki/principles/live-state-over-seed-data.md)
- **Single source of truth.** Each rule, fact, or decision in exactly one place. Pointers, not copies. → [kernel principle](docs/founder-kernel/wiki/principles/single-source-of-truth.md)
- **Architecture over shortcuts.** Choose the architecturally sound solution. Quick fixes that bypass the design create more debt than they save. → [kernel principle](docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md)
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. Use `writing-plans` for anything touching setup, seeds, or shared templates. → [kernel principle](docs/founder-kernel/wiki/principles/plan-before-install-paths.md)
- **Use paid AI capacity responsibly.** → [kernel principle](docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md)
- **Never assume — verify.** Ambiguous terms get resolved by inspecting the environment (installed apps, running processes, files, live DB), not by pattern-matching against project context. A wrong action taken confidently costs more than one verification step. **Commandment tier.** → [kernel principle](docs/founder-kernel/wiki/principles/no-assumptions.md)

## 2. Project Architecture (current as of 2026-04-27)

- **Stack.** Next.js 16 monorepo (pnpm workspaces): `apps/web`, `packages/db` (Prisma 7.x). Docker Compose: postgres:16-alpine, neo4j:5-community, qdrant, portal, portal-init. Local AI via Docker Model Runner (Docker Desktop 4.40+). All inference uses OpenAI-compatible `/v1/chat/completions` (`apps/web/lib/ai-inference.ts`).
- **Deployment doctrine.** Every deployment target (Windows installer today; macOS / Linux / cloud / TAPPaaS per the architecture work in flight) wraps the same canonical contracts. See `docs/superpowers/specs/2026-05-09-deployment-contracts.md` for the 10 contracts and the spec ownership map. Substrate-specific deltas live in their owning specs; universal rules live in the doctrine. **Before adding anything host-coupled (a scrape target, service, bind mount, host path, default URL/port, or shell builtin), check the cross-platform gotcha tally at `docs/install/platform-support-watchlist.md` and add a row when you fix a new platform-specific defect.**
- **Shell scripts** run in Linux containers — LF endings only, enforced by `.gitattributes`. Use `pnpm --filter <pkg> exec <tool>`, never `npx <tool>` (npx ignores pinned versions).
- **PowerShell scripts** target Windows 10/11 + PS 5.1+. Plain ASCII only — no Unicode, BOM, smart quotes, em-dashes, emoji. Bash equivalents for macOS / Linux are landing per `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`; both surfaces remain canonical going forward.
- **Migrations** live in `packages/db/prisma/migrations/`. Create with `pnpm --filter @dpf/db exec prisma migrate dev --name <name>`. Never `npx prisma`. Migration files are immutable after commit — Prisma stores checksums; modifying a committed migration causes drift.
- **Backfill SQL** for any data-moving migration goes inline in the same migration file, not a separate script.
- **Prompts** live in `prompts/<category>/<slug>.prompt.md` with YAML frontmatter, seeded to `PromptTemplate` on deploy, editable via Admin > Prompts. Hardcoded TS constants are fallback only.
- **Skills** live in `skills/<category>/<name>.skill.md`, seeded to `SkillDefinition` + `SkillAssignment`. Belong to coworkers, not routes.
- **Portal archetype.** `StorefrontConfig.archetypeId` is the single source of truth for portal industry. `Organization.industry` and `BusinessContext.industry` are derived. Vocabulary resolution: `resolveVocabularyKey({ archetypeCategory, industry })` — archetype wins.
- **Portal routes.** Internal management lives at `/storefront`. `/portal` is reserved for external/customer experience. `/admin/storefront`, `/admin/business-context`, `/admin/operating-hours` are legacy redirects.

## 3. Strongly-Typed String Enums (mandatory)

→ [kernel principle](docs/founder-kernel/wiki/principles/strongly-typed-string-enums.md)

DB string columns with fixed valid values are canonical enums. Source of truth: `apps/web/lib/backlog.ts` (`EPIC_STATUSES`, union types) and `apps/web/lib/mcp-tools.ts` (`enum:` arrays). Match exactly.

| Model         | Field      | Valid values                                                                |
| ------------- | ---------- | --------------------------------------------------------------------------- |
| `Epic`        | `status`   | `open`, `in-progress`, `done`                                               |
| `BacklogItem` | `status`   | `open`, `in-progress`, `done`, `deferred`                                   |
| `BacklogItem` | `type`     | `portfolio`, `product`                                                      |
| `BacklogItem` | `workType` | `bug`, `feature`, `chore`, `doc`, `tool`, `skill`, `refactor`               |
| `BacklogItem` | `source`   | `user-request`, `automated-detection`                                       |

Hyphens, not underscores. Adding a new value requires updating both `backlog.ts` and the MCP tool definition in the same commit, before any data uses it.

`BacklogItem.workType` is the closed *work-type* axis (the WHAT) and `BacklogItem.source` is the closed *intake-origin* axis (the HOW). Together they replace the legacy mixed-axis `source` enum (which had `feature-gap`, `bug`, `tool-gap`, `skill-gap`, `doc-gap`, `user-request`, `automated-detection` in one list). `FeatureBuild.kind` is derived from `workType` at promote time (`workType==="bug" ? "fix" : "feature"`). Spec: [`docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md`](docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md).

## 4. Branching, Commits & PRs

- **All changes land via PR against `main`** — including the maintainer's. Branch protection enforces it. → [kernel principle](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **One concern per branch, one concern per PR.** Topic branches named by intent: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`. Branch from `main`. → [kernel principle](docs/founder-kernel/wiki/principles/one-concern-per-pr.md)
- **DCO sign-off required on every commit.** Use `git commit -s`. The DCO bot blocks merge until every commit has a `Signed-off-by:` trailer. → [kernel principle](docs/founder-kernel/wiki/principles/dco-sign-off-required.md)
- **Always push** after committing. Local-only commits are invisible to CI. → [kernel principle](docs/founder-kernel/wiki/principles/always-push-after-committing.md)
- **PR creation means ready to merge.** A pushed branch is the handoff/recovery/review artifact while work is still in flight. Do not open a PR as a parking place, early visibility marker, or "draft handoff." Open the PR only when the branch has passed the relevant build gate, UX/migration evidence is captured, and the author believes it is ready for merge automation. If a PR is opened early by mistake, close it and keep the branch. → [kernel principle](docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **Squash-and-delete on merge:** `gh pr merge <n> --squash --delete-branch`.
- **Concurrent sessions:** one thread = one branch + one git worktree. Create with `git worktree add ../DPF-<topic> -b <prefix>/<topic>`. Never share a working tree across sessions; doing so causes index/HEAD collisions and cross-thread file sweeps. → [kernel principle](docs/founder-kernel/wiki/principles/worktree-per-session.md)
- **After creating a worktree, seed its MCP config:** `.mcp.json` and `.vscode/mcp.json` are gitignored (they carry your local `dpfmcp_...` bearer token), so `git worktree add` does not carry them across. Run `scripts/seed-worktree-mcp.ps1` (Windows) or `scripts/seed-worktree-mcp.sh` (macOS / Linux) from inside the new worktree to copy them from the root clone. The script is predicated on the platform being installed and an MCP token already generated at Admin > Platform Development. Restart Claude Code in the worktree afterwards so `/mcp` picks up the `dpf` connector.
- **Compose project isolation is mandatory for worktrees and harnesses.** `docker-compose.yml` defaults to the root project `dpf`; linked worktrees must override it with an ignored `.env` value such as `COMPOSE_PROJECT_NAME=dpf-<topic>`. The worktree MCP seed scripts write this value automatically. Do not run `docker compose up`, `docker compose down`, or profile/harness Compose commands from a worktree until the worktree has a unique project name. CI and integration harnesses must use `node scripts/dpf-compose.mjs` with a unique `COMPOSE_PROJECT_NAME`; `down --volumes` against the root `dpf` project requires an intentional recovery/reinstall context and `DPF_ALLOW_DESTRUCTIVE_COMPOSE=1`.
- **Keep the root clone as the merge/release worktree** — read-only for active feature work. Conventional locations: `d:\DPF` on Windows, `~/dpf` on macOS/Linux. Topic worktrees go alongside (`d:\DPF-<topic>` or `~/dpf-worktrees/<topic>`). → [kernel principle](docs/founder-kernel/wiki/principles/keep-root-clone-as-merge-worktree.md)
- **Branch guard before implementation and commit:** if `git status --short --branch` reports `HEAD (no branch)` or `git branch --show-current` returns `main`, abort before serious implementation. Create/switch to a topic branch first. Do not claim work is complete while commits are local-only; completion requires a pushed branch or PR unless the user explicitly asked not to publish. → [kernel principle](docs/founder-kernel/wiki/principles/branch-guard-before-implementation.md)

## 5. Verification — Build Gate (mandatory)

→ [kernel principle](docs/founder-kernel/wiki/principles/build-gate-mandatory.md)

Work is not complete until all four pass:

1. **Unit tests** — `npx vitest run` for affected files.
2. **Production build** — `cd apps/web && npx next build` with zero errors.
3. **UX verification** — for any UI/agent/coworker/workflow/forms change, exercise the affected path against the running app.
4. **Migration applies cleanly** — if a migration was added.

TypeScript errors only surface in `next build`, not in `vitest` or IDE checks. Run the build per epic, not per release. Pre-existing failures: note them and fix if feasible. Do not defer.

**Local pre-commit gates.** Pre-commit hook at `.githooks/pre-commit` runs a staged Gitleaks secret scan before bytes enter Git history, then runs `pnpm --filter <affected> typecheck` on `.ts`/`.tsx`/`.mts`/`.cts` commits and rejects on failure. Set once: `git config core.hooksPath .githooks` (auto for new clones via `postinstall`). Manual scans: `pnpm security:secrets:staged` for staged content and `pnpm security:secrets` for the current tree. Emergency bypasses exist for verified false positives only: `DPF_SKIP_SECRET_SCAN=1` and `DPF_SKIP_TYPECHECK=1`; CI still gates the PR.

**Build Studio mirrors this gate.** Per-task and pre-ship verification in the sandbox must run typecheck + production build. A Build-Studio-produced PR cannot fail CI typecheck — if it would, it never leaves the sandbox. Implementation status: not yet landed (audited 2026-04-24); see `apps/web/lib/integrate/build-orchestrator.ts` and `apps/web/lib/queue/functions/build-review-verification.ts`.

## 6. Backlog & Planning

- **Backlog lives in PostgreSQL** (`Epic`, `BacklogItem`). Always query live state before planning or changing backlog work. → [kernel principle](docs/founder-kernel/wiki/principles/backlog-lives-in-postgresql.md)
- **Use the DPF MCP backlog tools first when available.** Local agent clients are configured by the untracked `.mcp.json` generated from Admin > Platform Development. It points the `dpf` server at the canonical MCP endpoint `/api/mcp/v1`, which exposes backlog/planning tools such as `list_backlog_items`, `get_backlog_item`, `create_backlog_item`, `update_backlog_item_status`, `list_epics`, `link_backlog_item_to_epic`, `search_specs_and_plans`, and `record_execution_evidence` according to the caller's token scopes.
- **DB fallback must be explicit.** If the `dpf` MCP server is unavailable in the current agent session, query the live Postgres database directly and say that you used DB fallback. Do not substitute `packages/db/src/seed.ts`, generated Prisma files, or stale docs for current backlog state. → [kernel principle](docs/founder-kernel/wiki/principles/db-fallback-explicit.md)
- **Specs and plans** live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check for an existing design before starting work — some are ready to implement.
- **Before creating a new epic:** query existing epics for overlap. Prefer extending an existing epic over creating a new one. If superseding an old epic, mark it done in the same operation. → [kernel principle](docs/founder-kernel/wiki/principles/check-epic-overlap-before-creating.md)
- **On completing items:** update status in the DB immediately. The system auto-closes epics when all items are done/deferred. Direct DB ops require manually flipping the parent epic.
- **Periodic hygiene:** epics with 0 items + status `open` are noise — add items or delete. Epics where all items are done but status is still `open` must be flipped.

## 7. Subagent Dispatch Discipline

**Subagents do not read this file.** They only know what the dispatcher prompt tells them. When dispatching:

- **For TypeScript work:** include "run `pnpm --filter web typecheck` before committing and fix any errors."
- **For final-task-in-epic work:** include "run `cd apps/web && npx next build` and fix any errors" plus the required UX verification path.
- **For UI work:** include the Theme-Aware Styling rules from §11. Without them, components ignore the platform's branding system.

## 8. Tool Authorization

External coding agents use the real MCP JSON-RPC 2.0 transport at `/api/mcp/v1` (`apps/web/app/api/mcp/v1/route.ts`). The older `/api/mcp/tools` and `/api/mcp/call` endpoints remain for in-portal coworker chat and are not the external MCP client contract.

MCP bearer tokens use the `dpfmcp_...` pattern and are issued from Admin > Platform Development > MCP. Treat `.mcp.json` and `.vscode/mcp.json` as local credential files only; they are ignored by git and must never be committed.

**MCP token scopes:** tokens have a coarse `scope` of `read`, `write`, or `admin` plus granular per-tool grants. Default tokens are `read` and cannot call side-effecting tools even if an old token row carries a write grant. Use **Issue write token** in Admin > Platform Development > MCP when an agent must create or update Work Capsules, backlog items, Build Studio evidence, runtime coordination records, or other side-effecting MCP records. The portal shows the plaintext token once, writes the local client snippet, and supports revocation without editing config files.

**Scope escalation rule:** if `/api/mcp/v1` returns an MCP tool result with `structuredContent.error = "insufficient_token_scope"` and `requiredScope` such as `"write"`, stop the MCP workflow and surface the required scope to the operator. Do not fall back to `psql`, Prisma scripts, direct DB edits, or hidden runtime patches to bypass the MCP scope gate. The correct action is to issue a scoped token in the portal, update the client token using the displayed setup command/snippet, call `/api/mcp/token/refresh` with the new token, and retry through MCP.

**Token rotation — Claude Code and Codex:** Both tools read the token from the `DPF_MCP_BEARER_TOKEN` Windows user environment variable. `.mcp.json` references it as `${DPF_MCP_BEARER_TOKEN}`; Codex does the same via `bearer_token_env_var` in `~/.codex/config.toml`. Token rotation from Admin > Platform Development > MCP is:
```powershell
[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', '<new-token>', 'User')
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{"token":"<new-token>"}'
```
Then retry the MCP call in the running session. No file edits. No re-registration.

**New worktree:** `.mcp.json` is gitignored so each worktree needs a hard link to `D:\DPF\.mcp.json`. After `git worktree add`, run:
```powershell
.\scripts\sync-mcp-worktrees.ps1
```

Agent `tool_grants` in `agent_registry.json` are enforced at runtime. `getAvailableTools()` (`apps/web/lib/agent-grants.ts`) intersects:

1. User role capabilities (`PERMISSIONS[capability].roles` for the user's `platformRole`)
2. Agent grants (`config_profile.tool_grants`)

Both must permit the tool. The `TOOL_TO_GRANTS` record maps platform tool names to grant categories. Tools not in the mapping are allowed by default.

Every tool call writes to `ToolExecution` (`agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `createdAt`). Visible at `/platform/ai/authority`.

## 9. External Tools

→ [kernel principle](docs/founder-kernel/wiki/principles/tool-evaluation-pipeline.md)

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: 6 agents covering security, architecture, compliance, integration. Approved tools are version-pinned in `packages/db/data/approved_tools_registry.json` with re-evaluation scheduled.

- Spec: `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`
- Run: `/project:tool-evaluation`

## 10. Design Research

→ [kernel principle](docs/founder-kernel/wiki/principles/design-research-required.md)

Every new feature spec must include a "Research & Benchmarking" section before finalization. Compare 2–3 open-source leaders (read their data models, not just feature lists) and 2–3 commercial products. Document patterns adopted, patterns rejected, anti-patterns identified, and gaps the design fills. Reference specific projects, not abstract "best practices."

## 11. Data Model Stewardship

Before adding any large feature, audit the existing schema for refactoring opportunities. Indicators that refactoring is needed: a domain model being reused as a shared concept; the same logical data appearing in two+ existing models; a new feature needing meta-data with no canonical home. → [kernel principle](docs/founder-kernel/wiki/principles/schema-audit-before-features.md)

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, env vars, or bespoke fields elsewhere. → [kernel principle](docs/founder-kernel/wiki/principles/organization-canonical-identity.md)

**Principal convergence (2026-05-09).** Per the addendum on `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`, any new identity-bearing entity introduced after 2026-05-09 must be modeled as a `PrincipalAlias` linked to a single `Principal`, not as a parallel identity table. The convergence target covers `User`, `CustomerContact`, `Agent`, `EdgeNode`, `MobileDevice`, and `ServiceAccount`. Authorization decisions resolve on the `Principal`; alias kind tells the platform which surface authenticated the request. → [kernel principle](docs/founder-kernel/wiki/principles/principal-convergence.md)

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

Full standard: `docs/platform-usability-standards.md`. Other UI conventions: tab-nav with sub-routes for sections, progressive disclosure (3–5 essential fields, advanced via coworker), wizard-first setup with quick-edit on return, consistent welcome messages (identity → 2-3 capabilities → skills hint).

## 13. Login & Local QA

- Login email: `admin@dpf.local` unless told otherwise.
- Read the install's admin password from `ADMIN_PASSWORD` in repo-root `.env` — not from `apps/web/.env.local` (which may omit it).
- If `/build` or another shell route redirects to `/welcome`, authenticate at `/login` first.
- Verify production-path UI changes against the Docker-served app at the install's configured URL (`AUTH_URL`/`APP_URL` in `.env`), not stale `next dev` sessions. Rebuild with: `docker compose build --no-cache portal portal-init sandbox && docker compose up -d`.

## 14. Release Testing

→ [kernel principle](docs/founder-kernel/wiki/principles/release-qa-plan.md)

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with repro steps under the active QA epic. Test results are release evidence.

## 15. Communication

- If uncommitted changes exist, mention them before starting new work. → [kernel principle](docs/founder-kernel/wiki/principles/mention-uncommitted-changes.md)
- When committing, list what's included.
- State results and decisions directly. No running commentary on internal deliberation. → [kernel principle](docs/founder-kernel/wiki/principles/state-results-directly.md)
- Maintain forward momentum: when the current work naturally implies a next step, name the next smallest useful step from the thread direction and company context. Keep it quiet and operational - no sales pitch, no broad re-planning unless asked.
- End-of-turn summary: one or two sentences — what changed, what's next.

## 16. Skill Discovery

- **Dual-surface contract.** DPF platform skills are authored once in superset `SKILL.md` format at `packages/dpf-skill-pack/skills/<slug>/SKILL.md`. Claude Code and Codex load those files through the checked-in `dpf-platform` plugin marketplaces; the plugin is also the home for client MCP descriptors, hooks, and runtime assets. `packages/db/src/seed-skills.ts` seeds the same files as `SkillDefinition` + `SkillAssignment` rows for in-portal coworkers. Both surfaces converge on the same body and kernel-principle enforcement.
- **Generic skills (Surface A only).** Non-DPF skill packs are not project-default development precedent. Use `dpf-platform` first; install upstream generic packs only in local/user scope for a documented task gap, and promote recurring value into this DPF plugin before treating it as standard practice. Never seed generic packs for in-portal coworkers.
- **DPF platform skills (both surfaces).** Catalogue entries show `name` — trigger; Surface-B `assignTo`; enforced kernel principles.
  - `dpf-decision-via-kernel` — `open question|trade-off|which approach|2-3 options|architectural decision|how should we`; `["*"]`; `structural-verification-is-not-functional`, `architecture-over-shortcuts`, `research-before-implementing`.
  - `dpf-verify-substrate-first` — `new table|new type|new capability|new epic|new tool|new agent|new schema|propose .* new|we'll need|need to add`; `["*"]`; `verify-substrate-before-proposing-new`, `sweep-main-before-trusting-worktree-specs`, `single-source-of-truth`.
  - `dpf-file-backlog-item` — `file (a |new )?(backlog item|BI|bug|gap|ticket)|add to backlog|track this|new work item`; `["build-specialist", "ops-coordinator", "platform-engineer"]`; `backlog-lives-in-postgresql`, `check-epic-overlap-before-creating`, `live-state-over-seed-data`.
  - `dpf-promote-to-build-studio` — `promote to build studio|send to BS|kick off the build|start build|hand off to build|BS pipeline`; `["build-specialist", "ops-coordinator"]`; `architecture-over-shortcuts`, `governance-approves-evidence-not-provenance`.
  - `dpf-worktree-per-session` — `new worktree|create worktree|spawn session|concurrent session|parallel work|isolated branch`; `["build-specialist", "platform-engineer"]`; `worktree-per-session`, `propose-acknowledge-reassign`, `worktree-base-origin-main`, `keep-root-clone-as-merge-worktree`.
  - `dpf-pr-with-dco` — `open (a |the )?PR|pull request|push (and|to) PR|land this|ship this branch`; `["build-specialist", "platform-engineer"]`; `all-changes-land-via-pr`, `dco-sign-off-required`, `always-push-after-committing`, `branch-guard-before-implementation`, `one-concern-per-pr`.
  - `dpf-evidence-before-diagnosis` — `what's wrong|why is .* failing|why does .* not work|the cause is|looks like .* is broken|diagnose`; `["*"]`; `evidence-before-diagnosis`, `structural-verification-is-not-functional`, `check-tool-signals-first`, `never-fabricate`.
  - `dpf-architecture-review` — `architecture review|architectural alignment|architectural concerns|review .* (spec|design|plan)|does this fit the architecture|chief architect`; `["ea-architect", "build-specialist", "platform-engineer"]`; `architecture-over-shortcuts`, `single-source-of-truth`, `research-and-use-standards`, `schema-audit-before-features`. Advisory chief-architect spec review; also the in-portal `architect` reviewer branch at the Build Studio Ideate + Plan gates.
  - `dev-portal-start` — contributor preview verification for `apps/web/` edits needing visual or HTTP confirmation on `:3001`; target `["platform-engineer", "build-specialist"]` when migrated; `structural-verification-is-not-functional`, `never-ask-user-to-run-commands`.
  - `ui-ux-pro-max` — plan, build, review, fix, improve, or refactor UI/UX code and product surfaces; target `["*"]` when migrated; `no-hardcoded-colors`, `design-research-required`.
- **Legacy coworker skills (Surface B only).** Existing coworker skills live at `skills/<category>/*.skill.md` and keep the older frontmatter until EP-SKILL-001 migrates them opportunistically. New DPF skills MUST use the superset format in `packages/dpf-skill-pack/`.
- **DPF spec/plan locations.** Specs live at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`; plans live at `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. The DPF-only `/project:tool-evaluation` command remains at `.claude/commands/tool-evaluation.md` for EP-GOVERN-002 external-tool evaluation, alongside `.claude/commands/build-studio-operator.md` until a re-home BI says otherwise.
- **Disambiguation rules.** Surface A: "DPF skill wins over superpowers when both could apply". Surface B: "plugin SKILL.md wins over legacy .skill.md at seed time". **DPF-vs-DPF (intra-pack overlap):** when two DPF skills' `triggerPattern`s match the same task, resolve by (1) the `composesFrom` chain — the predecessor fires first (e.g. `dpf-evidence-before-diagnosis` before `dpf-systematic-debugging`; `dpf-brainstorming` before `dpf-decision-via-kernel`; `dpf-file-backlog-item` before `dpf-writing-plans`), then (2) the most specific `description` DPF-context selector. The chains encode intended order; a trigger overlap is not a conflict.
- **Kernel principles (Surface C).** Durable doctrine lives at `docs/founder-kernel/wiki/principles/`. Use `wiki_query` for principle lookup and `principle_decide` for scored decisions when the connector is available; `dpf-decision-via-kernel` is the procedural bridge from either runtime.
- **WWMD vs WWWD — which decision surface governs.** `dpf-decision-via-kernel` / `principle_decide` is the **platform-development (WWMD)** decision surface — for DPF contributors and Build Studio *platform* work, scored against the founder kernel. **A customer's business decision (in-portal coworker) must route through the Decision Perspective Gate against the organization's WWWD profile**, which enforces the non-inherit boundary: a customer profile does **not** inherit platform-specific business judgment as authority by default (DPF product doctrine is advisory only until the org seeds its own WWWD). The two surfaces are being consolidated so the Gate is the single governed door (BI-E1FB2307); until that lands, do not use raw `principle_decide` to settle a customer's business question. See `docs/user-guide/ai-workforce/decision-perspective.md`.
