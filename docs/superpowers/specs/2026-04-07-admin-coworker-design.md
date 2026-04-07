# Admin AI Coworker — Design Spec
**Date:** 2026-04-07  
**Status:** Approved for implementation  
**Ticket:** TAK-ADMIN-001

---

## Problem

The Build Studio AI Coworker operates within the `/build` route with tools scoped to sandbox
file operations. Platform administration (container restarts, log inspection, migration runs,
provider configuration, seed execution) currently requires the developer to drop out to a
terminal. This creates friction and means administrative knowledge lives outside the system.

The goal is an Admin Coworker that can do what a knowledgeable developer would do in a
terminal — but inside the portal, with audit logging, explicit approval for destructive
actions, and guardrails that prevent it from touching anything outside the install directory.

---

## Principles

1. **Same model, narrower tools.** The Admin Coworker uses the same agentic loop and routing
   as the Build Coworker. What differs is the tool registry — administrative tools instead of
   sandbox file tools.

2. **Explicit approval for destructive operations.** Any action that cannot be undone by a
   git reset or a container restart requires the user to type "confirm" before execution.
   This mirrors the pattern used in this session: list steps, wait for approval.

3. **Install directory only.** All file access is restricted to `PROJECT_ROOT` (the DPF
   install directory). No access to the host OS outside that boundary.

4. **No upstream git push.** The Admin Coworker can commit locally. It cannot push to
   upstream or any remote without explicit user approval per-push.

5. **Audit log everything.** Every tool call — including read-only ones — is logged to
   `AdminActivity` (new DB table) with timestamp, user, tool name, parameters, and result
   summary.

---

## Scope: What the Admin Coworker Can Do

### Tier 1 — Read-only (no approval needed)
- View container status and health
- Tail logs from any service (portal, sandbox, postgres, neo4j, etc.)
- Read files within `PROJECT_ROOT`
- Query the database (SELECT only)
- List running containers and their resource usage
- Check pending migrations
- View current AI provider status and routing config

### Tier 2 — Reversible operations (no approval needed)
- Restart a container (`docker compose restart <service>`)
- Run `prisma migrate deploy` (applies pending migrations — reversible by rolling back)
- Run the seed script
- Clear stale sandbox slots
- Regenerate Prisma client

### Tier 3 — Irreversible or high-impact (require explicit "confirm")
- `docker compose down` (takes services offline)
- Drop/truncate a database table
- `prisma migrate reset` (destroys all data)
- Delete files within `PROJECT_ROOT`
- Modify `.env` or any credentials file
- Push to git remote
- Any command matching the same blocklist as `run_sandbox_command`

---

## New Tools

### `admin_run_command(command, tier)`
Runs a shell command on the host (not inside a container). Restricted to:
- `docker compose` subcommands
- `git` subcommands (within `PROJECT_ROOT`)
- `pnpm` subcommands (within `PROJECT_ROOT`)
- Working directory is always `PROJECT_ROOT`

Blocklist (same as sandbox, plus host-specific additions):
- Any path traversal outside `PROJECT_ROOT`
- `rm -rf` against any path
- `curl | sh`, `wget | sh`
- `docker run` with `--privileged` or volume mounts outside `PROJECT_ROOT`
- Direct postgres commands (use `admin_query_db` instead)

Tier 3 commands require the tool to return a confirmation prompt before executing.

### `admin_view_logs(service, lines?)`
`docker compose logs <service> --tail <lines>`. Read-only. No approval needed.
Services must be in the known service list from `docker-compose.yml`.

### `admin_query_db(sql)`
Runs a read-only SQL query against the portal database.
- Only `SELECT` statements permitted (enforced by regex + pg role)
- Returns results as a formatted table
- Max 1000 rows

### `admin_read_file(path)`
Reads a file within `PROJECT_ROOT`. Same path traversal guard as sandbox file tools.
Explicitly excludes `.env`, `*.key`, `*.pem`, `*secret*` filenames.

### `admin_write_file(path, content)` — Tier 3
Writes a file within `PROJECT_ROOT`. Requires confirm for `.env` and any config files.
Full audit log of old content → new content.

### `admin_restart_service(service)` — Tier 2
`docker compose restart <service>`. Service must be in allowed list.

### `admin_run_migration()` — Tier 2
`prisma migrate deploy` inside the portal container. Returns migration status.

### `admin_run_seed()` — Tier 2
Runs the seed script inside the portal container.

---

## Route and Access Control

- Route: `/admin` (new shell route, separate from `/build`)
- Access: `admin` platform role only (existing `PlatformRole` model)
- The agent prompt for this route explicitly states all tier rules
- Tool `sideEffect` flags:
  - Tier 1: `sideEffect: false`
  - Tier 2: `sideEffect: false` (reversible)
  - Tier 3: `sideEffect: true` — triggers HITL approval gate in the agentic loop

---

## Audit Table

```prisma
model AdminActivity {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  toolName    String
  parameters  Json
  result      String   // "success" | "blocked" | "confirmed" | "denied"
  summary     String?  // first 500 chars of output
  tier        Int      // 1, 2, or 3
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([createdAt])
  @@index([toolName])
}
```

---

## What It Does NOT Get

- `run_sandbox_command` — no sandbox access from the admin route
- `write_sandbox_file`, `edit_sandbox_file` — no build workspace access
- Any tool that spawns an LLM sub-agent (no nested inference)
- Access to `USER_DATA_DIR` or any OS path outside `PROJECT_ROOT`
- Network calls to external services (except through existing AI provider routes)

---

## Implementation Order

1. `AdminActivity` migration + Prisma model
2. New tool definitions in `mcp-tools.ts` with `buildPhases: ["admin"]`
3. Tool handlers with tier enforcement and blocklist
4. `/admin` route in `app/(shell)/admin/page.tsx`
5. Agent prompt for the admin route (in `build-agent-prompts.ts` or a new `admin-agent-prompts.ts`)
6. Route registration in `agent-routing.ts` with `admin` role requirement
7. Audit logging hook

---

## Example Interactions

> "Why is the portal slow?"  
→ Checks container stats, tails portal logs last 100 lines, reports memory/CPU

> "The sandbox is stuck"  
→ `docker compose restart sandbox`, confirms it's responding, clears stale DB slots

> "Apply the pending migrations"  
→ Shows what migrations are pending, runs `prisma migrate deploy`, confirms result

> "What's in the PlatformDevConfig table?"  
→ `admin_query_db("SELECT * FROM \"PlatformDevConfig\"")`, returns formatted result

> "Delete the orphaned FeatureBuild records"  
→ Shows the DELETE query it would run, asks for "confirm", executes only on confirmation

---

## Relationship to Hive Mind

At scale, the Admin Coworker also becomes the mechanism by which upstream can push
configuration updates (model defaults, policy changes, routing updates) to client installs —
gated by the same approval flow. The admin agent reviews the proposed change, the human
confirms, and it's applied. This replaces manual `git pull` + rebuild cycles.
