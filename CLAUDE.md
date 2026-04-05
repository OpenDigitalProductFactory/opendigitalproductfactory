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

## Git Workflow

- **Customizable (Option 2) mode:** The primary working directory is the cloned repo (e.g., `D:\DPF`). All development uses **feature branches and pull requests** — never commit directly to `main`.
- **Branch naming:** `feat/<short-name>`, `fix/<short-name>`, `refactor/<short-name>`
- **PR flow:** Create branch, commit work, push, open PR via `gh pr create`, merge after review.
- **Always push** after committing — local-only commits are invisible to the build pipeline and other agents.
- **Feature branches are expected.** Don't avoid branching — it's the standard workflow.
- The `main` branch is the release branch. PRs are the gate.

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
