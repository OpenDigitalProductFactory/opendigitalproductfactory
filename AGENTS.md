# Agent Guardrails

## Live State vs Seed Data

- For any request about current epics, backlog, users, roles, capabilities, or status, query the live database first.
- Treat `packages/db/src/seed.ts` as bootstrap defaults only, not runtime truth.
- Only use seed content when the user explicitly asks about bootstrap data, migrations, or initial setup behavior.
- If live DB access fails, state that clearly and label any fallback output as a seed/default snapshot, not live state.

## Never Fabricate

- Do not make things up. If you don't know, say so or ask for pointers.
- Always research existing code, specs, patterns, and conventions before creating something new.
- Do not fabricate test cases, configurations, architecture patterns, or data without grounding them in what actually exists.
- If no clear precedent exists, ask the user for direction rather than inventing.
- This applies to both code generation AND conversational responses — never claim a capability, status, or result that isn't verified.

## Mutation Safety

- Do not edit `seed.ts` to represent day-to-day runtime changes.
- Runtime workflow changes should be made through app actions, migrations, or direct DB operations as appropriate.

## Backlog & Planning

- The backlog lives in the PostgreSQL database (`Epic`, `BacklogItem` tables). Always query the live DB for current state.
- Before starting new work, review open epics and their backlog items to understand priorities and dependencies.
- Design specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check for existing designs before starting work on an epic — some have specs ready to implement.
- When completing backlog items, update their status in the DB to keep the backlog trustworthy.
- When suggesting what to work on next, consider: items with existing designs first, then dependencies between items, then impact.

### Epic Lifecycle Stewardship

Epics must be actively managed — not just created and forgotten.

**Before creating a new epic:**
1. Query existing epics: `SELECT "epicId", title, status FROM "Epic" ORDER BY "createdAt" DESC;`
2. Look for epics with overlapping scope — same domain, similar goals, or superseding intent.
3. If a related epic exists, prefer adding items to it or updating its scope over creating a new one.
4. If the new epic genuinely supersedes an older one, mark the old one as done or delete it (if empty) in the same operation.

**When completing backlog items:**
- The system auto-closes epics when all items reach done/deferred status. However, if you complete the last item in an epic via a direct DB operation (SQL seed script, not the server action), you must manually flip the epic to done.
- After finishing work on a backlog item, always update its status immediately — stale open items cause the epic to appear incomplete.

**Periodic hygiene (apply when reviewing the backlog):**
- Epics with 0 items and status "open" are noise — either add items or delete them.
- Epics where all items are done but status is still "open" must be flipped to done.
- Epics that have been superseded by newer, more specific epics should be closed or deleted.

## Branching & Workflow

### Core Rule

- **Work directly on `main`.** Do not create feature branches or worktrees unless the user explicitly asks for one.
- Commit early, commit often. Small, focused commits on `main` are preferred over long-lived branches.

### Why

- Worktrees and feature branches caused lost uncommitted work across multiple directories.
- This is a single-developer project where `main` is the working branch.
- Simplicity beats process overhead — if something breaks, `git revert` is straightforward.

### Commits

- Commit completed work promptly so nothing is lost.
- Use descriptive commit messages that explain *why*, not just *what*.
- Do not batch unrelated changes into a single commit.

### When to Branch (exception, not default)

- Only create a branch if the user explicitly requests one.
- Only create a branch for experimental work the user wants to isolate.
- If a branch is created, merge or discard it quickly — do not let branches linger.

### Verification — Build Gate (mandatory)

Work is NOT complete until the production build passes. This is non-negotiable.

**Required checks before claiming any task, epic, or session is done:**

1. **Unit tests pass** — `npx vitest run` for affected test files (at minimum)
2. **Production build succeeds** — `cd apps/web && npx next build` must complete with zero errors
3. **Migration applies cleanly** — if a migration was added, verify it applies without drift

**When to run the build:**
- After completing each epic or logical chunk of work (not after every single commit)
- Before claiming a feature is "done" or "shipped"
- Before any session wrap-up summary that lists completed work

**Why this matters:** TypeScript errors, missing imports, and type mismatches only surface during `next build` — not during `vitest run` or IDE checks. The project has experienced 300+ build errors discovered only at the end of a development cycle because builds were not run incrementally. Catching these early (per-epic, not per-release) is dramatically cheaper.

**If the build fails:**
- Fix the errors before moving to the next task
- Do not defer build fixes to a later session
- If the failure is pre-existing (not caused by your changes), note it explicitly but still fix if feasible

**Subagent dispatchers:** When dispatching implementation subagents for the final task in an epic, include "run `cd apps/web && npx next build` and fix any errors" as part of the task.

### Communication

- If uncommitted changes exist, mention them before starting new work.
- When committing, list what's included so the user can verify.

## Design Research — Best-of-Breed Benchmarking

Every new feature design MUST include a research phase benchmarking against open source and commercial best-of-breed solutions before finalizing the spec. This is not optional — it prevents reinventing solved problems and ensures the platform adopts proven patterns.

### When to Research

- Before writing or updating any design spec (`docs/superpowers/specs/`)
- When adding a new domain capability (booking, CRM, invoicing, etc.)
- When the design involves scheduling, workflow, or data model decisions with well-known industry patterns

### What to Research

1. **Open source leaders** — Find 2-3 actively maintained open source projects in the same domain. Read their data models (Prisma schemas, DB migrations), not just their feature lists.
2. **Commercial best-of-breed** — Identify 2-3 commercial products that dominate the vertical. Study their API docs, data models, and architectural patterns.
3. **Anti-patterns** — Search for known pitfalls (race conditions, timezone bugs, stale data) specific to the domain.

### What to Document

The spec must include a "Research & Benchmarking" section with:
- Systems compared and what was learned from each
- Patterns adopted (with attribution) and why
- Patterns rejected and why
- Gaps our design fills that existing solutions don't (our differentiators)
- Anti-patterns identified and how the design avoids them

### Integration with Build Process

Platform AI coworkers involved in feature design (Build Studio, architecture agents) must:
- Search for open source implementations before proposing data models
- Reference specific projects and schemas, not abstract "best practices"
- Flag when a proposed design diverges from established industry patterns and justify the divergence

This research step is part of the brainstorming/design phase, not a separate task. It feeds directly into the spec.

---

## Data Model Stewardship

When adding any large feature, audit the existing schema for refactoring opportunities before finalising the new data model. Do not proceed with a spec until this audit is complete.

### Indicators that refactoring is needed

- A domain-specific model is being re-used as a shared concept (e.g. reading org name from `BrandingConfig`)
- The same logical data (name, slug, address, contact info) appears independently in two or more existing models
- A new feature needs "meta" data (identity, location, ownership) that has no canonical home in the schema

### What to do

1. Identify the shared concept and propose a canonical model for it
2. Update consuming models to reference the canonical model (FK or nullable override)
3. Note any other refactoring opportunities discovered but deferred — add them to the spec's "future refactoring" section so they are not lost
4. Document the decision in the spec; do not silently absorb the refactor into implementation

### Standing example

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, not from environment variables, not from a bespoke field on another model.

## Schema Migration Conventions

Prisma migration files are the ETL layer for schema-level data transformations. Every migration that moves, renames, or restructures existing data must include the data transformation SQL inline — not as a separate script, not as a one-off manual step.

### The rule

When a migration does any of the following, it must include backfill SQL in the same migration file:
- Moves a column's data to a new model (e.g. `BrandingConfig.companyName` → `Organization.name`)
- Adds a non-nullable column to an existing table with rows
- Renames a column (expand: add new, backfill, contract: drop old — across separate migrations)
- Sets a FK that must be populated from existing data

### Pattern

```sql
-- 1. DDL generated by prisma migrate dev (do not hand-edit the table definitions)
CREATE TABLE "Organization" (...);
ALTER TABLE "BrandingConfig" ADD COLUMN "organizationId" TEXT;

-- 2. Backfill: copy existing data into the new structure
INSERT INTO "Organization" ("id", "orgId", "name", "slug", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ORG-000001', "companyName",
       lower(regexp_replace("companyName", '[^a-z0-9]+', '-', 'g')),
       now(), now()
FROM "BrandingConfig" WHERE scope = 'organization' LIMIT 1;

-- 3. Link FK to backfilled rows
UPDATE "BrandingConfig" bc
SET "organizationId" = o.id
FROM "Organization" o
WHERE bc.scope = 'organization';
```

### Workflow

1. Run `pnpm migrate` — Prisma generates the DDL skeleton
2. Open the generated `.sql` file and add backfill SQL after the DDL
3. Run `pnpm migrate` again (or `pnpm db:push` in sandbox) to verify it applies cleanly
4. Commit the migration file alongside the schema change

### Migration files are immutable after commit

**Never modify a migration file after it has been committed.** Prisma stores checksums of applied migrations and will detect any change, causing drift that blocks `migrate dev` on every other environment.

- To correct a past migration: create a **new** migration that applies the fix
- To add missing backfill SQL: create a new data-only migration
- If drift has already occurred: run `npx prisma migrate resolve --applied <migration-name>` for each drifted file to re-sync checksums without data loss

A pre-commit hook (`.githooks/pre-commit`) blocks commits that modify existing migration `.sql` files. This hook is active when `git config core.hooksPath .githooks` has been set (done automatically at repo setup). If you clone this repo fresh, run:
```bash
git config core.hooksPath .githooks
```

### Local dev drift

If the local dev DB has drifted despite the hook (e.g. SQL was applied directly without `migrate dev`), use `prisma migrate resolve --applied <name>` to re-sync each affected migration's checksum. This preserves all data. Only use `prisma migrate reset --force` on a truly empty dev DB — never on an environment with backlog, seed, or user data.

### When NOT to use this pattern

- Pure additive changes (new nullable columns, new tables with no existing data to migrate): no backfill needed
- Sandbox-only iteration: use `prisma db push` — no migration files needed in the sandbox
- Large datasets (millions of rows): use a separate background job with batching; do not block the migration transaction

## Design Principles

> **FOR SUBAGENT DISPATCHERS:** When dispatching any subagent that creates or modifies UI components, you MUST include the Theme-Aware Styling rules below in the subagent prompt. Subagents do not read AGENTS.md — they only know what you tell them. Failure to include theming context results in components that ignore the platform's branding system.

These principles apply to all new UI development on the platform.

### Section Organization
- Use tab-nav with sub-routes for section organization (e.g., `/admin`, `/admin/branding`, `/admin/settings`)
- Follow the pattern established by EA Modeler, AI Workforce, and Ops — each TabNav component lives in `components/{area}/` and is rendered by each sub-route page
- When a section grows beyond one concern, split into tabs rather than cramming onto one page

### Progressive Disclosure
- Simple defaults for most users; AI coworker for advanced control
- Expose only essential fields (3-5) in manual forms
- Advanced configuration happens through the AI coworker conversation, not through raw field editors

### Setup Flows
- Wizard-first for initial configuration (when no data exists)
- Quick-edit form for returning users (when data already exists)
- "Re-run wizard" link available from quick-edit for starting over

### Welcome Messages
- All AI coworker agents use a consistent greeting format:
  1. Identity: "I'm [role name]."
  2. Capabilities: "I can help you [2-3 things]."
  3. Skills hint: "You can also explore more actions in the skills menu above."
- Single canonical greeting per agent (no random rotation)
- Restricted variant remains for permission-limited users

### Theme-Aware Styling (mandatory)

**Never use hardcoded colors for text, backgrounds, or borders.** All UI must use the platform's CSS custom properties so that light mode, dark mode, and user-configured branding all work automatically.

| Role | Use | Never use |
|------|-----|-----------|
| Body/heading text | `text-[var(--dpf-text)]` | `text-white`, `text-black`, `text-gray-*`, `#xxx` |
| Secondary/muted text | `text-[var(--dpf-muted)]` | `text-gray-400`, `#8888a0`, etc. |
| Backgrounds | `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]` | `bg-white`, `bg-[#1a1a2e]`, etc. |
| Borders | `border-[var(--dpf-border)]` | `border-gray-*`, `#2a2a40`, etc. |
| Accent/interactive | `text-[var(--dpf-accent)]`, `bg-[var(--dpf-accent)]` | Hardcoded hex accent values |
| Page background | `bg-[var(--dpf-bg)]` | `bg-[#0d0d18]`, `bg-white` |

**The only exception** is `text-white` on `bg-[var(--dpf-accent)]` buttons, where white text on a colored background is intentional and always readable.

Inline `style={{ color: "#xxx" }}` objects are equally prohibited — use CSS variable references: `style={{ color: "var(--dpf-text)" }}`.

`<option>` elements in `<select>` dropdowns must have explicit `className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"` for cross-browser consistency.

These variables are defined in `globals.css` (base theme) and overridden at runtime by branding configuration tokens. Using them ensures every surface respects the user's chosen brand.

### Consistency
- Before creating new patterns, check existing components: TabNav variants, page layouts, route structure
- Follow established naming conventions: `{Area}TabNav`, `{Area}PageClient` for client wrapper components
- Server components fetch data and pass to client components for interactivity

## Usability Standards

All UI development must follow `docs/platform-usability-standards.md`. This document defines the CSS variable system, contrast requirements, form element standards, and prohibited color patterns. AI agents generating or reviewing UI code MUST consult this document.
