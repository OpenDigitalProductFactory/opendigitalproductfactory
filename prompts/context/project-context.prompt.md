---
name: project-context
displayName: Project Context
description: Codebase knowledge equivalent to CLAUDE.md — architecture, conventions, routes, database, debugging tips
category: context
version: 1

composesFrom: []
contentFormat: markdown
variables: []

valueStream: ""
stage: ""
sensitivity: internal
---

--- Project Knowledge (equivalent to CLAUDE.md) ---

ARCHITECTURE:
- Next.js 16 monorepo with pnpm workspaces
- Two packages: apps/web (Next.js app) and packages/db (Prisma ORM)
- API routes live at: apps/web/app/api/<endpoint>/route.ts
- Shared libraries at: apps/web/lib/
- Prisma schema at: packages/db/prisma/schema.prisma (large file — use offset/limit when reading)
- Tailwind CSS with CSS custom properties for theming

ROUTE GROUPS — CRITICAL (Next.js uses parenthesized folders for layout grouping):
- (shell)/         — Internal portal pages. REQUIRES AUTHENTICATION (staff login). Employee-facing features go here.
                     Examples: (shell)/customer/, (shell)/workspace/, (shell)/finance/, (shell)/employee/
- (storefront)/    — Public-facing storefront pages. NO AUTHENTICATION required. Customer/visitor-facing.
                     Structure: (storefront)/s/[slug]/<feature>/page.tsx (each storefront has a slug)
                     Examples: (storefront)/s/[slug]/checkout/, (storefront)/s/[slug]/inquire/
- (customer-auth)/ — Customer authentication flows (login, signup, profile completion). Public.
- (auth)/          — Internal staff auth flows (login, forgot-password). Public.
- (setup)/         — First-run setup wizard. Internal.

ROUTING RULES:
- Public forms that ANYONE can access (no login) > put under (storefront)/s/[slug]/
- Authenticated customer-facing dashboards > put under (shell)/customer/
- Internal staff tools > put under (shell)/<feature>/
- NEVER put public pages in (shell)/ — they will redirect to login
- ALWAYS use list_sandbox_files to check existing route structure before creating new routes

KEY PATHS:
- Internal pages: apps/web/app/(shell)/         — authenticated portal pages
- Public pages:   apps/web/app/(storefront)/     — unauthenticated storefront pages
- Customer hub:   apps/web/app/(shell)/customer/ — authenticated customer pages (engagements, quotes, orders, etc.)
- API:            apps/web/app/api/              — all API endpoints
- Lib:            apps/web/lib/                  — shared code, actions, utilities
- DB:             packages/db/prisma/schema.prisma — database schema
- Types:          apps/web/lib/*-types.ts        — TypeScript type definitions

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
