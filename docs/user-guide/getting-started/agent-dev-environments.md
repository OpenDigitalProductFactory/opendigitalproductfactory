---
title: "Agent Development Environments — Claude, Codex, Grok"
area: getting-started
order: 7
---

## Agent Development Environments — Claude, Codex, Grok

This guide is for contributors who want to develop the platform with a **dedicated AI coding agent** — Claude, Codex, or Grok — instead of (or alongside) the in-portal **Build Studio**. Each agent ships in more than one form, and **all of them are valid options**:

| Agent | Available as | Notes |
| ----- | ------------ | ----- |
| **Claude** | Desktop app (Mac/Windows), IDE extension (VS Code / JetBrains), **or** CLI (Claude Code) | Use whichever client you prefer; they share the same `~/.claude` config |
| **Codex** | Desktop / IDE client app **or** CLI | Both read the same `~/.codex/config.toml` |
| **Grok** | **CLI only** | No GUI client yet — the Grok CLI is the only surface today |

Whether you run the **desktop app** or the **CLI**, the DPF setup is the same: connect the **DPF MCP server**, load the **`dpf-platform` skill pack** and the **AGENTS.md** operating doctrine, and adjust a few **local client settings** so the agent follows the portal's processes. These agents are the more advanced surface — they let an experienced contributor run **multiple concurrent threads of work** (one branch and one git worktree per thread) while still adhering to every process the portal establishes.

If you only want the guided experience, use [Build Studio](build-studio/index) and stop here. If you want to drive the platform from a full agent client, read on.

> **One process, three surfaces.** Claude, Codex, and Build Studio are interchangeable adapters behind one contract: the evidence-gated lifecycle (`ideate → plan → build → review → ship`), the DPF MCP coordination plane, and the worktree/lease isolation model. Governance reads the *evidence*, never *which surface produced it*. See the [Unified Delivery Surfaces spec](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md).

---

### Why a dedicated agent client instead of Build Studio?

| | Build Studio (in-portal) | Agent clients (Claude / Codex / Grok) |
| --- | --- | --- |
| Audience | Non-technical operators; guided authoring | Experienced contributors comfortable with git |
| Concurrency | One guided build at a time per operator | **Many concurrent threads** — one branch + one worktree each |
| Source access | Governed, abstracted | Direct source edits, debugging, arbitrary tooling |
| Same governance? | **Yes** — identical gates, MCP coordination, PR/DCO, evidence | **Yes** — identical gates, MCP coordination, PR/DCO, evidence |

The headline advantage is **thread management**: several worktrees open at once, each on its own branch and its own isolated Docker Compose project, without their working trees, container names, or HEADs colliding. The rest of this guide is mostly about doing that *without* breaking the processes the portal depends on.

---

### Prerequisites

You need the base developer environment first — see [Developer Setup](developer-setup) (pnpm + Docker sidecars) or the [Dev Container Setup](dev-container). Then install **at least one** agent client:

| Agent | Where to get it |
| ----- | --------------- |
| **Claude** (desktop app, IDE extension, or Claude Code CLI) | [code.claude.com/docs](https://code.claude.com/docs) |
| **Codex** (desktop/IDE app or CLI) | [developers.openai.com/codex](https://developers.openai.com/codex) |
| **Grok** (CLI — no GUI yet) | xAI Grok Build CLI (`grok`) |

You do not have to install all three, or pick one form over another. The setup is symmetric: install whatever you like, run the bootstrap, and add more later by re-running it.

---

### Step 1 — Wire MCP, the skill pack, and AGENTS.md (one command)

From the repo root, run the **agent toolchain bootstrap**. It is the single, client-agnostic entry point that connects every installed client — desktop app or CLI — to DPF in one pass:

```bash
# macOS / Linux
bash scripts/dpf-bootstrap-agent-toolchain.sh

# Windows (PowerShell)
.\scripts\dpf-bootstrap-agent-toolchain.ps1
```

The bootstrap is **idempotent** (re-running on a converged install is a no-op) and writes the **shared client configuration that both the desktop app and the CLI read** (`~/.claude`, `~/.codex/config.toml`, `~/.grok/config.toml`). It:

1. **Detects** which of Claude / Codex / Grok are installed — resolving GUI-app and non-PATH install locations, not just `which`.
2. **Mints and persists a DPF MCP token** if one isn't present (issued inside the portal container, persisted to `~/.dpf/agent-toolchain.env` and your shell profile, never logged). Default scope is `write` so the agent can use side-effecting MCP tools (backlog, evidence, Build Studio handoff). On macOS it also injects the token via `launchctl` so GUI-launched apps — which don't read your shell profile — still pick it up.
3. **Connects the DPF MCP server** in each client (`.mcp.json` / `.vscode/mcp.json` for Claude, `[mcp_servers.dpf]` in Codex/Grok config), all referencing `${DPF_MCP_BEARER_TOKEN}`.
4. **Installs the `dpf-platform` skill pack** for each client (the kernel-principle-enforcing skills — worktree-per-session, evidence-before-diagnosis, pr-with-dco, etc.).
5. **Seeds kernel-tier memory** so the agent is kernel-aware from the first turn, before any MCP retrieval round-trip.
6. **Runs read-only MCP + kernel smoke probes** and prints a single **readiness banner**.

After it finishes, **restart the client** (desktop app or CLI) so it reloads the MCP connection and the skill pack.

> **AGENTS.md is already in the repo.** `AGENTS.md` at the repo root is the canonical rulebook, and the tool-specific pointer files (`CLAUDE.md`, `.cursor/rules/`, `.clinerules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.continue/rules/`) already point to it — they're checked in. You don't author these; you just make sure your client loads project instructions (most do automatically from the repo root). **Don't duplicate rules into the pointer files** — they are pointers, not copies.

#### Reading the readiness banner

| State | Meaning | Next action |
| ----- | ------- | ----------- |
| `ready` | Client(s) wired, MCP reachable, kernel principle fired | Start working |
| `partial` | One client is ready; another needs setup | Repair toolchain (re-run bootstrap) |
| `missing_cli` | No supported agent detected | Install Claude / Codex / Grok |
| `missing_token` | No DPF MCP token | Issue a development token (Admin → Platform Development → MCP) |
| `needs_refresh` | Token exists but the running client hasn't picked it up | Restart the client / refresh the binding |
| `failed_smoke` | Installed but did not apply a kernel principle | View evidence under `--show-substrate` |

Re-run with `--show-substrate` for plugin/config/memory detail, or `--dry-run` to preview writes. See [docs/operations/install.md](../../operations/install) for what each state means in depth.

---

### Step 2 — Adjust local client settings to match DPF's processes

The bootstrap wires the connection, but a few **client-local settings** are not DPF's to set for you. Check these so your agent's defaults don't fight the portal's processes:

#### Turn off "open PRs as draft"

**This is the important one.** Some clients open pull requests as **drafts by default** — Codex's GitHub/cloud integration is known to do this. **DPF does not use draft PRs.** Per [AGENTS.md §4](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/AGENTS.md), *a PR means ready to merge* — there is no draft→final review process to graduate through. A pushed branch is the in-flight handoff artifact; the PR is opened only when the branch is green and ready for merge automation.

In your client's GitHub / PR settings, **disable any "create pull requests as draft" default** so your PRs open **ready for review**. If a PR is opened as a draft by mistake, mark it ready for review immediately (or close it and keep the branch).

#### Confirm the DPF MCP server is connected

After restarting, verify the `dpf` connector is present:
- **Claude** — run `/mcp`; you should see the `dpf` server and its tools.
- **Codex / Grok** — the `[mcp_servers.dpf]` block is in your config; the server appears once the client restarts with the token in its environment.

If it's missing, the token probably isn't in the running client's environment yet — restart the client (GUI apps need a full restart to pick up a freshly minted token), or re-run the bootstrap.

#### Let the client load project instructions

Make sure your client reads repo-root project instructions (`AGENTS.md` via its pointer file). Desktop apps and CLIs generally do this automatically when opened at the repo root; if your client has a "project rules / instructions" setting, point it at the repo root rather than copying rules elsewhere.

#### Be deliberate about auto-run / auto-approve

DPF relies on local guardrails — the pre-commit secret scan + typecheck hook (`git config core.hooksPath .githooks`, auto-set on new clones), and for **Claude Code** a `PreToolUse` **lease guard** (`scripts/hooks/lease-guard.mjs`) that *refuses* ungoverned dev-server launches (`pnpm/npm/yarn dev`, `next dev`, `turbo dev`). Don't loosen these. Emergency bypass for the lease guard only: prefix `DPF_ALLOW_UNGATED_SERVER=1`.

> **Codex and Grok get the same contract by reading it, not by a hook.** There's no `.claude/settings.json` equivalent that fires for them, so comply **by construction**: claim a lease before launching any shared runtime, claim a Work Capsule before you start, record evidence as you go. A shared `dpf worktree` wrapper to enforce this for Codex/Grok is planned.

---

### Per-agent specifics

#### Claude

- Desktop app, IDE extension, and Claude Code CLI share `~/.claude`, so one bootstrap covers whichever you run. Loads the `dpf-platform` skill pack and `dpf` MCP connector via the repo-local marketplace + `.claude/settings.json` (which also declares the lease guard and worktree/transcript hooks).

#### Codex

- Desktop/IDE app and CLI both read `~/.codex/config.toml`. The bearer token is referenced via `bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`, never stored in the file. **Check the draft-PR default** (above).

#### Grok

- **CLI only — no GUI client yet.** Reads the DPF MCP server block from `~/.grok/config.toml` (HTTP transport, same `${DPF_MCP_BEARER_TOKEN}` pattern).
- **Authentication to xAI** is separate from the DPF MCP token. Preferred path is the OAuth **device-code** flow — `grok login --device-auth` opens `accounts.x.ai/oauth2/device`; you sign in with Google / X / Apple and the credential lands in `~/.grok/auth.json`. An `XAI_API_KEY` is the fallback. (Build Studio's containerized Grok dispatch uses the same credential model — see the [Grok device-code OAuth spec](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-07-grok-device-code-oauth-design.md).)

---

### The DPF MCP token (all clients)

All clients authenticate to the DPF MCP server with the same `DPF_MCP_BEARER_TOKEN` environment variable, referenced (never inlined) from each client's config. `.mcp.json` and `.vscode/mcp.json` are **gitignored credential files** — never commit them.

- **Scopes.** Coarse `read` / `write` / `admin` plus granular per-tool grants. Default is `read` and cannot call side-effecting tools. Use **Issue write token** in Admin → Platform Development → MCP when an agent must create/update backlog items, evidence, capsules, or coordination records.
- **Scope escalation.** If a tool returns `insufficient_token_scope`, *stop* — do not fall back to `psql`/Prisma/direct DB edits. Issue a scoped token in the portal, update the client, call `/api/mcp/token/refresh`, and retry through MCP.
- **Rotation** (no file edits): set the `DPF_MCP_BEARER_TOKEN` user environment variable to the new value, `POST /api/mcp/token/refresh` with the new token, then retry in the running session.

---

### Managing multiple threads

This is where the agent clients go beyond Build Studio. The model is simple and strict:

> **One thread = one branch = one git worktree.** Never share a working tree across sessions — that causes index/HEAD collisions and cross-thread file sweeps.

#### Never work in the root clone

The root clone (`~/dpf` on macOS/Linux, `d:\DPF` on Windows) is **shared mutable state**. The self-upgrade loop and other concurrent sessions rewrite its working tree and HEAD without coordinating with your editor — they *will* roll back or discard work that lives only there. Treat the root clone as **merge / release / inspection only**. See the [Collision-Free Dev Workflow](../../dev/collision-free-dev-workflow) for the full failure analysis.

#### Spin up an isolated thread

```bash
# macOS / Linux — off the freshest origin/main, MCP + toolchain seeded automatically
./scripts/new-dev-worktree.sh <slug> [branch-prefix]   # default prefix: feat
cd ~/dpf-worktrees/<slug>
```

`new-dev-worktree.sh` resolves the true root clone, bases the new branch on `origin/main`, places the worktree at the canonical sibling base (`~/dpf-worktrees/<slug>` / `D:/DPF-worktrees/<topic>`), and runs the MCP + toolchain seed so the `dpf` connector and an **isolated Docker Compose stack** work immediately. Each worktree gets its own `COMPOSE_PROJECT_NAME=dpf-<topic>` so its containers and volumes can't join the root `dpf` project.

> **`.mcp.json` does not travel with a worktree** — it's gitignored (it carries your local token). The seed step copies it in. If you create a worktree by hand, run `scripts/dpf-bootstrap-agent-toolchain.sh` from inside it, then restart the client.

#### Commit and push fast

The durability boundary is the **remote**, not your disk. Commit and push after every logical step, DCO-signed (`-s`) — the DCO bot blocks merge otherwise:

```bash
git add -A && git commit -s -m "…" && git push -u origin <prefix>/<slug>
```

#### Worktrees are source-control isolation, not runtime isolation

A worktree keeps your code changes off the root clone's HEAD. It is **not** a second DPF install. Runtime-bound verification (production build, UX against the served portal, migration apply) does **not** run inside the worktree — route it through the **shared local-CI convergence sandbox** by claiming a lease:

```
claim_nonprod_environment_lease(environmentKey="local-integration-ci")
```

Harness friction inside a worktree (missing pnpm on PATH, cross-workspace symlinks, missing Prisma client) is a *harness limitation, not a product defect* — verify via the lease. Cheap source-local checks (targeted `vitest`, `pnpm --filter <pkg> typecheck`) are fine in the worktree.

#### Clean up when merged

```bash
git -C ~/dpf worktree remove ~/dpf-worktrees/<slug>
```

---

### Adhering to the portal's processes

The agent surfaces are powerful precisely because they don't get a governance discount. Hold these whichever client you drive:

- **MCP is the coordination plane.** Work tracking, capsule claims, and gate evidence live in the DPF MCP substrate. **If it isn't in the MCP plane, it didn't happen** — a thread that runs without claiming a capsule and recording evidence is invisible to coordination and cannot advance a gate.
- **All changes land via PR against `main`, DCO-signed.** One concern per branch, one concern per PR. **Open the PR only when it's green and ready to merge — no draft PRs**, no parking-place PRs.
- **The build gate is mandatory** (unit tests, production build, UX verification, migration apply) and runtime-bound gates run on the canonical install or the leased sandbox — never a worktree-local harness. "Tests passed" is incomplete without naming **where** it ran.
- **The live install advances only via the self-upgrade pipeline.** No surface hand-advances the root clone HEAD or rebuilds the portal to "update."
- **Shared singletons are lease-gated.** No ad-hoc `docker run` / `compose up` against shared runtimes from any surface; claim the lease, heartbeat, release on exit.
- **CI gates are surface-agnostic.** The UX-Fit Gate, Native Dialog Guard, secret scan, and typecheck read the *evidence in the PR*, not which agent produced it.
- **Route durable learnings to the commons** (WWMD / WWWD / WSID / code + AGENTS.md) so every agent and every install inherits them. Local-only knowledge is a defect.

The full operating contract is [AGENTS.md](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/AGENTS.md) — read it before any work. The skill pack enforces the same kernel principles it documents.

---

### Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `/mcp` (or the client's MCP panel) doesn't list `dpf` | Restart the client in the repo root; GUI apps need a full restart to pick up a new token; re-run the bootstrap if still missing |
| Banner shows `missing_token` | Issue a write token in Admin → Platform Development → MCP, then re-run the bootstrap |
| Banner shows `needs_refresh` | Restart the client; if rotated, `POST /api/mcp/token/refresh` with the new token |
| PRs keep opening as drafts | Disable the "create PRs as draft" default in your client's GitHub settings (DPF uses ready-for-review PRs only) |
| Tool returns `insufficient_token_scope` | Issue a scoped token, refresh, retry — do **not** bypass with direct DB edits |
| New worktree has no `dpf` connector | Run `scripts/dpf-bootstrap-agent-toolchain.sh` inside the worktree, then restart |
| Dev-server launch refused (Claude Code) | Use a lease for the shared runtime, or run in an isolated worktree compose stack |
| Codex/Grok missing the lease guard | Expected — comply by construction: claim the lease before launching |

---

### Related

- [Developer Setup](developer-setup) — base local environment (pnpm + Docker sidecars)
- [Dev Container Setup](dev-container) — fully containerized alternative
- [Development Workspace](../development-workspace) — how Build Studio, VS Code, policy states, and validation environments fit together
- [Collision-Free Dev Workflow](../../dev/collision-free-dev-workflow) — the one-command worktree workflow and why the root clone eats your work
- [AGENTS.md](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/AGENTS.md) — the canonical agent rulebook
- Specs: [Agent Toolchain Bootstrap](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md) · [Unified Delivery Surfaces](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) · [First-Class Grok Support](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-05-31-grok-first-class-support-design.md)
</content>
