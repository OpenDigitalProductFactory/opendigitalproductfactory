---
title: "Build Runtime (Sandbox)"
area: build-studio
order: 3
---

## Overview

The **Build runtime** — surfaced as **Live preview** in the Build Studio canvas — is the isolated execution environment where your AI Coworker builds, tests, and refines features before they reach the Live portal. Each Build runtime instance has its own database, file system, and runtime, completely separated from the live platform. Nothing the AI Coworker does in the Build runtime can affect your production system.

The Build runtime is not the long-lived source of truth for your code. It starts from the install's shared workspace, runs validation work safely, and can be recreated whenever needed. The technical name behind it is *sandbox* — that name continues to appear in diagnostic surfaces (Platform Development → Runtime Targets, Admin Recovery, log lines, and MCP schemas).

This isolation is what makes it safe for the AI to experiment freely: modifying code, running database migrations, restarting services, and iterating on your feedback without risk.

## How It Works

When you create a new feature in Build Studio and the AI Coworker begins the Build phase, the platform:

1. **Acquires a Build runtime slot** from the pool of available containers (technical name: *sandbox slot*)
2. **Copies the active shared project source** from the running Live portal workspace into the Build runtime workspace
3. **Installs dependencies** (`pnpm install`, Prisma client generation)
4. **Runs database migrations** against the Build runtime's own PostgreSQL instance
5. **Seeds the Build runtime database** with a copy of your live data so the AI works with realistic information
6. **Starts a preview server** so you can see the feature as it is being built
7. **Creates a git baseline** so changes can be tracked as a clean diff for promotion

This process takes roughly 60 to 90 seconds. Once complete, the AI Coworker has a fully functional copy of the platform to work with.

## Build Runtime Isolation

Each Build runtime instance is isolated from the Live portal at every layer:

| Layer | Live portal | Build runtime |
|-------|-----------|---------|
| **Database** | `dpf-postgres-1` (your live data) | `dpf-sandbox-postgres-1` (separate instance, seeded copy) |
| **File system** | Portal application at `/app` | Build runtime workspace at `/workspace` (Docker volume) |
| **Network** | Full access to all services | No access to live credentials or Docker socket |
| **Resources** | Unrestricted | 2 CPU cores, 4 GB memory, 10 GB disk |

The Build runtime has no access to your `.env` file, secrets, API keys, or the Docker socket. It cannot start, stop, or modify the Live portal's containers. Schema changes and database migrations in the Build runtime do not touch the live database.

## Build dispatch engines

Inside the Build runtime, code generation is driven by a **dispatch engine** — the CLI agent that executes build tasks in the sandbox. You choose it under **Platform → AI → Build Studio → Build Dispatch Engine**. Every engine advances the same governed lifecycle and passes the same quality gates; they differ only in the model and vendor behind the code generation. An engine must be **installed in the Build runtime** and have valid credentials before it can run — the selector shows readiness per engine and warns if the selected one is missing.

| Engine | Backing | Status | Notes |
|--------|---------|--------|-------|
| **Claude Code** | Anthropic models | Supported | Needs Anthropic credentials (External Services). |
| **Codex** | OpenAI models | Supported | Needs OpenAI credentials. |
| **Grok** | xAI models | Supported (preview) | Headless `grok -p`; needs xAI credentials. |
| **Local model (OpenCode)** | Your own local LLM | Supported (preview) | Runs offline, no credential required. |
| **Agentic Loop** | Built-in tool-calling loop | Legacy | Fallback path. |

### Why Google Antigravity is not a dispatch engine (yet)

[Google Antigravity](../../operations/antigravity-cli-onboarding.md) (`agy`) is fully supported as a **host contributor CLI** — you run it on your own machine or server to develop the platform, and it connects to DPF over MCP like Claude Code, Codex, and Grok. It is **not** available as an in-sandbox Build Studio dispatch engine today, for two reasons that are outside DPF's control:

1. **Binary compatibility.** The Build runtime image is Alpine Linux (musl libc). Antigravity ships only glibc binaries and publishes no musl build, so `agy` cannot execute inside the sandbox.
2. **Headless-container sign-in.** Antigravity's CLI cannot currently persist its Google sign-in across process restarts inside a headless container (a known upstream limitation) — which is exactly the pattern a dispatch engine needs, since Build Studio re-invokes the engine at each phase.

The second issue reproduces even on a glibc base, so changing the Build runtime image would not resolve it on its own. **Recommendation:** use Antigravity as a host CLI (see the [onboarding runbook](../../operations/antigravity-cli-onboarding.md)); it will be reconsidered as a dispatch engine if and when Google ships a musl build and fixes headless-container authentication.

## AI Coworker Tools

The AI Coworker has a complete set of development tools for working inside the Build runtime. These tools are purpose-built to be safe (Build-runtime-only) and on par with what a professional developer uses. The tool names retain the `sandbox` prefix because they are MCP-bound identifiers and a Phase 1 rename would break callers; the user-facing description has switched to "Build runtime":

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
| **run_sandbox_command** | Run any shell command inside the Build runtime. Used for builds, tests, linting, git operations, dependency management, and verification. |
| **run_sandbox_tests** | Run the full test suite and typecheck. Optionally enables auto-fix mode, which diagnoses failures and attempts fixes up to three times. |

### Code Generation

| Tool | What it does |
|------|-------------|
| **generate_code** | Send a high-level instruction to the coding agent. It analyzes the existing codebase for patterns, generates the code, writes it to the Build runtime, and starts the dev server. |
| **iterate_sandbox** | Send a refinement instruction to improve existing code. The agent reads the current state, applies changes, and updates the preview. |

### Deployment

| Tool | What it does |
|------|-------------|
| **deploy_feature** | Extract the changes from the Build runtime as a git diff and submit them for promotion to the Live portal. This triggers the approval workflow. |

These tools are how the AI Coworker does real development work — not by running arbitrary shell scripts, but through purpose-built operations that handle encoding, path resolution, and error reporting cleanly.

## Build Runtime Pool

The platform maintains a pool of Build runtime containers so multiple features can be developed concurrently. By default, the pool has one slot (configurable via `DPF_SANDBOX_POOL_SIZE`).

Each slot is a pre-created Docker container that gets assigned to a build when needed and returned to the pool when the build completes, fails, or is cancelled. If all slots are in use, the platform falls back to the legacy persistent Build runtime container.

You can monitor pool status from the Build Studio dashboard, which shows how many slots are available and which builds are using them.

## Live Preview

During the Build phase, a preview panel shows the feature as the AI Coworker builds it. The preview server runs inside the Build runtime on port 3000 and serves an auto-refreshing HTML page.

As the AI Coworker creates or modifies files, the preview updates automatically. If the preview content has not been generated yet, you see a "Building Your Feature" spinner that refreshes every five seconds.

## From Build Runtime to Live Portal

When the feature is ready to ship, the AI Coworker (or you) triggers the `deploy_feature` tool. This:

1. Extracts a clean git diff of all changes made in the Build runtime since the baseline
2. Creates a **ChangePromotion** record linking the feature build to the promotion pipeline
3. Submits the promotion for approval

Once approved, the governed promotion pipeline takes over where promotion is enabled. It builds a new Live portal image that includes the Build runtime changes, swaps it into production, runs health checks, and rolls back automatically if anything fails. See [Feature Deployment](deployment.md) for the full eleven-step pipeline.

The key insight is that the Build runtime diff contains only the changes needed for that validation run — not the entire codebase. The Build runtime exists to execute and verify work safely, not to replace the install's shared development workspace.

## Shared Workspace Relationship

Build Studio uses the install's shared workspace as its authoring source:

- in ready-to-go installs, Build Studio is the guided interface over that workspace
- in customizable installs, Build Studio and VS Code use the same workspace and branch
- the Build runtime starts from that shared workspace, then adds isolation for preview, tests, and migration rehearsal

See [Development Workspace](../development-workspace.md) for the full operating model.

## What the AI Coworker Can and Cannot Do

**Can do in the Build runtime:**
- Create, read, edit, and delete any file in the workspace
- Run shell commands (build, test, lint, git)
- Install or update dependencies
- Modify the database schema and run migrations
- Start dev servers and preview builds
- Search the codebase and analyze patterns

**Cannot do from the Build runtime:**
- Access live credentials, API keys, or secrets
- Connect to the live database
- Start, stop, or modify Live portal containers
- Access the Docker socket or host filesystem
- Make network requests to internal services (other than npm registry for dependencies)

## Troubleshooting

**"Build runtime not ready"** — The Build runtime workspace may not have finished initializing. Dependencies take 60-90 seconds to install on first use. Wait and retry.

**"File not found"** — The AI Coworker may be looking for a file using the Live portal path (`/app/...`) instead of the Build runtime path. Build runtime files live under `/workspace/`. The tools handle this translation automatically, but `run_sandbox_command` does not.

**"Typecheck failed"** — The Build runtime runs the same TypeScript compiler as the Live portal. If the typecheck fails, the AI Coworker can use `run_sandbox_tests` with `auto_fix: true` to diagnose and fix the issue automatically (up to three attempts).

**Build stuck in a phase** — Each pipeline step has retry limits. If a step exhausts retries, the build is marked as failed and the Build runtime slot is released. You can create a new feature build to start fresh.
