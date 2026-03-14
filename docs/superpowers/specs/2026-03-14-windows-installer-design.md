# Windows One-Click Installer — Design Spec

**Date:** 2026-03-14
**Goal:** A zero-prerequisites Windows installer that takes a non-technical small business owner from nothing to a running Digital Product Factory portal with local AI, in a single script.

**Target user:** Non-technical. Has never used Docker, WSL, or a terminal. Needs plain-English guidance at every step. "Even my grandmother could do it."

---

## 1. Installer User Experience

### Download
The user goes to the GitHub releases page and clicks "Download Installer for Windows." They get `install-dpf.ps1`.

### Run
Two options (documented in README):
- **Option A:** Right-click `install-dpf.ps1` → "Run with PowerShell"
- **Option B:** Open PowerShell and paste: `irm https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/install-dpf.ps1 | iex`

### Guided Steps

The script walks through 8 steps with clear messaging:

```
╔══════════════════════════════════════════════════════╗
║  Digital Product Factory — Installation              ║
║  This will set up everything you need automatically  ║
╚══════════════════════════════════════════════════════╝

Step 1 of 8: Checking Windows version...
  ✓ Windows 11 Pro detected

Step 2 of 8: Setting up WSL2...
  → Windows needs the "Virtual Machine Platform" feature enabled.
    This is safe — it lets Docker run Linux containers on your machine.
  → Enabling now... (you may see a Windows security prompt — click Yes)
  ✓ WSL2 is ready

Step 3 of 8: Installing Docker Desktop...
  → Downloading Docker Desktop (this takes a minute)...
  → Running the Docker Desktop installer.
    ╔═══════════════════════════════════════════════════╗
    ║  ACTION NEEDED:                                   ║
    ║                                                   ║
    ║  The Docker Desktop installer will open.          ║
    ║  1. Click "Accept" on the license agreement       ║
    ║  2. Leave all checkboxes at their defaults        ║
    ║  3. Click "Install" and wait for it to finish     ║
    ║  4. Click "Close" when done                       ║
    ║                                                   ║
    ║  This is free software for small businesses.      ║
    ╚═══════════════════════════════════════════════════╝
  → Waiting for Docker to start...
  ✓ Docker is running

Step 4 of 8: Downloading Digital Product Factory...
  → Downloading latest release...
  ✓ Extracted to C:\DPF

Step 5 of 8: Starting the platform...
  → Building the portal (first time takes 3-5 minutes)...
  → Starting database, AI engine, and portal...
  ✓ All services healthy

Step 6 of 8: Detecting your hardware...
  → Checking CPU, memory, GPU, and disk space...
  ✓ 16 GB RAM, 8-core CPU, NVIDIA GPU detected
  → Selected AI model: qwen3:1.7b (fast, works well on your hardware)

Step 7 of 8: Setting up your data...
  → Running database setup...
  → Downloading AI model (1.4 GB)... this takes a minute
  ✓ AI Coworker is ready

Step 8 of 8: Opening your portal!
  → Opening http://localhost:3000 in your browser...

  ╔══════════════════════════════════════════════════════╗
  ║  Your Digital Product Factory is ready!              ║
  ║                                                      ║
  ║  URL:      http://localhost:3000                     ║
  ║  Email:    admin@dpf.local                           ║
  ║  Password: changeme123                               ║
  ║                                                      ║
  ║  ⚠ Change your password after first login!          ║
  ║                                                      ║
  ║  To stop:  Open PowerShell, run: dpf-stop            ║
  ║  To start: Open PowerShell, run: dpf-start           ║
  ╚══════════════════════════════════════════════════════╝
```

### Reboot Handling

If WSL2 enablement requires a reboot (common on first-time setup):

```
  ⚠ Windows needs to restart to finish setting up.

  After your computer restarts:
  1. Open PowerShell (search "PowerShell" in the Start menu)
  2. Run this command:  C:\DPF\install-dpf.ps1
  3. The installer will pick up where it left off

  Restarting in 30 seconds... (press any key to restart now)
```

The script writes progress to `C:\DPF\.install-progress` (a JSON file tracking which steps completed). On re-run, completed steps show as "✓ Already done" and are skipped.

### Error Handling

Every step has a plain-English error message:

- "Docker Desktop didn't start after 3 minutes. Try opening it from the Start menu, then run this script again."
- "The download failed — check your internet connection and try again."
- "Your Windows version doesn't support WSL2. You need Windows 10 version 2004 or later."
- "Not enough disk space. The platform needs about 5 GB free. You have X GB available."

No stack traces, no technical jargon. Every error tells the user what to do next.

---

## 2. Docker Compose Stack

### Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `portal` | Built from `Dockerfile` | 3000 | Next.js app — the platform UI |
| `postgres` | `postgres:16-alpine` | 5432 | Primary database |
| `neo4j` | `neo4j:5-community` | 7474, 7687 | Graph database for EA and discovery |
| `ollama` | `ollama/ollama` | 11434 | Local AI inference |

### Portal Dockerfile (multi-stage)

```
Stage 1: base      — Node 20 Alpine + pnpm
Stage 2: deps      — Install all pnpm dependencies
Stage 3: build     — pnpm build (Next.js standalone output)
Stage 4: runner    — Production image with standalone output only (~200MB)
```

### Startup Sequence

1. `postgres` starts, health check passes (`pg_isready`)
2. `neo4j` starts in parallel, health check passes
3. `portal` starts, runs `docker-entrypoint.sh`:
   a. `npx prisma migrate deploy` — apply any pending migrations
   b. `npx prisma db seed` — seed reference data (idempotent upserts)
   c. Hardware re-detection — update `PlatformConfig.host_profile`
   d. `node server.js` — start Next.js
4. `ollama` starts in parallel, model data persists in named volume

### Named Volumes

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL data (survives container restarts) |
| `neo4jdata` | Neo4j data |
| `ollama_models` | Downloaded AI models (don't re-download on restart) |

### Environment Variables

Generated by the installer and written to `C:\DPF\.env` (not committed to repo):

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `postgresql://dpf:dpf_dev@postgres:5432/dpf` | Postgres connection (uses Docker service name) |
| `AUTH_SECRET` | Random 32-byte hex | Auth.js session signing |
| `CREDENTIAL_ENCRYPTION_KEY` | Random 64-char hex | AES-256-GCM for provider credentials |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j connection |
| `NEO4J_AUTH` | `neo4j/dpf_dev_password` | Neo4j credentials |

---

## 3. Hardware Detection

### During Install (Step 6)

The PowerShell script detects:
- **CPU** — core count, model name
- **RAM** — total physical memory
- **GPU** — NVIDIA GPU presence and VRAM (via `nvidia-smi` if available)
- **Disk** — available space on the install drive

This information is used to:
- Select the appropriate default Ollama model (small for constrained hardware, larger for capable machines)
- Set Docker Desktop memory/CPU allocation recommendations
- Store in the platform for agent self-awareness

### On Every Portal Startup

The `docker-entrypoint.sh` runs a lightweight hardware probe inside the container:
- Available memory (`/proc/meminfo`)
- CPU info (`/proc/cpuinfo`)
- GPU availability (check if NVIDIA runtime is present)
- Writes to `PlatformConfig` key `host_profile` via a startup script

This keeps the platform's self-awareness current as the deployment environment changes.

### Model Selection Matrix

| Hardware | Default Model | Rationale |
|----------|--------------|-----------|
| < 8 GB RAM, no GPU | `qwen3:0.6b` | ~400MB, loads in seconds |
| 8-16 GB RAM, no GPU | `qwen3:1.7b` | ~1.4GB, loads in ~12s, decent quality |
| 16+ GB RAM, no GPU | `qwen3:4b` | ~2.5GB, good quality, reasonable speed |
| Any RAM + GPU (4GB+ VRAM) | `qwen3:8b` | ~5GB, high quality, GPU-accelerated |

---

## 4. Convenience Scripts

The installer creates two small scripts in `C:\DPF\` that are added to the system PATH:

| Script | Command | Action |
|--------|---------|--------|
| `dpf-start.ps1` | `dpf-start` | `cd C:\DPF && docker compose up -d` + open browser |
| `dpf-stop.ps1` | `dpf-stop` | `cd C:\DPF && docker compose down` |

These let non-technical users start/stop the platform without knowing Docker commands.

---

## 5. Files Affected

### New Files
| File | Purpose |
|------|---------|
| `install-dpf.ps1` | Windows installer (the main deliverable) |
| `Dockerfile` | Multi-stage portal build |
| `docker-entrypoint.sh` | Portal startup: migrate, seed, detect hardware, start |
| `.dockerignore` | Exclude dev artifacts from Docker build |
| `scripts/dpf-start.ps1` | Convenience start script |
| `scripts/dpf-stop.ps1` | Convenience stop script |
| `scripts/detect-hardware.ts` | Hardware detection for PlatformConfig (runs inside portal container) |

### Modified Files
| File | Change |
|------|--------|
| `docker-compose.yml` | Add `portal` and `ollama` services, add `ollama_models` volume |
| `README.md` | Installation instructions with the one-liner |

### Generated During Install (not in repo)
| File | Purpose |
|------|---------|
| `C:\DPF\.env` | Generated secrets |
| `C:\DPF\.install-progress` | Reboot recovery state |

---

## 6. Backlog Items (Added This Session)

| Item | Title | Epic | Status |
|------|-------|------|--------|
| BI-DEPLOY-008 | First-time setup wizard guided by AI Coworker | EP-DEPLOY-001 | open |
| BI-DEPLOY-009 | Web-hosted SaaS deployment | EP-DEPLOY-001 | open |
| BI-DEPLOY-010 | Mac installer | EP-DEPLOY-001 | open |
| BI-DEPLOY-011 | Linux installer | EP-DEPLOY-001 | open |
| EP-SELF-DEV-001 | AI-Driven Platform Self-Development | (new epic) | open |
| BI-SELFDEV-001 | Code generation agent with sandboxed execution | EP-SELF-DEV-001 | open |
| BI-SELFDEV-002 | Visual feature builder for non-developers | EP-SELF-DEV-001 | open |
| BI-SELFDEV-003 | Governed code deployment with HITL approval | EP-SELF-DEV-001 | open |
| BI-SELFDEV-004 | Platform self-update and version management | EP-SELF-DEV-001 | open |

---

## 7. What's NOT in Scope

- **Mac/Linux installers** — backlog items BI-DEPLOY-010/011
- **Setup wizard** — backlog item BI-DEPLOY-008 (AI Coworker guides first-time setup)
- **Pre-built Docker images on a registry** — build locally for now, registry is a future optimization
- **HTTPS/SSL** — localhost only for initial install, HTTPS is a deployment concern
- **Custom domain/port** — defaults to `localhost:3000`, configurable later
- **Auto-updates** — backlog item BI-SELFDEV-004
