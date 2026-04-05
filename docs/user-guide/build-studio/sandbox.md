---
title: "Sandbox Development Environment"
area: build-studio
order: 3
lastUpdated: 2026-03-30
updatedBy: Claude (Software Engineer)
---

## Overview

The sandbox is an isolated execution environment where your AI Coworker builds, tests, and refines features before they reach production. Each sandbox has its own database, file system, and runtime — completely separated from the live platform. Nothing the AI Coworker does in the sandbox can affect your production system.

The sandbox is not the long-lived source of truth for your code. It starts from the install's shared workspace, runs validation work safely, and can be recreated whenever needed.

This isolation is what makes it safe for the AI to experiment freely: modifying code, running database migrations, restarting services, and iterating on your feedback without risk.

## How It Works

When you create a new feature in Build Studio and the AI Coworker begins the Build phase, the platform:

1. **Acquires a sandbox slot** from the pool of available containers
2. **Copies the active shared project source** from the running portal workspace into the sandbox workspace
3. **Installs dependencies** (`pnpm install`, Prisma client generation)
4. **Runs database migrations** against the sandbox's own PostgreSQL instance
5. **Seeds the sandbox database** with a copy of your production data so the AI works with realistic information
6. **Starts a preview server** so you can see the feature as it is being built
7. **Creates a git baseline** so changes can be tracked as a clean diff for promotion

This process takes roughly 60 to 90 seconds. Once complete, the AI Coworker has a fully functional copy of the platform to work with.

## Sandbox Isolation

Each sandbox is isolated from production at every layer:

| Layer | Production | Sandbox |
|-------|-----------|---------|
| **Database** | `dpf-postgres-1` (your live data) | `dpf-sandbox-postgres-1` (separate instance, seeded copy) |
| **File system** | Portal application at `/app` | Sandbox workspace at `/workspace` (Docker volume) |
| **Network** | Full access to all services | No access to production credentials or Docker socket |
| **Resources** | Unrestricted | 2 CPU cores, 4 GB memory, 10 GB disk |

The sandbox has no access to your `.env` file, secrets, API keys, or the Docker socket. It cannot start, stop, or modify production containers. Schema changes and database migrations in the sandbox do not touch the production database.

## AI Coworker Tools

The AI Coworker has a complete set of development tools for working inside the sandbox. These tools are purpose-built to be safe (sandbox-only) and on par with what a professional developer uses:

### File Operations

| Tool | What it does |
|------|-------------|
| **write_sandbox_file** | Create a new file or overwrite an existing one. Handles encoding automatically — no shell escaping issues even with complex code. Creates parent directories as needed. |
| **read_sandbox_file** | Read a file with line numbers. Supports `offset` and `limit` for reading portions of large files (e.g., reading lines 100-200 of a 5,000-line schema). |
| **edit_sandbox_file** | Make a surgical find-and-replace edit to an existing file. Supports `replace_all` for renaming a variable or import across the entire file. |

### Search and Navigation

| Tool | What it does |
|------|-------------|
| **search_sandbox** | Search for a text pattern across all files. Supports regex patterns and file type filters (e.g., search only `*.ts` files). |
| **list_sandbox_files** | List files matching a glob pattern (e.g., `apps/web/app/(shell)/**/*.tsx`). |

### Build, Test, and Run

| Tool | What it does |
|------|-------------|
| **run_sandbox_command** | Run any shell command inside the sandbox. Used for builds, tests, linting, git operations, dependency management, and verification. |
| **run_sandbox_tests** | Run the full test suite and typecheck. Optionally enables auto-fix mode, which diagnoses failures and attempts fixes up to three times. |

### Code Generation

| Tool | What it does |
|------|-------------|
| **generate_code** | Send a high-level instruction to the coding agent. It analyzes the existing codebase for patterns, generates the code, writes it to the sandbox, and starts the dev server. |
| **iterate_sandbox** | Send a refinement instruction to improve existing code. The agent reads the current state, applies changes, and updates the preview. |

### Deployment

| Tool | What it does |
|------|-------------|
| **deploy_feature** | Extract the changes from the sandbox as a git diff and submit them for promotion to production. This triggers the approval workflow. |

These tools are how the AI Coworker does real development work — not by running arbitrary shell scripts, but through purpose-built operations that handle encoding, path resolution, and error reporting cleanly.

## Sandbox Pool

The platform maintains a pool of sandbox containers so multiple features can be developed concurrently. By default, the pool has one slot (configurable via `DPF_SANDBOX_POOL_SIZE`).

Each slot is a pre-created Docker container that gets assigned to a build when needed and returned to the pool when the build completes, fails, or is cancelled. If all slots are in use, the platform falls back to the legacy persistent sandbox container.

You can monitor pool status from the Build Studio dashboard, which shows how many slots are available and which builds are using them.

## Live Preview

During the Build phase, a preview panel shows the feature as the AI Coworker builds it. The preview server runs inside the sandbox on port 3000 and serves an auto-refreshing HTML page.

As the AI Coworker creates or modifies files, the preview updates automatically. If the preview content has not been generated yet, you see a "Building Your Feature" spinner that refreshes every five seconds.

## From Sandbox to Production

When the feature is ready to ship, the AI Coworker (or you) triggers the `deploy_feature` tool. This:

1. Extracts a clean git diff of all changes made in the sandbox since the baseline
2. Creates a **ChangePromotion** record linking the feature build to the promotion pipeline
3. Submits the promotion for approval

Once approved, the autonomous promotion pipeline takes over. It builds a new portal image that includes the sandbox changes, swaps it into production, runs health checks, and rolls back automatically if anything fails. See [Feature Deployment](deployment.md) for the full eleven-step pipeline.

The key insight is that the sandbox diff contains only the changes needed for that validation run — not the entire codebase. The sandbox exists to execute and verify work safely, not to replace the install's shared development workspace.

## Shared Workspace Relationship

Build Studio uses the install's shared workspace as its authoring source:

- in ready-to-go installs, Build Studio is the guided interface over that workspace
- in customizable installs, Build Studio and VS Code use the same workspace and branch
- the sandbox starts from that shared workspace, then adds isolation for preview, tests, and migration rehearsal

See [Development Workspace](../development-workspace) for the full operating model.

## What the AI Coworker Can and Cannot Do

**Can do in the sandbox:**
- Create, read, edit, and delete any file in the workspace
- Run shell commands (build, test, lint, git)
- Install or update dependencies
- Modify the database schema and run migrations
- Start dev servers and preview builds
- Search the codebase and analyze patterns

**Cannot do from the sandbox:**
- Access production credentials, API keys, or secrets
- Connect to the production database
- Start, stop, or modify production containers
- Access the Docker socket or host filesystem
- Make network requests to internal services (other than npm registry for dependencies)

## Troubleshooting

**"Sandbox not ready"** — The sandbox workspace may not have finished initializing. Dependencies take 60-90 seconds to install on first use. Wait and retry.

**"File not found"** — The AI Coworker may be looking for a file using the production path (`/app/...`) instead of the sandbox path. Sandbox files live under `/workspace/`. The tools handle this translation automatically, but `run_sandbox_command` does not.

**"Typecheck failed"** — The sandbox runs the same TypeScript compiler as production. If the typecheck fails, the AI Coworker can use `run_sandbox_tests` with `auto_fix: true` to diagnose and fix the issue automatically (up to three attempts).

**Build stuck in a phase** — Each pipeline step has retry limits. If a step exhausts retries, the build is marked as failed and the sandbox slot is released. You can create a new feature build to start fresh.
