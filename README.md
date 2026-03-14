# Open Digital Product Factory

An open, agentic digital product management platform built on IT4IT v3 governance principles.
Every user sees only the workspace capabilities their role permits. In-platform AI agents help teams manage their digital product portfolio collaboratively — with a goal of the platform maintaining itself.

> **Vision — Hive Mind:** Each installation is a node. Extend locally. Contribute extensions back to the shared repo. The community grows the platform from within.

---

## Quick Install (Windows)

1. Download `install-dpf.ps1` from the [latest release](https://github.com/markdbodman/opendigitalproductfactory/releases)
2. Right-click the file → **Run with PowerShell**
3. Follow the guided steps (5-10 minutes)

The installer will set up everything automatically: Docker, databases, AI engine, and the portal.

**After installation:**
- **Start:** Open PowerShell and run `dpf-start`
- **Stop:** Open PowerShell and run `dpf-stop`

---

## What It Does (Today)

- Role-scoped workspace — log in as any of 6 IT4IT human roles and see only your tiles
- Live status counts pulled from PostgreSQL (products, portfolios, active agents)
- Auth-protected routes (Auth.js v5, JWT session)
- Typed permission registry — 14 capabilities, 6 roles, no template conditionals

## What's Coming

| Phase | Scope |
|---|---|
| 2A | Portfolio + Inventory + EA Modeler routes |
| 2B | Employee CRM + Customer Portal |
| 2C | Admin plane (branding, taxonomy, agent admin) |
| 3 | Operations + Scheduler + Activity log |
| 4 | Feature parity + VS Code independence (agents maintain the portal) |

---

## For Developers

Clone and run locally:

```bash
# Clone and install
git clone https://github.com/markdbodman/opendigitalproductfactory.git
cd opendigitalproductfactory
pnpm install

# Start databases
docker compose up -d postgres neo4j

# Setup database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Start dev server
pnpm dev
```

Open http://localhost:3000

Log in with:
- **Email:** `admin@dpf.local`
- **Password:** `changeme123`

> Change this password immediately for any non-local deployment.

---

## Prerequisites (for developers)

| Tool | Version | Install |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Required — runs the databases |
| [Node.js](https://nodejs.org/) | 20+ | Required |
| [pnpm](https://pnpm.io/) | 9+ | `npm install -g pnpm` |
| [Git](https://git-scm.com/) | Any | Required |

---

## Manual Setup (Step by Step)

If you prefer to understand each step or the setup script doesn't work on your system:

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment files
cp .env.example apps/web/.env.local
cp .env.example packages/db/.env

# Edit apps/web/.env.local and set AUTH_SECRET to a random string:
#   Mac/Linux: openssl rand -hex 32
#   Windows PowerShell: python -c "import secrets; print(secrets.token_hex(32))"

# 3. Start the databases (PostgreSQL + Neo4j)
docker compose up -d

# 4. Run database migrations and seed default data
pnpm db:migrate
pnpm db:seed

# 5. Start the development server
pnpm dev
```

---

## Project Structure

```
opendigitalproductfactory/
├── apps/
│   └── web/                 # Next.js 14 App Router application
│       ├── app/             # Pages and layouts (App Router)
│       ├── components/      # Shared React components
│       ├── lib/             # Auth, permissions, server actions
│       └── types/           # TypeScript module declarations
├── packages/
│   └── db/                  # Prisma schema + client singleton
│       └── prisma/
│           └── schema.prisma
├── docker-compose.yml       # PostgreSQL 16 + Neo4j 5
├── Makefile                 # Shortcut commands
└── .env.example             # Environment variable template — copy, don't edit
```

---

## Common Commands

```bash
make dev          # Start Docker databases + Next.js dev server
make test         # Run Vitest test suite
make typecheck    # TypeScript type check (must pass before PRs)
make build        # Production build
make db-seed      # Re-seed the database
make db-reset     # Drop, recreate, and re-seed the database
make help         # List all available commands
```

Or use pnpm directly:

```bash
pnpm dev           # Dev server
pnpm test          # Tests
pnpm typecheck     # tsc --noEmit
pnpm build         # Production build
pnpm db:migrate    # Run Prisma migrations
pnpm db:seed       # Seed database
pnpm db:studio     # Prisma Studio — visual database browser
```

---

## Contributing

Everyone is welcome. The goal is a platform that anyone can extend and give back to the community.

### The Hive Mind Model

- Run your own installation
- Add capabilities, roles, or domain routes for your context
- If it's useful to others, open a pull request and share it back

### How to Contribute

1. Fork the repo on GitHub
2. Set up locally (Quick Start above)
3. Create a branch: `git checkout -b feat/my-extension`
4. Make your changes
5. Run `make test` and `make typecheck` — both must pass clean
6. Open a pull request with a clear description

### Extension Points

| What | Where |
|---|---|
| New workspace tile | Add capability to `lib/permissions.ts` → add tile to `ALL_TILES` |
| New role | Extend `PlatformRoleId` + `PERMISSIONS` in `lib/permissions.ts` |
| New domain route | Add page under `app/(shell)/` and register the capability |
| New data model | Add model to `packages/db/prisma/schema.prisma` + migration |

### Code Standards

- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- All new features need Vitest tests
- `pnpm typecheck && pnpm test` must pass before any PR is merged

---

## Architecture

- **Next.js 14** App Router — React Server Components, Server Actions
- **Prisma 5** + **PostgreSQL 16** — structured data
- **Auth.js v5** — JWT sessions, Credentials provider
- **Neo4j 5** — graph traversal for EA modelling (Phase 2+)
- **Typed permission registry** — `can(user, capability)` is the single source of truth for all role-gated rendering
- **pnpm workspaces** — monorepo with `apps/web` and `packages/db`
- **Vitest** — fast TypeScript-native tests

---

## License

[MIT](LICENSE)
