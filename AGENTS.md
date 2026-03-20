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

### Verification

- Run `pnpm typecheck` before claiming work is complete.
- If a migration was added, verify it applies cleanly.
- Do not claim a feature works without testing it.

### Communication

- If uncommitted changes exist, mention them before starting new work.
- When committing, list what's included so the user can verify.

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

## Design Principles

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

### Consistency
- Before creating new patterns, check existing components: TabNav variants, page layouts, route structure
- Follow established naming conventions: `{Area}TabNav`, `{Area}PageClient` for client wrapper components
- Server components fetch data and pass to client components for interactivity
