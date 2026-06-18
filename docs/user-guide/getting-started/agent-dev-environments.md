---
title: "Agent CLI Development Environments — Claude Code, Codex, Grok"
area: getting-started
order: 7
lastUpdated: 2026-06-18
updatedBy: Claude (Opus 4.8)
---

## Agent CLI Development Environments — Claude Code, Codex, Grok

This guide is for contributors who want to develop the platform with a **command-line AI coding agent** — Claude Code, the Codex CLI, or the Grok CLI — instead of (or alongside) the in-portal **Build Studio**. All three are first-class, peer delivery surfaces: none is privileged, and all three advance the *same* evidence-gated lifecycle the portal enforces. Where Build Studio is the guided, governed authoring surface, the CLI agents are the more advanced surface — they let an experienced contributor run **multiple concurrent threads of work** (one branch and one git worktree per thread) while still adhering to every process the portal establishes.

If you only want the guided experience, use [Build Studio](build-studio/index) and stop here. If you want to run several streams of work in parallel from the terminal, read on.

> **One process, three surfaces.** Claude Code, Codex CLI, and Build Studio are interchangeable adapters behind one contract: the evidence-gated lifecycle (`ideate → plan → build → review → ship`), the DPF MCP coordination plane, and the worktree/lease isolation model. Governance reads the *evidence*, never *which surface produced it*. See the [Unified Delivery Surfaces spec](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) for the canonical decisions.

---

### Why a CLI agent instead of Build Studio?

| | Build Studio (in-portal) | CLI agents (Claude / Codex / Grok) |
| --- | --- | --- |
| Audience | Non-technical operators; guided authoring | Experienced contributors comfortable with git + terminals |
| Concurrency | One guided build at a time per operator | **Many concurrent threads** — one branch + one worktree each |
| Source access | Governed, abstracted | Direct source edits, debugging, arbitrary tooling |
| Same governance? | **Yes** — identical gates, MCP coordination, PR/DCO, evidence | **Yes** — identical gates, MCP coordination, PR/DCO, evidence |

The headline advantage of the CLI surfaces is **thread management**. You can have several worktrees open — each on its own branch, each with its own isolated Docker Compose project — and an agent driving each one, without their working trees, container names, or HEADs colliding. The rest of this guide is mostly about doing that *without* breaking the processes the portal depends on.

---

### Prerequisites

You need the base developer environment first — see [Developer Setup](developer-setup) (pnpm + Docker sidecars) or the [Dev Container Setup](dev-container). Then install **at least one** agent CLI:

| Agent | Install | Local config it uses |
| ----- | ------- | -------------------- |
| **Claude Code** | [code.claude.com/docs](https://code.claude.com/docs) | `~/.claude/` (plugins, settings, projects/memory) |
| **Codex CLI** | [developers.openai.com/codex](https://developers.openai.com/codex) | `~/.codex/config.toml`, `~/.codex/auth.json` |
| **Grok CLI** | xAI Grok Build CLI (`grok`) | `~/.grok/config.toml`, `~/.grok/auth.json` |

You do not have to install all three. The setup is symmetric, so you can add another later and re-run the bootstrap — it converges whatever is present and skips what is not.

---

### One command sets everything up

From the repo root, run the **agent toolchain bootstrap**. It is the single, client-agnostic entry point that wires Claude Code, Codex, and Grok to DPF in one pass:

```bash
# macOS / Linux
bash scripts/dpf-bootstrap-agent-toolchain.sh

# Windows (PowerShell)
.\scripts\dpf-bootstrap-agent-toolchain.ps1
```

The bootstrap is **idempotent** — re-running on a converged install is a no-op — and it detects, plans, and applies for all three clients from one place. It:

1. **Detects** which of Claude Code / Codex / Grok are installed (resolving GUI-app and non-PATH install locations, not just `which`).
2. **Mints and persists a DPF MCP token** if one isn't present (issued inside the portal container, persisted to `~/.dpf/agent-toolchain.env` and your shell profile, never logged). Default scope is `write` so the agent can use side-effecting MCP tools (backlog, evidence, Build Studio handoff).
3. **Wires each client** to the `dpf-platform` skill pack and the DPF MCP server:
   - **Claude Code** — installs the `dpf-platform` plugin from the repo-local marketplace.
   - **Codex** — upserts a `[plugins."dpf-platform"]` block and `[mcp_servers.dpf]` into `~/.codex/config.toml`, preserving all your other config byte-for-byte.
   - **Grok** — writes the DPF MCP server block into `~/.grok/config.toml`.
4. **Seeds kernel-tier memory** — projects the turn-one kernel principles into your contributor memory so the agent is kernel-aware from the first turn (before any MCP retrieval round-trip).
5. **Runs read-only MCP + kernel smoke probes** and prints a **single readiness banner** — no substrate names, no command snippets in the normal output.

After it finishes, **restart the client** so it reloads `/mcp` and the skill pack.

> **Restart matters.** Claude Code and Codex only pick up newly-wired MCP servers and plugins on restart. If `/mcp` doesn't show the `dpf` connector, restart the client in the repo root.

#### Reading the readiness banner

The banner reports one of six states with one next action:

| State | Meaning | Next action |
| ----- | ------- | ----------- |
| `ready` | Client(s) wired, MCP reachable, kernel principle fired | Start working |
| `partial` | One client is ready; another needs setup | Repair toolchain (re-run bootstrap) |
| `missing_cli` | No supported agent CLI detected | Install Claude Code / Codex / Grok |
| `missing_token` | No DPF MCP token | Issue a development token (Admin → Platform Development → MCP) |
| `needs_refresh` | Token exists but the running client hasn't picked it up | Restart the client / refresh the binding |
| `failed_smoke` | Installed but did not apply a kernel principle | View evidence under `--show-substrate` |

For debugging, re-run with `--show-substrate` to see plugin/config/memory detail, or `--dry-run` to see planned writes without applying them. See [docs/operations/install.md](../../operations/install) for what each readiness state means in depth.

---

### Per-client specifics

The bootstrap hides the substrate, but it helps to know how each client differs once you're working.

#### Claude Code

- Loads the `dpf-platform` skill pack and the `dpf` MCP connector via the repo-local marketplace + `.claude/settings.json` (which declares `enabledPlugins`, `enabledMcpjsonServers: ["dpf"]`, and worktree/transcript hooks).
- **Enforced lease guard.** A `PreToolUse` hook (`scripts/hooks/lease-guard.mjs`) *refuses* ungoverned dev-server launches (`pnpm/npm/yarn dev`, `next dev`, `turbo dev`). This is what prevents a pile-up of rogue servers on shared singletons. Use the governed path (lease the shared runtime) instead. Emergency bypass only: prefix `DPF_ALLOW_UNGATED_SERVER=1`.

#### Codex CLI

- Reads the DPF MCP server and the `dpf-platform` plugin from `~/.codex/config.toml`. The bearer token is referenced via `bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`, not stored in the file.
- **No `.claude/settings.json` hook applies to Codex.** Codex (and Grok) get the same contract by *reading* it — comply **by construction**: claim a lease before you launch any shared runtime, claim a Work Capsule before you start, record evidence as you go. A shared `dpf worktree` wrapper to enforce this for Codex/Grok is planned.

#### Grok CLI

- Reads the DPF MCP server block from `~/.grok/config.toml` (HTTP transport, same `${DPF_MCP_BEARER_TOKEN}` pattern).
- **Authentication to xAI** is separate from the DPF MCP token. Preferred path is the OAuth **device-code** flow — `grok login --device-auth` opens `accounts.x.ai/oauth2/device`, you sign in with Google / X / Apple, and the credential lands in `~/.grok/auth.json`. An `XAI_API_KEY` is the fallback. (Build Studio's containerized Grok dispatch uses the same credential model; see the [Grok device-code OAuth spec](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-07-grok-device-code-oauth-design.md).)
- Same comply-by-construction contract as Codex: no settings hook, so claim leases and capsules yourself.

---

### The DPF MCP token (all three clients)

All three clients authenticate to the DPF MCP server with the same `DPF_MCP_BEARER_TOKEN` environment variable, referenced (never inlined) from each client's config. `.mcp.json` and `.vscode/mcp.json` are **gitignored credential files** — never commit them.

- **Scopes.** Tokens are coarse `read` / `write` / `admin` plus granular per-tool grants. Default is `read` and cannot call side-effecting tools. Use **Issue write token** in Admin → Platform Development → MCP when an agent must create/update backlog items, evidence, capsules, or coordination records.
- **Scope escalation.** If a tool returns `insufficient_token_scope`, *stop* — do not fall back to `psql`/Prisma/direct DB edits. Issue a scoped token in the portal, update the client, call `/api/mcp/token/refresh`, and retry through MCP.
- **Rotation** (no file edits): set the `DPF_MCP_BEARER_TOKEN` user environment variable to the new value, then `POST /api/mcp/token/refresh` with the new token, then retry the call in the running session.

---

### Managing multiple threads (the main reason to use a CLI agent)

This is where the CLI surfaces go beyond Build Studio. The model is simple and strict:

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

The durability boundary is the **remote**, not your disk. Commit and push after every logical step:

```bash
git add -A && git commit -s -m "…" && git push -u origin <prefix>/<slug>
```

Every commit needs DCO sign-off (`-s`) — the DCO bot blocks merge otherwise.

#### Worktrees are source-control isolation, not runtime isolation

A worktree keeps your code changes off the root clone's HEAD. It is **not** a second DPF install. Runtime-bound verification (production build, UX against the served portal, migration apply) does **not** run inside the worktree — route it through the **shared local-CI convergence sandbox** by claiming a lease:

```
claim_nonprod_environment_lease(environmentKey="local-integration-ci")
```

Harness friction inside a worktree (missing pnpm on PATH, cross-workspace symlinks, missing Prisma client) is a *harness limitation, not a product defect* — verify via the lease, not by fighting the worktree. Cheap source-local checks (targeted `vitest`, `pnpm --filter <pkg> typecheck`) are fine to run in the worktree.

#### Clean up when merged

```bash
git -C ~/dpf worktree remove ~/dpf-worktrees/<slug>
```

---

### Adhering to the portal's processes

The CLI surfaces are powerful precisely because they don't get a governance discount. Hold these whichever client you drive:

- **MCP is the coordination plane.** Work tracking, capsule claims, and gate evidence live in the DPF MCP substrate. **If it isn't in the MCP plane, it didn't happen** — a thread that runs without claiming a capsule and recording evidence is invisible to coordination and cannot advance a gate.
- **All changes land via PR against `main`, DCO-signed.** One concern per branch, one concern per PR. Open the PR only when it's green and ready to merge — no draft PRs, no parking-place PRs.
- **The build gate is mandatory** (unit tests, production build, UX verification, migration apply) and runtime-bound gates run on the canonical install or the leased sandbox — never a worktree-local harness. "Tests passed" is incomplete without naming **where** it ran.
- **The live install advances only via the self-upgrade pipeline.** No surface hand-advances the root clone HEAD or rebuilds the portal to "update."
- **Shared singletons are lease-gated.** No ad-hoc `docker run` / `compose up` against shared runtimes from any surface; claim the lease, heartbeat, release on exit.
- **CI gates are surface-agnostic.** The UX-Fit Gate, Native Dialog Guard, secret scan, and typecheck read the *evidence in the PR*, not which agent produced it — so Claude, Codex, Grok, and Build Studio are all held to the same bar.
- **Route durable learnings to the commons** (WWMD / WWWD / WSID / code + AGENTS.md) so every agent and every install inherits them. Local-only knowledge is a defect.

The full operating contract is [AGENTS.md](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/AGENTS.md) at the repo root — read it before any work. The CLI skill pack enforces the same kernel principles AGENTS.md documents.

---

### Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `/mcp` doesn't list `dpf` | Restart the client in the repo root; re-run the bootstrap if still missing |
| Banner shows `missing_token` | Issue a write token in Admin → Platform Development → MCP, then re-run the bootstrap |
| Banner shows `needs_refresh` | Restart the client; if rotated, `POST /api/mcp/token/refresh` with the new token |
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
</invoke>
