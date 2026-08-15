# DPF install operations

Operational reference for running the DPF installer and interpreting what it tells you. The contributor-facing quick start lives in the project [README](../../README.md); this page covers the post-install readiness contract and the diagnostic surfaces.

Runtime topology is capability-driven. See [Capability-driven runtime profiles](../architecture/capability-driven-runtime-profiles.md) for the authority flow and transition protocol; this page covers the installer-facing operating contract.

## Quick start

> Install [Claude Code](https://claude.com/code) or [Codex CLI](https://developers.openai.com/codex), then run `install-dpf.ps1` (Windows) or `bash install-dpf.sh` (macOS / Linux). The installer wires the AI toolchain automatically.

That sentence is the whole contract for non-technical contributors. Everything below is for operators who need to diagnose a degraded state.

## Capability-resolved runtime profiles

Every install, restart, autostart, setup, and governed promotion resolves its
Compose profiles through `scripts/lib/resolve-capability-compose-profiles.mjs`.
The persisted snapshot uses the canonical fields `enabledRuntimeCapabilities`,
`capabilityCatalogHash`, and `capabilityStateVersion`; an unknown capability or
a mismatched catalog/state hash fails closed before Compose changes the stack.

When upgrading a previous-release state that predates these fields, the adapter
preserves the capabilities that were active in that release: core, build,
browser automation, durable automation, local speech, deep observability, and
external AI. External AI is retained even on hosts where it adds no local
service because provider configuration remains live state. Previously disabled
ADP and development capabilities are not enabled by migration. This is the
compatibility set, rather than every optional service.

A newly initialized state is different from a previous-release state: its
explicit empty capability selection migrates to the dependency-required core
closure only. Optional runtime profiles remain inactive until enabled through
the governed capability transition path.

`promote`, `dev`, `integration-test`, and `linux-monitoring` remain explicit
lifecycle/host overlays. For one compatibility release, `tts` resolves to local
speech and `observability-ui` resolves to deep observability; both aliases select
the same portable service closure as their canonical runtime profile. Promotion
copies the install snapshot into its recovery point and restores it on rollback.

State lives at `%USERPROFILE%\.dpf\install-state.json` on Windows. On POSIX
hosts it lives at `$XDG_STATE_HOME/dpf/install-state.json` when
`XDG_STATE_HOME` is set and at `$HOME/.dpf/install-state.json` otherwise. The
host-aware resolver filters the catalog before it returns services: Linux may
activate the `runtime-external-ai` Ollama service, while macOS and Windows keep
configured external AI providers outside Compose. Do not copy a resolved
profile string between hosts.

Lifecycle commands must pass through the installer/start helpers or
`scripts/dpf-compose.mjs`. The wrapper binds the install state, project root,
ordered Compose file chain, host, and resolved profiles before invoking Docker.
It rejects caller attempts to enable a disabled capability profile. Explicit
lifecycle overlays remain allowed; `COMPOSE_PROFILES` is not an authority for
capability state. Allowlisted operator overlays such as `linux-host-network`
are preserved and validated; runtime profile names in the environment are
accepted only when the persisted capability projection already enables them.

### Consumer release assets

Consumer installs materialize the canonical Compose topology and lifecycle
adapter from the selected portal image. The installer verifies `SHA256SUMS`,
rejects missing, duplicate, path-escaping, unlisted, or mismatched assets, and
records the verified manifest plus release version. A resumed install
revalidates those installed bytes and the version marker before it continues.
Only then does it atomically bind `DPF_IMAGE_TAG` and `GHCR_OWNER` in `.env`;
unrelated operator settings and comments are preserved. If verification or the
atomic replacement fails, the previous image identity remains intact.

Use the governed self-upgrade surface for an installed portal. It owns
quiescence, recovery-point creation, source/image replacement, capability
projection, health evidence, and rollback. Do not use an ad hoc `docker compose
build` or `up` to refresh the live portal.

### Optional services, backup, and health

Disabling a capability does not delete its volumes or data. New governed work
is blocked first; queued or running work returns `drain_required` until it is
drained or cancelled under its operation policy. A failed service reconcile or
required health check restores the prior snapshot and service closure.

PostgreSQL remains the scheduled core backup and trial-restore target. Enabled
capability services marked `included` are covered by their canonical core data
owner; `separate-required` targets need a dedicated runner and report Optional
degraded when none is available. Disabled targets are Optional inactive, not a
failed schedule. External providers are never local backup targets. Retired
Neo4j and Qdrant backup schedules remain disabled.

The health pages distinguish Required, Optional inactive, Optional degraded,
and External provider-managed states. Only missing required services and
enabled-but-unavailable optional services degrade aggregate health. Core-only
installs therefore remain healthy when deep observability is disabled. Provider
availability comes from bounded reconciliation, not from a fabricated local
container check.

## Agent toolchain readiness

After the install completes, `install-dpf` prints a single readiness banner. There are eight possible states. The wording shown to the contributor matches this table exactly — drift between the table and the installer copy is a CI lint enforced by `readiness-state.test.ts` in the `@dpf/bootstrap` package.

| State | Banner message | Primary action |
|---|---|---|
| `ready` | Claude Code and Codex are ready for DPF work. | Open readiness |
| `partial` | One contributor client is ready; the other needs setup. | Repair toolchain |
| `missing_cli` | Install the selected agent client to enable contributor sessions. | Open setup guide |
| `missing_token` | DPF MCP needs a development token before agents can use governed tools. | Issue development token |
| `needs_refresh` | A token exists, but the running client has not picked it up yet. | Refresh client binding |
| `portal-unavailable` | The portal is rebooting; I can still repair local agent tooling and will sync evidence when it comes back. | Continue local repair |
| `mcp-unavailable` | DPF coordination is unavailable; I can still repair local agent tooling and will sync evidence when it returns. | Continue local repair |
| `failed_smoke` | The agent is installed but did not apply a DPF kernel principle. | View evidence |

### Why each state appears

- **`ready`** — both Claude Code and Codex CLI are installed, the DPF MCP server returned a non-empty `tools/list`, and a destructive-action prompt was refused by the agent. The contributor can start work immediately.
- **`partial`** — exactly one of Claude Code or Codex CLI was wired; the other was not detected on PATH. The contributor can still work in the available client; the missing one is a follow-up.
- **`missing_cli`** — neither Claude Code nor Codex CLI was detected. The contributor needs to install one before any agent work is possible. The installer does NOT print a command for the contributor to type — install the CLI from its official documentation, then re-run the installer.
- **`missing_token`** — the DPF MCP server requires a bearer token before governed tools (backlog, build studio, deliberations) become available. Issue one from **Admin > Platform Development > MCP** in the portal.
- **`needs_refresh`** — a token exists in the contributor's environment, but the running client hasn't picked it up yet. Restart Claude Code / Codex in this worktree. If the issue persists after restart, the endpoint is unreachable or returning an unexpected shape — collect a `dpf-doctor` bundle.
- **`portal-unavailable`** — a token exists, but the portal endpoint cannot be reached or is clearly rebooting/quiescing. The bootstrap still performs local-only repairs such as plugin convergence, MCP client config writes, and memory seeding, then records a local state that can be reconciled after the portal returns.
- **`mcp-unavailable`** — the portal is reachable enough to answer, but the MCP route is missing, unavailable, or returning a server-side failure that is not a portal reboot signal. The bootstrap still performs the same local repairs and keeps the contributor unblocked for source-local work.
- **`failed_smoke`** — the installed CLI responded to the kernel smoke prompt but did not include any of the expected refusal signatures. This is usually a CLI version that hasn't loaded the kernel memory yet. See the smoke-test transcript under `~/.dpf/install-state.json` → `agentToolchain.smokeTest.transcript`.

### Idempotence guarantee

Re-running `install-dpf` is a true no-op when nothing has drifted. The installer should report *'Claude Code plugin already converged'*, *'Codex plugin already converged'*, *'Kernel-tier memory already converged'*, and produce **zero file writes**. If you see writes on a re-run without any version bump, that's a defect — capture a `dpf-doctor` bundle and file a backlog item.

### Agent-toolchain-only update

The DPF platform skills and MCP client wiring can be updated without installing
or running the full DPF project. Use this path when a contributor only needs the
Codex / Claude agent substrate, or when a source-only checkout lacks the Node
dependencies needed by the full bootstrap planner.

The standalone updater is shipped inside the skill pack and requires only
Python 3 plus the skill-pack files:

- Windows: `packages/dpf-skill-pack/scripts/update-agent-toolchain.ps1`
- macOS / Linux: `packages/dpf-skill-pack/scripts/update-agent-toolchain.sh`

It copies the current skill pack to the managed personal plugin location,
updates Codex's personal marketplace and `~/.codex/config.toml`, writes a Claude
local marketplace, and installs the Claude plugin when the Claude CLI is
available. It does not require Docker, pnpm, Node dependencies, database access,
or a running portal. It does not mint `DPF_MCP_BEARER_TOKEN`.

Codex-only update:

```powershell
.\packages\dpf-skill-pack\scripts\update-agent-toolchain.ps1 -CodexOnly
```

```bash
bash packages/dpf-skill-pack/scripts/update-agent-toolchain.sh --codex-only
```

Claude-only update:

```powershell
.\packages\dpf-skill-pack\scripts\update-agent-toolchain.ps1 -ClaudeOnly
```

```bash
bash packages/dpf-skill-pack/scripts/update-agent-toolchain.sh --claude-only
```

Use `DPF_MCP_URL` to point at a non-local MCP endpoint. Restart Codex or Claude
Code after the updater finishes because both clients load plugins and skills at
session start.

### Where state lives

`~/.dpf/install-state.json` carries the `agentToolchain` block after every install run. Schema reference: `scripts/installer/install-state.schema.json`. The block is:

```jsonc
"agentToolchain": {
  "appliedAt": "<iso-timestamp>",
  "dpfPlatformVersion": "0.1.0",
  "superpowersVersion": null,         // pin advisory only; null if not pinned by contributor
  "claudeCodeWired": true,
  "codexWired": true,
  "memorySeededAt": "<iso-timestamp>",
  "mcpReadiness": { "ok": true, "toolCount": 160, "observedAt": "<iso>" },
  "smokeTest": { "result": "passed", "kernelPrincipleObserved": "destructive-actions-require-explicit-go", "transcript": "<bearer-redacted>" },
  "readinessState": "ready"
}
```

Bearer tokens never appear in this file. The `transcript` field is routed through `redactTranscriptForPersistence` before write; the `mcpReadiness` and `smokeTest` shapes are bearer-free by contract. If you find a bearer-shaped substring in this file on any install, it is a security regression — see `BI-4B17051B` for the contract.

## Installation operating intent and environment class

Per EP-1FABA22D (BI-A9F60372), `install-state.json` (v2 schema) captures the canonical local host environment class and pre-DB bootstrap intent envelope:

- **`environmentClass`** — `"production"`, `"development"`, `"test"`, or `null`. Installer state is the canonical source of truth for the local host's environment fact; `FederationLink.environmentClass` is canonical for peer link facts.
- **`bootstrapIntent`** — Pre-DB envelope recorded by the installer before runtime database availability. On portal runtime boot, `absorbBootstrapIntent` idempotently ingests this envelope into `PlatformConfig` under key `installation.operating-intent.v1` with `status: "suggested"` and marks `absorbedAt`.
- **Purpose Confirmation Invariant** — Expressing operating purpose (`operate-organization`, `evolve-dpf`, `deliver-managed-services`, `grow-channel`, `participate-community`) configures platform productivity and compiles work; it **never grants identity, trust, authority, qualification, or permission**.

## Diagnostics

### `--show-substrate` flag

`scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` accepts a `--show-substrate` (`-ShowSubstrate` on Windows) flag that prints plugin paths, memory directory, and state file location under the banner. This is for operator debugging only; the normal install banner is substrate-free by design.

### `dpf-doctor`

`bash install-dpf.sh doctor` (POSIX) or `install-dpf.ps1 doctor` (Windows; if added in a future phase) emits a tar bundle at `~/.dpf/doctor-<timestamp>.tar.gz` containing install-state, recent compose output, and the `agentToolchain` block. Attach this bundle when filing install-failure reports.

### `--reconcile-installed-plugins` flag

`scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` warns by default when stale entries are detected in `~/.claude/plugins/installed_plugins.json` (e.g. entries for deleted worktrees). To actually clean them, re-run with `--reconcile-installed-plugins`. This is opt-in because a contributor may have other worktrees the bootstrap doesn't know about.

## What `install-dpf` does NOT do

For the avoidance of doubt, the installer:

- Does **not** edit your `~/.codex/config.toml` outside the `[plugins."dpf-platform@personal"]` block. The updater migrates the retired bare `[plugins."dpf-platform"]` key because current Codex requires `<plugin>@<marketplace>`. Other blocks (user MCP servers, marketplaces, feature flags, project trust levels) are preserved byte-for-byte. User intent (`enabled = false` set manually) is preserved on re-runs.
- Does **not** write your DPF MCP bearer token into any tracked file. The token is read from `DPF_MCP_BEARER_TOKEN` and never persisted to the agent toolchain state.
- Does **not** auto-upgrade upstream-owned plugins (`superpowers@openai-curated`). If your installed version differs from the DPF pin, the banner shows an advisory line — no action is taken.
- Does **not** prompt the contributor to run scripts or copy commands. Missing CLIs / tokens / drifted state become explicit readiness states with one primary action; never a command-copy.

## See also

- Spec: [`docs/superpowers/specs/2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`](../superpowers/specs/2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md)
- Plan: [`docs/superpowers/plans/2026-08-08-purpose-aware-installation-ecosystem-productivity.md`](../superpowers/plans/2026-08-08-purpose-aware-installation-ecosystem-productivity.md)
- Spec: [`docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md`](../superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)
- Plan: [`docs/superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md`](../superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md)
- Skill pack: [`packages/dpf-skill-pack/README.md`](../../packages/dpf-skill-pack/README.md)
- Planning library: [`packages/dpf-bootstrap/README.md`](../../packages/dpf-bootstrap/README.md)
- State schema: [`scripts/installer/install-state.schema.json`](../../scripts/installer/install-state.schema.json)
- Backlog: BI-A9F60372 (EP-1FABA22D), BI-4B17051B (EP-INSTALL-HARDENING-2026-05-23)
