/**
 * Project context injected into the AI Coworker's system prompt.
 * This is the equivalent of CLAUDE.md — it gives the AI the same
 * project knowledge that a developer working in the codebase has.
 *
 * Without this, the AI flies blind: it doesn't know the project
 * structure, conventions, or where things live.
 */

export const PROJECT_CONTEXT = `
--- Project Knowledge (equivalent to CLAUDE.md) ---

ARCHITECTURE:
- Next.js 16 monorepo with pnpm workspaces
- Two packages: apps/web (Next.js app) and packages/db (Prisma ORM)
- App pages live at: apps/web/app/(shell)/<feature>/page.tsx
- API routes live at: apps/web/app/api/<endpoint>/route.ts
- Shared libraries at: apps/web/lib/
- Prisma schema at: packages/db/prisma/schema.prisma (large file — use offset/limit when reading)
- Tailwind CSS with CSS custom properties for theming

KEY PATHS:
- Pages: apps/web/app/(shell)/         — all user-facing pages
- API:   apps/web/app/api/             — all API endpoints
- Lib:   apps/web/lib/                 — shared code, actions, utilities
- DB:    packages/db/prisma/schema.prisma — database schema
- Types: apps/web/lib/*-types.ts       — TypeScript type definitions

CONVENTIONS:
- Pages use 'use client' directive for interactive components
- Server actions in apps/web/lib/actions/
- CSS: NEVER use hardcoded colors (text-white, bg-white, hex values). Use var(--dpf-text), var(--dpf-muted), var(--dpf-surface-1), var(--dpf-border), var(--dpf-accent)
- Accessibility: semantic HTML, keyboard navigation, WCAG AA contrast, aria attributes
- Components: use existing patterns — read a similar page before creating new ones

DATABASE:
- Prisma 7.x — NEVER use npx prisma (use pnpm --filter @dpf/db exec prisma)
- To add a model: edit schema.prisma, then run_sandbox_command "cd packages/db && pnpm exec prisma migrate dev --name <name>"
- To generate client after schema change: run_sandbox_command "pnpm --filter @dpf/db exec prisma generate"
- The sandbox has its own database — schema changes here do NOT affect production

PROCESS — how to build a feature:
1. Read existing similar pages to understand patterns (read_sandbox_file)
2. Plan the data model changes needed (if any)
3. Edit the Prisma schema (edit_sandbox_file on packages/db/prisma/schema.prisma)
4. Run migration (run_sandbox_command "cd packages/db && pnpm exec prisma migrate dev --name add-complaint")
5. Generate Prisma client (run_sandbox_command "pnpm --filter @dpf/db exec prisma generate")
6. Create new page files (write_sandbox_file)
7. Create API routes if needed (write_sandbox_file)
8. Verify with typecheck (run_sandbox_command "pnpm exec tsc --noEmit")

DEBUGGING — when something fails:
- Read the error message carefully before trying again
- If a tool fails, try a different approach — do NOT call the same tool with the same arguments
- If edit_sandbox_file fails to find text, read the file first to see exact content
- If the schema is too large to read whole, use offset and limit parameters
- Qdrant errors are irrelevant for most features — ignore them
- "Sandbox not ready" usually means dependencies need installing: run_sandbox_command "pnpm install"

VERIFICATION — before claiming done:
- Run typecheck: run_sandbox_command "pnpm exec tsc --noEmit"
- Run tests: run_sandbox_tests
- Check the diff: run_sandbox_command "git diff"
- NEVER claim success without running verification first
`;
