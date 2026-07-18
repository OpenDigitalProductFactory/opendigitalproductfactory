---
title: "Developer Setup"
area: getting-started
order: 4
---

## Developer Setup (IDE + Hot-Reload)

For developers who want to run Next.js locally with IDE integration, debugging, and hot-reload. Databases run in Docker with ports exposed to your host machine. This is separate from the Windows installer — it's for working on the platform itself.

If you want the packaged customer experience, use the installer instead — see the repo `README.md` Quick Start.

### Prerequisites

| Tool | Version |
| ---- | ------- |
| [Git](https://git-scm.com/download/win) | Latest |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 4.40+ |
| [Node.js](https://nodejs.org/) | 20+ |
| [pnpm](https://pnpm.io/) | 9+ |

### Option A: Automated script

```powershell
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git
cd opendigitalproductfactory
.\scripts\fresh-install.bat
```

The script will:

- Install pnpm dependencies (`node_modules`)
- Create all `.env` files (Docker + app-level) with generated secrets
- Start PostgreSQL with port 5432 exposed to the host
- Run database migrations and seed data (including all epic/backlog SQL scripts)

Then start the dev server:

```powershell
pnpm --filter web dev      # http://localhost:3000
```

### Option B: Manual setup

```bash
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git
cd opendigitalproductfactory
pnpm install
```

**Create environment files:**

```bash
# 1. Root .env — used by Docker Compose for container credentials
cp .env.docker.example .env

# 2. App-level .env file — used by Next.js and local Prisma commands
cp .env.example apps/web/.env.local
```

Then edit `.env` and `apps/web/.env.local` to replace the `<generate with: ...>` placeholders with real values. On Windows PowerShell:

```powershell
# Generate AUTH_SECRET (base64)
[Convert]::ToBase64String((1..32 | ForEach-Object { [byte](Get-Random -Max 256) }))
# Generate CREDENTIAL_ENCRYPTION_KEY (hex)
-join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
```

Or use the automated script (Option A) which handles this automatically.

If you have an older install with `packages/db/.env`, Prisma still treats it as a legacy fallback, but new installs should not need it.

**Start databases (with ports exposed to host):**

If you are in a linked git worktree, run `scripts/seed-worktree-mcp.ps1` on Windows or `scripts/seed-worktree-mcp.sh` on macOS / Linux before any Compose command. The seeder writes an ignored `.env` value like `COMPOSE_PROJECT_NAME=dpf-<topic>` so worktree containers and volumes cannot join the root `dpf` project.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

This exposes PostgreSQL on port 5432 to your host machine.

**Run migrations and seed:**

```bash
pnpm --filter @dpf/db exec prisma generate       # Generate Prisma client
pnpm --filter @dpf/db exec prisma migrate deploy # Apply all migrations
pnpm --filter @dpf/db seed                       # Seed roles, agents, taxonomy, admin user
```

**Build the promoter image** (required for Build Studio feature deployment):

```bash
docker build -f Dockerfile.promoter -t dpf-promoter .
```

**Start the dev server:**

```bash
pnpm --filter web dev      # http://localhost:3000
```

Login: `admin@dpf.local` / `changeme123`

### Running Tests

```bash
pnpm typecheck         # TypeScript across all workspaces
pnpm test              # Vitest unit tests (web + db + mobile)
pnpm test:e2e          # Playwright end-to-end against running portal
pnpm test:e2e:demo     # Headed sandbox-preview demo
```

### Branching

After `install-dpf.ps1` runs in Customizable mode, your clone sits on a per-install branch named `dpf/<instance-id>`. That branch is the shared workspace for Build Studio and VS Code on this install — leave it where it is.

**For feature work, create short-lived topic branches off `main`:**

```bash
git fetch origin
git checkout -b feat/my-thing origin/main
# ... work, commit ...
git push -u origin feat/my-thing
gh pr create --base main
```

Branch prefixes by intent: `feat/*`, `fix/*`, `chore/*`, `doc/*`, `clean/*`. One concern per branch. See [CONTRIBUTING.md](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/CONTRIBUTING.md) for the full PR workflow.

### Related

- [Dev Container Setup](dev-container.md) — fully containerized alternative, no local Node.js required
- [Agent Development Environments](agent-dev-environments.md) — set up Claude, Codex, and Grok (desktop apps or CLI): MCP, skill pack, AGENTS.md, local settings, and managing multiple concurrent threads
- [Development Workspace](../development-workspace.md) — how Build Studio, VS Code, and production promotion fit together
