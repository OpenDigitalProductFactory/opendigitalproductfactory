# Project: Digital Product Factory (DPF)

## Architecture

- **Next.js 16** monorepo (pnpm workspaces): `apps/web` + `packages/db` (Prisma)
- **Docker Compose** stack: postgres:16-alpine, neo4j:5-community, qdrant, portal (Next.js), portal-init (migrations/seed). Local AI via Docker Model Runner (built into Docker Desktop 4.40+).
- **Prisma 7.x** — do NOT use `npx prisma` (npx ignores the workspace-pinned version and downloads latest from npm)
- All inference calls use OpenAI-compatible `/v1/chat/completions` endpoint (see `apps/web/lib/ai-inference.ts`)

## Shell Script Rules

- All `.sh` files run inside **Linux containers** (Alpine). They MUST use LF line endings.
- `.gitattributes` enforces `*.sh text eol=lf` — do not remove this rule.
- Use `#!/bin/sh` or `#!/bin/bash` — never use Windows-style paths or syntax in shell scripts.
- When running project tools inside containers, use `pnpm --filter <package> exec <tool>` — never `npx <tool>` (npx ignores pinned versions and downloads latest from npm).

## PowerShell Script Rules (.ps1)

- PowerShell scripts target **Windows 10/11** with PowerShell 5.1+.
- Do NOT insert Unicode characters, BOM markers, smart quotes, em-dashes, or non-ASCII characters into `.ps1` files. Use only plain ASCII.
- Do NOT use backtick escapes inside here-strings (`@" "@` or `@' '@`).
- Test that string interpolation works in both PowerShell 5.1 and 7.x.
- Progress/status output should use `Write-Host` with plain ASCII characters (no emoji).

## Database Migrations

- Migrations live in `packages/db/prisma/migrations/`.
- Use `pnpm --filter @dpf/db exec prisma migrate dev --name <name>` to create new migrations.
- Migration timestamps must be unique — do not reuse timestamps from existing migrations.
- The `docker-entrypoint.sh` runs `prisma migrate deploy` on container startup.

## Docker

- `Dockerfile` is a multi-stage build: `base` > `deps` > `build` (Next.js) / `init` (migrations+seed) > `runner`
- The `portal-init` container runs once (migrations, seed, hardware detect) then exits.
- `.dockerignore` excludes `node_modules`, `.next`, `.git`, `.env`, `docs/` — keep it maintained.

## Browser Automation (browser-use)

- **browser-use** replaces Playwright as the primary browser automation layer.
- Service lives in `services/browser-use/` — Python 3.11 + browser-use library + Chromium.
- Exposed as an MCP server at `http://browser-use:8500/mcp` (HTTP JSON-RPC transport).
- Always-on in the default compose stack. Portal `depends_on` waits for browser-use to report healthy at startup.
- MCP tools: `browse_open`, `browse_act`, `browse_extract`, `browse_screenshot`, `browse_run_tests`, `browse_close`.
- Tool handlers in `apps/web/lib/mcp-tools.ts` (`evaluate_page`, `run_ux_test`) call browser-use, not Playwright.
- Client utilities in `apps/web/lib/operate/browser-use-client.ts`.
- LLM backend configurable via `BROWSER_USE_MODEL` env var (default: `gpt-4o`).
- Sandbox URL resolution goes through `apps/web/lib/integrate/sandbox/resolve-sandbox-url.ts` — server-to-server calls (including `run_ux_test`) use the `.internal` URL (e.g. `http://sandbox:3000`), not the host-mapped port.
- **Review-phase verification is automatic.** Entering the `review` phase fires a `build/review.verify` Inngest event (handler at `apps/web/lib/queue/functions/build-review-verification.ts`). The handler writes results to `FeatureBuild.uxTestResults` + `uxVerificationStatus` and persists per-step screenshots via `evidence_dir` to the shared `browser_evidence` volume. Do NOT call `run_ux_test` manually during review — the `build-phase: review` allowlist excludes it; the Inngest handler owns that flow.
- Screenshots are served through `/api/build/<buildId>/evidence/<fileName>` — owner-or-superuser auth, regex-validated path segments, `path.resolve` containment check.
- Design spec: `docs/superpowers/specs/2026-04-06-browser-use-integration-design.md` (§ 8 "Review-phase verification" covers the landed end-to-end flow).

## Git Workflow

- **All changes go through pull requests**, including the maintainer's. This is the rule, enforced by discipline today and by branch protection once the repo flips public (GitHub Free does not expose branch protection for private repos).
- **CI runs on every PR:** typecheck, unit tests, production build. Typecheck and production build are the merge-blocking gates today. Unit tests run but are temporarily informational — see the "broken tests" tracking issue.
- **Maintainer work uses short-lived branches named by intent:** `feat/*` for features, `fix/*` for fixes, `chore/*` for dependency and housekeeping work, `doc/*` for documentation-only changes, `clean/*` for repo hygiene. One concern per branch, one concern per PR.
- **External contributors** fork the repo, branch from `main`, and open a PR against `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Do not push directly to `main`** even though the tier-locked branch protection cannot block you today. The rule is the rule; cutting corners here defeats the workflow that lets CI catch issues on the maintainer's work too.
- **Always push** after committing — local-only commits are invisible to CI, the build pipeline, and other agents.
- **Future — customer branch model:** When customers contribute, each gets one persistent branch (`customer/<id>`), named by who owns them rather than by fix or feature. Changes flow: `customer/<id>` → PR → `main`. This is the branching rationale for thousands of contributors.
- **Branch protection activation:** enabling the GitHub-level enforcement on `main` requires either (a) flipping the repo visibility to public, or (b) upgrading the plan to GitHub Pro/Team. Configure `Typecheck` and `Production Build` as required status checks, include administrators, allow squash-merge or linear history — whichever the maintainer picks.

## AI Coworker Prompts

- Prompt templates live in `prompts/` as `.prompt.md` files with YAML frontmatter.
- Files are the source of truth — seeded to `PromptTemplate` table on deploy.
- Admin can override prompts at runtime via Admin > Prompts. Overrides survive redeploy.
- Hardcoded TypeScript constants remain as last-resort fallback (never delete them).
- Adding a new prompt: create `prompts/<category>/<slug>.prompt.md` with proper frontmatter, then re-run seed.
- The `PromptLoader` (`apps/web/lib/tak/prompt-loader.ts`) reads from DB with 60s cache and fallback to hardcoded constants.
- Composition: use `{{include:category/slug}}` markers and list dependencies in `composesFrom` frontmatter.
- Categories: `platform-identity`, `platform-preamble`, `platform-mission`, `route-persona`, `build-phase`, `specialist`, `reviewer`, `context`.
- **Company Mission**: `prompts/platform-mission/company-mission.prompt.md` is injected into every agent's context. Edit via Admin > Prompts.

## AI Coworker Skills

- Skills follow the Anthropic SKILL.md pattern: `.skill.md` files with YAML frontmatter in `skills/` directory.
- Skills belong to coworkers (not routes). Assigned via `SkillAssignment` in the DB.
- Files are seeded to `SkillDefinition` + `SkillAssignment` tables on deploy (`packages/db/src/seed-skills.ts`).
- `assignTo: ["*"]` assigns to all agents. `assignTo: ["agent-id"]` assigns to specific coworkers.
- Skills vs Tools: skills are procedures/knowledge ("what I know how to do"); tools are external capabilities ("what I can connect to").
- The `getSkillsForAgent()` function (`apps/web/lib/actions/agent-skills.ts`) loads skills from DB with fallback to inline arrays.
- Adding a new skill: create `skills/<category>/<name>.skill.md` with frontmatter, then re-run seed.
- Frontmatter fields: `name`, `description`, `category`, `assignTo`, `capability`, `taskType`, `triggerPattern`, `userInvocable`, `agentInvocable`, `allowedTools`, `composesFrom`, `contextRequirements`, `riskBand`.

## Delegation Chain (Peer Discovery)

- Coworkers can discover and invoke each other's skills via `discoverCoworkerSkills()` and `delegateToCoworker()` in `apps/web/lib/actions/skill-discovery.ts`.
- Authority propagation: capabilities narrow at each hop (intersection of parent scope and skill requirements).
- Loop detection: rejects if target agent already appears in the chain.
- Depth limit: max 4 hops (configurable in `delegation-authority.ts`).
- `DelegationChain` model tracks chain of custody with `chainId`, `depth`, `authorityScope`, and `status`.

## Strongly-Typed String Enums — MANDATORY COMPLIANCE

String fields that carry a fixed set of valid values are **canonical enums** even though the DB column is `String`. Using non-canonical values causes silent data corruption, broken filters, and UI display failures downstream.

**Source of truth: `apps/web/lib/backlog.ts` exports `EPIC_STATUSES` and the TypeScript union types. The MCP tool definitions in `apps/web/lib/mcp-tools.ts` carry the `enum:` arrays. These are the authority — match them exactly.**

### Canonical values — do not deviate

| Model | Field | Valid values |
| ----- | ----- | ------------ |
| `Epic` | `status` | `"open"` `"in-progress"` `"done"` |
| `BacklogItem` | `status` | `"open"` `"in-progress"` `"done"` `"deferred"` |
| `BacklogItem` | `type` | `"portfolio"` `"product"` |

### Rules for all agents and seed scripts

1. **Use only the values in the table above.** Never invent synonyms (`todo`, `complete`, `in_progress`, `archived`, `story`, `feature`, `task`, `backlog`, `epic`). These have all been found in the DB and required mass normalization.
2. **Hyphens, not underscores.** Multi-word statuses use hyphens: `"in-progress"` not `"in_progress"`.
3. **Adding a new value requires two changes in the same commit:**
   - Update the TypeScript union type / `as const` array in `backlog.ts`
   - Add it to the `enum:` array in the relevant MCP tool definition in `mcp-tools.ts`
   - Only then use it in data or seed scripts.
4. **Seed scripts must declare the type explicitly.** Do not rely on defaults for `type` or `status` — write the value out so it is reviewable.
5. **When writing SQL directly** (migrations, seed SQL, backfill scripts), copy-paste the value from this table. Do not paraphrase.
