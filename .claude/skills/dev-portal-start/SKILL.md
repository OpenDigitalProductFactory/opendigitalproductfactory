---
name: dev-portal-start
description: Use when a DPF contributor needs to verify worktree edits on the **Contributor preview** runtime (port 3001) without rebuilding the Live portal image. Triggers — making any edit under apps/web/ that needs visual or HTTP-level confirmation; iterating on /build, /platform, /admin, or any other server-rendered route; debugging a UX change against real workspace data; reproducing a customer-visible bug in a worktree before opening a PR. This is a CONTRIBUTOR-ONLY workflow; customer installs do not ship the Contributor preview by default. Don't use for unit-test-only changes (no preview needed) or for changes that need the production-bundled Live portal specifically (rebuild that image instead).
---

# dev-portal-start

## Overview

Brings up the **Contributor preview** runtime — the `dev-portal` Next.js hot-reload service on `http://localhost:3001` — against the live DPF databases, leaving the Live portal on `:3000` untouched as the stable reference. Every source edit under `apps/web/` is visible within a few seconds (or one container restart for file-watcher-stubborn cases).

This eliminates the ~2-minute Live-portal-rebuild loop that otherwise gates every edit-verify cycle.

The Contributor preview is a **DPF-contributor-only** surface, gated behind the `dev` compose profile. Customer installs (e.g. Dale's HVAC shop) do not ship it by default and do not see a `:3001` URL. If you are not a DPF contributor editing the platform source, you do not need this skill.

## When to Use

**Symptoms that trigger this skill (contributor workflow):**

- "I changed `apps/web/app/(shell)/build/page.tsx` and want to see it."
- "I need to verify the gate fires on a real install before merging."
- "The Live portal at :3000 shows old code — how do I see my edits?"
- "I edited `loadBuildStudioCapability` and tests pass; need to see the live UX."
- "I'm reproducing a customer-reported bug in a worktree."

**Do not use when:**

- The change is unit-test-only (run `pnpm exec vitest` and you're done).
- The change is to the Live-portal-bundle build itself (Docker image content, entrypoint, etc.) — rebuild `portal` instead.
- The change is to non-portal services (sandbox, adp, browser-use) — those have their own rebuild cycles.
- You are not a DPF contributor. End users and customer-install operators interact with Build Studio's Live preview through the canvas, not through `:3001`.

## Core Pattern

### Before (the failure baseline this skill prevents)

Agent edits `apps/web/.../page.tsx`. Tests pass. Agent wants to verify in browser.

```
Agent: "I'll rebuild the portal image."          (~2 min, every edit)
Agent: "Wait, that restarts the Live portal."
Agent: "Maybe dev-portal? Let me look it up..."  (5 min reading compose files)
Agent: "Why doesn't dev-portal see live data?"   (10 min debugging dev-init DB clone)
Agent: "Why is my edit not loading?"             (10 min on Windows-Docker file watch)
Agent: "Why does docker exec say the path is /c/Program Files/Git/..."  (5 min MSYS gotcha)
```

Total: ~30+ minutes for the first edit-verify cycle. Repeated every session.

### After (with this skill)

```bash
# One-time per worktree: ensure docker-compose.dev-against-live-db.yml exists
# (it should already be checked in — see the file's header comment for the rationale)

# Bring up dev-portal:
docker compose -p dpf \
  -f /d/DPF/docker-compose.yml \
  -f docker-compose.dev-against-live-db.yml \
  --profile dev up -d dev-portal

# Wait for ready:
until curl -sf http://localhost:3001/api/health >/dev/null 2>&1; do sleep 3; done

# Open http://localhost:3001/<route> — your edits are live.
```

Total: ~30 seconds on first bring-up, ~5 seconds for subsequent edits (just save and refresh).

## Quick Reference

| Task                         | Command                                                                                                                                            |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| First bring-up               | `docker compose -p dpf -f /d/DPF/docker-compose.yml -f docker-compose.dev-against-live-db.yml --profile dev up -d dev-portal`                      |
| Wait for ready               | `until curl -sf http://localhost:3001/api/health >/dev/null 2>&1; do sleep 3; done`                                                                |
| Force-reload after edit      | `docker restart dpf-dev-portal-1` (use when file-watcher misses the edit)                                                                          |
| Tail logs                    | `docker logs --tail 50 -f dpf-dev-portal-1`                                                                                                        |
| Inspect path inside container| `MSYS_NO_PATHCONV=1 docker exec dpf-dev-portal-1 ls /workspace/...`                                                                                |
| Stop dev-portal              | `docker compose -p dpf --profile dev stop dev-portal`                                                                                              |
| Stop and remove              | `docker compose -p dpf --profile dev rm -sf dev-portal`                                                                                            |

Verify the gate / page renders at `http://localhost:3001/<route>` (not `:3000`).

## Common Mistakes

### Mistake 1 — Running compose without `-p dpf`

```bash
# WRONG (creates a new compose project with sibling DBs)
docker compose -f docker-compose.dev-against-live-db.yml --profile dev up -d dev-portal

# RIGHT (attaches to existing dpf project so postgres/neo4j/qdrant resolve)
docker compose -p dpf -f /d/DPF/docker-compose.yml \
  -f docker-compose.dev-against-live-db.yml --profile dev up -d dev-portal
```

Without `-p dpf`, compose spins up brand-new `<worktree>-postgres-1` etc. — dev-portal can't see your real data, the override's `service: postgres` dependency resolves to the NEW empty container, and you're suddenly running two parallel database stacks.

### Mistake 2 — Forgetting `--profile dev`

`dev-portal` (and `dev-init`, `dev-postgres`, etc.) live behind `profiles: ["dev"]` in the base compose. Without `--profile dev`, compose silently skips them and you get nothing.

### Mistake 3 — Skipping the override file

The base `dev-portal` service points at `dev-postgres` (an isolated dev DB). The override file in this worktree swaps it to the live `postgres` so you see real workspace data. Without the override, `:3001` shows an empty install and you'll waste time wondering why your gate didn't fire on the data you can see at `:3000`.

### Mistake 4 — Expecting `depends_on` to override cleanly

The base file has `dev-portal.depends_on.dev-init`. A plain `depends_on` block in the override MERGES (doesn't replace) — `dev-init` will still try to run, fail at the sanitized-clone step, and block dev-portal startup. The override file uses `depends_on: !reset` (compose 2.20+) to drop the merged deps first, then re-declare only the live stack. Don't remove that `!reset`.

### Mistake 5 — Edits don't show up in the browser

Windows + Docker Desktop bind-mounts use WSL2 file-event forwarding that loses inotify events. Next.js dev's file watcher misses some edits. Two fixes:

- **Restart dev-portal:** `docker restart dpf-dev-portal-1` (forces a full re-read on next request).
- **Polling watcher:** add `WATCHPACK_POLLING=true` to dev-portal's env (slower but reliable).

If a single restart doesn't fix it, the edit may have a compile error — check `docker logs --tail 60 dpf-dev-portal-1` for `Module not found` / `Cannot find name` / etc.

### Mistake 6 — `docker exec ... /workspace/...` returns "No such file or directory"

git-bash on Windows rewrites `/workspace/...` to `C:/Program Files/Git/workspace/...` before passing to `docker exec`. Prefix the command with `MSYS_NO_PATHCONV=1`:

```bash
# WRONG (path gets mangled)
docker exec dpf-dev-portal-1 ls /workspace/apps/web

# RIGHT
MSYS_NO_PATHCONV=1 docker exec dpf-dev-portal-1 ls /workspace/apps/web
```

### Mistake 7 — Forgetting the override file lives in the WORKTREE

The override path is relative (`docker-compose.dev-against-live-db.yml`) — meaning compose resolves it from your current working directory. Run the bring-up command from the worktree root, not from `D:/DPF`. If you `cd /d/DPF && docker compose ...`, you'll get `no such file` because the override is in the worktree, not in the main install.

### Mistake 8 — Treating dev-portal data as throwaway

This is intentional: the Contributor preview (`dev-portal`) writes to the LIVE DB. A coding mistake under `apps/web/` that mutates DB state will affect the Live portal at `:3000` too. Keep `:3000` as the safety reference; use `:3001` knowingly.

## When to Tear Down

When you're done verifying:

```bash
docker compose -p dpf --profile dev rm -sf dev-portal
```

The override file stays in the worktree (it's checked in). The dev-postgres / dev-neo4j containers from the unused `dev-init` step can be left running idle or stopped with `docker compose -p dpf --profile dev stop`.
