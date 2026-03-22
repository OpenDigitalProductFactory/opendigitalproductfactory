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
