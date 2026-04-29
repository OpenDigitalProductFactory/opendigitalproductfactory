# DPF — Agent Rulebook

This is the canonical operating contract for AI agents working in the Digital Product Factory. Read in full before any action. Subdirectory `AGENTS.md` files extend this with area-specific detail (`apps/web/AGENTS.md`, `packages/db/AGENTS.md`).

Tool-specific files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) are pointers to this file. Do not duplicate rules into them.

---

## 1. First Principles

- **Never fabricate.** If you don't know, say so. Ground claims in code, specs, or DB state — not in patterns from training data.
- **Research and use standards.** Before designing file layouts, conventions, or integrations, find the existing standard. Cite sources. Recommend the standard unless you have a project-specific reason to deviate.
- **Fix the seed, not the runtime.** Recurring config or data regressions mean the seed/template/setup script wasn't patched. Patch the source, then add an invariant guard.
- **Live state over seed data.** For current epics, backlog, users, capabilities, or status, query the database. Treat `packages/db/src/seed.ts` as bootstrap defaults only; never edit it to represent runtime change.
- **Single source of truth.** Each rule, fact, or decision lives in exactly one place. Pointers, not copies.
- **Architecture over shortcuts.** Choose the architecturally sound solution. Quick fixes that bypass the design create more debt than they save.
- **Plan before acting on install/seed/template paths.** A symptom on one install is usually a defect for every install. Use `writing-plans` for anything touching setup, seeds, or shared templates.

## 2. Project Architecture (current as of 2026-04-27)

- **Stack.** Next.js 16 monorepo (pnpm workspaces): `apps/web`, `packages/db` (Prisma 7.x). Docker Compose: postgres:16-alpine, neo4j:5-community, qdrant, portal, portal-init. Local AI via Docker Model Runner (Docker Desktop 4.40+). All inference uses OpenAI-compatible `/v1/chat/completions` (`apps/web/lib/ai-inference.ts`).
- **Shell scripts** run in Linux containers — LF endings only, enforced by `.gitattributes`. Use `pnpm --filter <pkg> exec <tool>`, never `npx <tool>` (npx ignores pinned versions).
- **PowerShell scripts** target Windows 10/11 + PS 5.1+. Plain ASCII only — no Unicode, BOM, smart quotes, em-dashes, emoji.
- **Migrations** live in `packages/db/prisma/migrations/`. Create with `pnpm --filter @dpf/db exec prisma migrate dev --name <name>`. Never `npx prisma`. Migration files are immutable after commit — Prisma stores checksums; modifying a committed migration causes drift.
- **Backfill SQL** for any data-moving migration goes inline in the same migration file, not a separate script.
- **Prompts** live in `prompts/<category>/<slug>.prompt.md` with YAML frontmatter, seeded to `PromptTemplate` on deploy, editable via Admin > Prompts. Hardcoded TS constants are fallback only.
- **Skills** live in `skills/<category>/<name>.skill.md`, seeded to `SkillDefinition` + `SkillAssignment`. Belong to coworkers, not routes.
- **Portal archetype.** `StorefrontConfig.archetypeId` is the single source of truth for portal industry. `Organization.industry` and `BusinessContext.industry` are derived. Vocabulary resolution: `resolveVocabularyKey({ archetypeCategory, industry })` — archetype wins.
- **Portal routes.** Internal management lives at `/storefront`. `/portal` is reserved for external/customer experience. `/admin/storefront`, `/admin/business-context`, `/admin/operating-hours` are legacy redirects.

## 3. Strongly-Typed String Enums (mandatory)

DB string columns with fixed valid values are canonical enums. Source of truth: `apps/web/lib/backlog.ts` (`EPIC_STATUSES`, union types) and `apps/web/lib/mcp-tools.ts` (`enum:` arrays). Match exactly.

| Model         | Field    | Valid values                                |
| ------------- | -------- | ------------------------------------------- |
| `Epic`        | `status` | `open`, `in-progress`, `done`               |
| `BacklogItem` | `status` | `open`, `in-progress`, `done`, `deferred`   |
| `BacklogItem` | `type`   | `portfolio`, `product`                      |

Hyphens, not underscores. Adding a new value requires updating both `backlog.ts` and the MCP tool definition in the same commit, before any data uses it.

## 4. Branching, Commits & PRs

- **All changes land via PR against `main`** — including the maintainer's. No direct pushes; branch protection enforces it.
- **One concern per branch, one concern per PR.** Topic branches named by intent: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`. Branch from `main`.
- **DCO sign-off required on every commit.** Use `git commit -s`. The DCO bot blocks merge until every commit has a `Signed-off-by:` trailer.
- **Always push** after committing. Local-only commits are invisible to CI.
- **Squash-and-delete on merge:** `gh pr merge <n> --squash --delete-branch`.
- **Concurrent sessions:** one thread = one branch + one git worktree. Create with `git worktree add ../DPF-<topic> -b <prefix>/<topic>`. Never share a working tree across sessions; doing so causes index/HEAD collisions and cross-thread file sweeps.
- **Keep `d:\DPF` (root) as the merge/release worktree** — read-only for active feature work.
- **Branch guard before commit:** if `git branch --show-current` returns `main`, abort.

## 5. Verification — Build Gate (mandatory)

Work is not complete until all four pass:

1. **Unit tests** — `npx vitest run` for affected files.
2. **Production build** — `cd apps/web && npx next build` with zero errors.
3. **UX verification** — for any UI/agent/coworker/workflow/forms change, exercise the affected path against the running app.
4. **Migration applies cleanly** — if a migration was added.

TypeScript errors only surface in `next build`, not in `vitest` or IDE checks. Run the build per epic, not per release. Pre-existing failures: note them and fix if feasible. Do not defer.

**Local typecheck gate.** Pre-commit hook at `.githooks/pre-commit` runs `pnpm --filter <affected> typecheck` on `.ts`/`.tsx`/`.mts`/`.cts` commits and rejects on failure. Set once: `git config core.hooksPath .githooks` (auto for new clones via `postinstall`). Emergency bypass: `DPF_SKIP_TYPECHECK=1`.

**Build Studio mirrors this gate.** Per-task and pre-ship verification in the sandbox must run typecheck + production build. A Build-Studio-produced PR cannot fail CI typecheck — if it would, it never leaves the sandbox. Implementation status: not yet landed (audited 2026-04-24); see `apps/web/lib/integrate/build-orchestrator.ts` and `apps/web/lib/queue/functions/build-review-verification.ts`.

## 6. Backlog & Planning

- **Backlog lives in PostgreSQL** (`Epic`, `BacklogItem`). Always query live state before planning or changing backlog work.
- **Use the DPF MCP backlog tools first when available.** Local agent clients are configured by the untracked `.mcp.json` generated from Admin > Platform Development. It points the `dpf` server at the canonical MCP endpoint `/api/mcp/v1`, which exposes backlog/planning tools such as `list_backlog_items`, `get_backlog_item`, `create_backlog_item`, `update_backlog_item_status`, `list_epics`, `link_backlog_item_to_epic`, `search_specs_and_plans`, and `record_execution_evidence` according to the caller's token scopes.
- **DB fallback must be explicit.** If the `dpf` MCP server is unavailable in the current agent session, query the live Postgres database directly and say that you used DB fallback. Do not substitute `packages/db/src/seed.ts`, generated Prisma files, or stale docs for current backlog state.
- **Specs and plans** live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check for an existing design before starting work — some are ready to implement.
- **Before creating a new epic:** query existing epics for overlap. Prefer extending an existing epic over creating a new one. If superseding an old epic, mark it done in the same operation.
- **On completing items:** update status in the DB immediately. The system auto-closes epics when all items are done/deferred. Direct DB ops require manually flipping the parent epic.
- **Periodic hygiene:** epics with 0 items + status `open` are noise — add items or delete. Epics where all items are done but status is still `open` must be flipped.

## 7. Subagent Dispatch Discipline

**Subagents do not read this file.** They only know what the dispatcher prompt tells them. When dispatching:

- **For TypeScript work:** include "run `pnpm --filter web typecheck` before committing and fix any errors."
- **For final-task-in-epic work:** include "run `cd apps/web && npx next build` and fix any errors" plus the required UX verification path.
- **For UI work:** include the Theme-Aware Styling rules from §11. Without them, components ignore the platform's branding system.

## 8. Tool Authorization

External coding agents use the real MCP JSON-RPC 2.0 transport at `/api/mcp/v1` (`apps/web/app/api/mcp/v1/route.ts`). The older `/api/mcp/tools` and `/api/mcp/call` endpoints remain for in-portal coworker chat and are not the external MCP client contract.

MCP bearer tokens use the `dpfmcp_...` pattern and are issued from Admin > Platform Development. Treat `.mcp.json` and `.vscode/mcp.json` as local credential files only; they are ignored by git and must never be committed.

Agent `tool_grants` in `agent_registry.json` are enforced at runtime. `getAvailableTools()` (`apps/web/lib/agent-grants.ts`) intersects:

1. User role capabilities (`PERMISSIONS[capability].roles` for the user's `platformRole`)
2. Agent grants (`config_profile.tool_grants`)

Both must permit the tool. The `TOOL_TO_GRANTS` record maps platform tool names to grant categories. Tools not in the mapping are allowed by default.

Every tool call writes to `ToolExecution` (`agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `createdAt`). Visible at `/platform/ai/authority`.

## 9. External Tools

External MCP servers, npm packages, and APIs must pass the Tool Evaluation Pipeline (EP-GOVERN-002) before adoption: 6 agents covering security, architecture, compliance, integration. Approved tools are version-pinned in `packages/db/data/approved_tools_registry.json` with re-evaluation scheduled.

- Spec: `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`
- Run: `/project:tool-evaluation`

## 10. Design Research

Every new feature spec must include a "Research & Benchmarking" section before finalization. Compare 2–3 open-source leaders (read their data models, not just feature lists) and 2–3 commercial products. Document patterns adopted, patterns rejected, anti-patterns identified, and gaps the design fills. Reference specific projects, not abstract "best practices."

## 11. Data Model Stewardship

Before adding any large feature, audit the existing schema for refactoring opportunities. Indicators that refactoring is needed: a domain model being reused as a shared concept; the same logical data appearing in two+ existing models; a new feature needing meta-data with no canonical home.

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, env vars, or bespoke fields elsewhere.

## 12. UI — Theme-Aware Styling (mandatory)

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

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with repro steps under the active QA epic. Test results are release evidence.

## 15. Communication

- If uncommitted changes exist, mention them before starting new work.
- When committing, list what's included.
- State results and decisions directly. No running commentary on internal deliberation.
- End-of-turn summary: one or two sentences — what changed, what's next.
