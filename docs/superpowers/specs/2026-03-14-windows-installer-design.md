# Windows One-Click Installer — Design Spec

**Date:** 2026-03-14
**Goal:** A zero-prerequisites Windows installer that takes a non-technical small business owner from nothing to a running Digital Product Factory portal with local AI, in a single script.

**Target user:** Non-technical. Has never used Docker, WSL, or a terminal. Needs plain-English guidance at every step. "Even my grandmother could do it."

---

## 1. Installer User Experience

### Download
The user goes to the GitHub releases page and clicks "Download Installer for Windows." They get `install-dpf.ps1`.

**Recommended method:** Download the script file, right-click -> "Run with PowerShell." This is the safest approach and the one documented in the README.

**Alternative (advanced):** `irm https://...install-dpf.ps1 | iex` is available but NOT recommended as the primary method due to security concerns (piping remote code to execution). The README should lead with Option A.

### Guided Steps

The script walks through 8 steps with clear messaging:

```
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
    ║  Docker Desktop is free for businesses with       ║
    ║  fewer than 250 employees and under $10M revenue. ║
    ║  See https://docker.com/pricing for details.      ║
    ╚═══════════════════════════════════════════════════╝
  → Waiting for Docker to start...
  ✓ Docker is running

Step 4 of 8: Downloading Digital Product Factory...
  → Downloading latest release...
  ✓ Extracted to C:\DPF

Step 5 of 8: Detecting your hardware...
  → Checking CPU, memory, GPU, and disk space...
  ✓ 16 GB RAM, 8-core CPU, NVIDIA GPU detected
  → Selected AI model: qwen3:1.7b (fast, works well on your hardware)

Step 6 of 8: Starting the platform...
  → Building the portal (first time takes 3-5 minutes)...
  → Starting database, AI engine, and portal...
  ✓ All services healthy

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
  ║  Password: [randomly generated, shown once]          ║
  ║                                                      ║
  ║  Save this password — it won't be shown again!      ║
  ║                                                      ║
  ║  To stop:  Open PowerShell, run: dpf-stop            ║
  ║  To start: Open PowerShell, run: dpf-start           ║
  ╚══════════════════════════════════════════════════════╝
```

**Note:** Hardware detection (Step 5) happens BEFORE starting containers so the installer can configure Docker Desktop resource allocation and select the appropriate AI model. The hardware profile is passed to the portal container via environment variables and written to `PlatformConfig.host_profile` during the migration/seed step.

### Credentials

The installer generates a random admin password (16 chars, alphanumeric) during setup. No hardcoded default password. The password is displayed once in the terminal and also written to `C:\DPF\.admin-credentials` (a file the user can reference if they lose the terminal output). The platform should enforce a password change on first login as a follow-up enhancement.

### Reboot Handling

If WSL2 enablement requires a reboot:

```
  ⚠ Windows needs to restart to finish setting up.

  After your computer restarts:
  1. Open PowerShell (search "PowerShell" in the Start menu)
  2. Run this command:  C:\DPF\install-dpf.ps1
  3. The installer will pick up where it left off

  Restarting in 30 seconds... (press any key to restart now)
```

The script writes progress to `C:\DPF\.install-progress` (JSON tracking completed steps). On re-run, completed steps show as "Already done" and are skipped.

### Error Handling

Every step has a plain-English error message with actionable next steps:

- "Docker Desktop didn't start after 3 minutes. Try opening it from the Start menu, then run this script again."
- "The download failed — check your internet connection and try again."
- "Your Windows version doesn't support WSL2. You need Windows 10 version 2004 or later."
- "Not enough disk space. The platform needs about 5 GB free. You have X GB available."

No stack traces, no technical jargon.

---

## 2. Docker Compose Stack

### Services

| Service | Image | Exposed Ports | Purpose |
|---------|-------|---------------|---------|
| `portal` | Built from `Dockerfile` | 3000 (host) | Next.js app — the platform UI |
| `portal-init` | Built from `Dockerfile` (init target) | none | Runs migrations, seed, hardware detection, then exits |
| `postgres` | `postgres:16-alpine` | none (internal only) | Primary database |
| `neo4j` | `neo4j:5-community` | none (internal only) | Graph database for EA and discovery |
| `ollama` | `ollama/ollama` | none (internal only) | Local AI inference |

**Security note:** Only the portal exposes a port to the host. Database, graph, and AI services are accessible only on the Docker internal network. This prevents external access to Postgres, Neo4j, and Ollama.

### Portal Dockerfile (multi-stage)

```
Stage 1: base       — Node 20 Alpine + pnpm
Stage 2: deps       — Copy pnpm-workspace.yaml, pnpm-lock.yaml, root package.json,
                       apps/web/package.json, packages/db/package.json,
                       packages/db/prisma/schema.prisma → pnpm install
Stage 3: build      — Copy full source → pnpm build (Next.js standalone output)
Stage 4: init       — FROM deps stage: has full node_modules, prisma CLI, tsx,
                       seed data, schema. Used by portal-init service for
                       migrations, seed, and hardware detection.
Stage 5: runner     — FROM base: copy Next.js standalone output only (~200-300MB).
                       Runs node server.js. No dev dependencies.
```

**Key insight:** Migrations and seeding require dev dependencies (Prisma CLI, tsx, seed data files). The Next.js runner does NOT. Splitting these into separate stages (init vs runner) keeps the production portal image slim while still supporting migrations.

**Prerequisite:** `apps/web/next.config.mjs` must be updated to add `output: "standalone"` for the runner stage to work. This is a code change required before the Dockerfile can function.

### Seed Data

All seed data files must live inside the repository. Currently some seed data references paths outside the repo (`ROLES/role_registry.json` at `D:/digital-product-factory/`). The implementation must copy all required seed data into `packages/db/data/` and update `seed.ts` to read from there. The `DPF_DATA_ROOT` environment variable and the 4-levels-up fallback in `seed.ts` line 14 must be updated to resolve within the container.

### Startup Sequence

1. `postgres` starts, health check passes (`pg_isready`)
2. `neo4j` starts in parallel, health check passes
3. `ollama` starts in parallel, model data persists in named volume
4. `portal-init` starts (depends on `postgres` healthy):
   a. `npx prisma migrate deploy` — apply pending migrations
   b. `npx prisma db seed` — seed reference data (idempotent upserts)
   c. `npx tsx scripts/detect-hardware.ts` — write hardware profile to `PlatformConfig`
   d. Exits with code 0
5. `portal` starts (depends on `portal-init` completed):
   a. `node server.js` — start Next.js standalone

### Named Volumes

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL data (survives container restarts) |
| `neo4jdata` | Neo4j data |
| `ollama_models` | Downloaded AI models (don't re-download on restart) |

### Environment Variables

Generated by the installer using `[System.Security.Cryptography.RandomNumberGenerator]` and written to `C:\DPF\.env`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `postgresql://{user}:{random_pass}@postgres:5432/dpf` | Postgres connection (random password, Docker service name) |
| `POSTGRES_USER` | `dpf` | Postgres username |
| `POSTGRES_PASSWORD` | Random 32-char alphanumeric | Postgres password (generated during install) |
| `AUTH_SECRET` | Random 32-byte hex | Auth.js session signing |
| `CREDENTIAL_ENCRYPTION_KEY` | Random 64-char hex | AES-256-GCM for provider credentials |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j connection (Docker service name) |
| `NEO4J_AUTH` | `neo4j/{random_pass}` | Neo4j credentials (random password) |
| `ADMIN_PASSWORD` | Random 16-char alphanumeric | Initial admin password (displayed once) |
| `DPF_HOST_PROFILE` | JSON string from hardware detection | Passed to portal-init for PlatformConfig |

All secrets are cryptographically random — no hardcoded defaults.

---

## 3. Hardware Detection

### During Install (Step 5) — PowerShell on Host

The PowerShell installer detects actual host hardware:
- **CPU** — `(Get-CimInstance Win32_Processor).NumberOfCores`, model name
- **RAM** — `(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory`
- **GPU** — `Get-CimInstance Win32_VideoController` for NVIDIA detection, VRAM
- **Disk** — available space on the install drive

This runs on the HOST (not inside Docker) so it sees real hardware, not container-limited resources.

Results are:
1. Used immediately to select the default Ollama model
2. Serialized as JSON into `DPF_HOST_PROFILE` env var
3. Written to `PlatformConfig.host_profile` by `portal-init`

### On Portal Startup — Container Resources

The `portal-init` service reads `DPF_HOST_PROFILE` from environment (host hardware) and also checks container-available resources (`/proc/meminfo`, `/proc/cpuinfo`). Both are stored:
- `PlatformConfig` key `host_profile` — actual host hardware
- `PlatformConfig` key `container_profile` — resources available to the container

This distinction matters for agent self-awareness: the host may have 32GB RAM but Docker Desktop may only allocate 8GB to containers.

### Model Selection Matrix

| Hardware | Default Model | Rationale |
|----------|--------------|-----------|
| < 8 GB RAM, no GPU | `qwen3:0.6b` | ~400MB, loads in seconds |
| 8-16 GB RAM, no GPU | `qwen3:1.7b` | ~1.4GB, loads in ~12s, decent quality |
| 16+ GB RAM, no GPU | `qwen3:4b` | ~2.5GB, good quality, reasonable speed |
| Any RAM + GPU (4GB+ VRAM) | `qwen3:8b` | ~5GB, high quality, GPU-accelerated |

### Ollama GPU Passthrough

When the installer detects an NVIDIA GPU, the `docker-compose.yml` is configured with GPU passthrough for the Ollama service:

```yaml
ollama:
  image: ollama/ollama
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

If no GPU is detected, this section is omitted and Ollama runs on CPU only.

---

## 4. Convenience Scripts

The installer creates two scripts in `C:\DPF\` and adds the directory to the user's PATH:

| Script | Command | Action |
|--------|---------|--------|
| `dpf-start.ps1` | `dpf-start` | `cd C:\DPF && docker compose up -d` + open browser |
| `dpf-stop.ps1` | `dpf-stop` | `cd C:\DPF && docker compose down` |

---

## 5. Files Affected

### New Files
| File | Purpose |
|------|---------|
| `install-dpf.ps1` | Windows installer (the main deliverable) |
| `Dockerfile` | Multi-stage portal build (init + runner targets) |
| `.dockerignore` | Exclude dev artifacts from Docker build context |
| `scripts/dpf-start.ps1` | Convenience start script |
| `scripts/dpf-stop.ps1` | Convenience stop script |
| `scripts/detect-hardware.ts` | Hardware detection — writes to PlatformConfig (runs in portal-init) |

### Modified Files
| File | Change |
|------|--------|
| `docker-compose.yml` | Add `portal`, `portal-init`, `ollama` services; remove host port mappings for postgres/neo4j; add `ollama_models` volume |
| `apps/web/next.config.mjs` | Add `output: "standalone"` for Docker runner stage |
| `packages/db/src/seed.ts` | Update `REPO_ROOT` resolution to work inside Docker container; copy any external seed data into `packages/db/data/` |
| `README.md` | Installation instructions |

### Generated During Install (not in repo)
| File | Purpose |
|------|---------|
| `C:\DPF\.env` | Generated secrets (all random, no defaults) |
| `C:\DPF\.install-progress` | Reboot recovery state |
| `C:\DPF\.admin-credentials` | Admin email + generated password (reference file) |

---

## 6. Portal Health Check

The portal service includes a health check in `docker-compose.yml`:

```yaml
portal:
  healthcheck:
    test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3000/api/health"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 30s
```

This requires a `/api/health` endpoint in the Next.js app (simple route that returns 200). The installer polls this health check to know when the portal is ready before opening the browser.

---

## 7. Version Pinning

The installer downloads a specific release version (tagged in GitHub). The installed version is written to `C:\DPF\.version`. This supports:
- Knowing which version is running (displayed in the platform UI later)
- Future upgrade/rollback functionality (BI-SELFDEV-004)
- Reproducible installations for compliance

---

## 8. Backlog Items (Added This Session)

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

## 9. What's NOT in Scope

- **Mac/Linux installers** — backlog items BI-DEPLOY-010/011
- **Setup wizard** — backlog item BI-DEPLOY-008 (AI Coworker guides first-time setup)
- **Pre-built Docker images on a registry** — build locally for now, registry is a future optimization
- **HTTPS/SSL** — localhost only for initial install, HTTPS is a deployment concern
- **Custom domain/port** — defaults to `localhost:3000`, configurable later
- **Auto-updates** — backlog item BI-SELFDEV-004
- **Docker Compose profiles** — all services start together for simplicity; optional services is a future optimization
- **Signed `.msi` installer** — PowerShell script for now; signed installer for regulated environments is a future enhancement
