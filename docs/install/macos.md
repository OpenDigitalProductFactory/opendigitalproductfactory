# DPF Install Guide — macOS (Apple Silicon)

This is the end-user install guide for the Open Digital Product Factory
on **Apple Silicon Macs** (M1 / M2 / M3 / M4).

> **Status: Early access — please try it!**
>
> The macOS installer is code-complete and passes static CI gates.
> What it hasn't seen yet is a real install on a real Apple Silicon
> Mac in the wild — the `macos-14` GHA runner can't nest-virtualize
> Docker Desktop, so CI only exercises the `--dry-run` path.
>
> **If you have an Apple Silicon Mac, you can change that.** Follow
> the steps below, then [tell us how it went](#help-us-graduate-to-ga)
> — both success stories and "the installer hit a wall at step X"
> reports are equally useful. A handful of community verification
> reports is what we need to flip this guide from "early access" to
> "GA."
>
> The Windows installer remains the only GA install surface today.

For the architectural background, see the
[installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
and the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

## Supported environment

| Component | Required |
|-----------|----------|
| OS | macOS 14 (Sonoma) or newer |
| Architecture | Apple Silicon (`arm64`). Intel Macs are not supported. |
| Disk | ~10 GB free (Docker Desktop + multi-arch GHCR images) |
| RAM | 16 GB recommended for the local-LLM tier; 8 GB works with an external `LLM_BASE_URL` |

The installer refuses to run on unsupported hosts (Intel Mac, older
macOS) unless you pass `--force-unsupported-host` — see
[Preflight refusals](#preflight-refusals).

## Prerequisites

The installer auto-installs Docker Desktop. You bring:

- **Xcode Command Line Tools** — `xcode-select --install` (for `git`,
  `make`, `curl`).
- **Node.js 20+** and **pnpm** — install via `brew install node pnpm`,
  `nvm`, or your preferred manager. The installer refuses to run with
  older Node or no pnpm; it does **not** auto-install Node-runtime
  tooling (out of scope per Contract 3).

That's it. No Homebrew dependency for Docker Desktop itself — the
installer downloads the official `.dmg` directly from `desktop.docker.com`.

## Quick start

Clone the repo and run the installer:

```bash
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh
```

The installer is interactive by default and first asks **how you want to use
DPF**:

- **`[1] Ready to go` (customer)** — runs the pre-built release images. No
  contributor tooling. This is the default.
- **`[2] Customizable` (contributor)** — builds the full stack from your local
  source, enables the in-repo git hooks, and runs the agent-toolchain
  bootstrap so Claude Code / Codex are wired up.

Your choice is saved to `~/.dpf/install-state.json` (`installMode`) and reused
on re-runs without re-prompting. To skip the prompt, pass `--customer` or
`--contributor`. For an unattended (CI / scripted) install:

```bash
# Customer (release images) is the headless default:
bash install-dpf.sh --headless

# Or pick explicitly:
bash install-dpf.sh --headless --contributor
```

`--customer`/`--contributor` set the compose mode automatically (release vs
source build); `--release`/`--dev` still override it if you need to force one.

### What the installer does

1. **Preflight** — refuses to run on Intel Macs / older macOS / WSL2 /
   rootless Docker / Podman.
2. **`~/.dpf/install-state.json`** — initializes or migrates the install
   state file (schema-versioned).
3. **Install mode** — prompts for customer vs contributor (or honors
   `--customer`/`--contributor`), saves it to `install-state.json`, and
   derives the compose mode (customer → release images; contributor →
   source build) unless `--release`/`--dev` forces one.
4. **Compose chain** — assembles `docker-compose.yml` +
   `docker-compose.macos.yml` + `docker-compose.edge.yml` (+
   `docker-compose.release.yml` in release/customer mode). The Edge Node
   container is bundled by default for single-host installs; pass
   `--no-edge` to skip it.
5. **Docker Desktop** — installs the `.dmg` if missing
   (`hdiutil attach` + `cp -R /Applications`), then starts it and waits
   for the daemon.
6. **Node / pnpm sanity check** — refuses if Node < 20 or pnpm missing.
7. **Workspace dependencies** — `pnpm install`. In **contributor** mode the
   installer also enables the in-repo `.githooks/` (`git config
   core.hooksPath .githooks`) and runs the agent-toolchain bootstrap so
   Claude Code / Codex are wired up. Customer mode skips both.
8. **Host hardware profile** — runs `scripts/detect-hardware-host.ts`
   and emits `DPF_HOST_PROFILE` (Apple Silicon reports
   `architecture: "unified"` for memory).
9. **`.env` generation** — only on first install; existing `.env` is
   preserved.
10. **Release image availability** (customer mode only) — probes the GHCR
    portal image and, if it's gated behind early-access auth, points you at
    `docker login ghcr.io` before bring-up.
11. **`docker compose up -d`** on the macOS overlay.
12. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
13. **Edge Node bootstrap** (unless `--no-edge`) — mints a single-use
    auto-approve bootstrap token, writes it to `.env` as
    `DPF_BOOTSTRAP_TOKEN`, restarts the `edge-node` container so it
    enrolls. The new EdgeNode lands directly in `trustState=trusted`
    per spec § Approval policy. **macOS limitation:** the Edge Node
    runs in bridge mode (Docker Desktop doesn't honor
    `network_mode: host` the way Linux does), so its discovery output
    sees the Docker Desktop VM's interfaces rather than your Mac's
    real NICs. That's a known constraint resolved by the future
    native macOS Edge Node binary (T3) — until then, the Edge Node
    here demonstrates the enrollment + heartbeat + submission path
    but not L2 host-network discovery.
14. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
15. **LaunchAgent** — installs `~/Library/LaunchAgents/local.dpf-autostart.plist`
    so the stack auto-starts at login (skip with `--no-autostart`).

Total wall time: ~10 minutes including the AI-model download (varies
with model size and connection).

### Login

Login credentials are written to `.env` in the install directory:

- **Email:** `admin@dpf.local`
- **Password:** `ADMIN_PASSWORD` in `.env` (randomly generated on first
  install). Change it after first login.

## Day-to-day

| Task | Command |
|------|---------|
| Start the stack | `bash dpf-start.sh` |
| Stop the stack | `bash dpf-stop.sh` |
| Tail logs | `docker compose -f docker-compose.yml -f docker-compose.macos.yml logs -f` |
| Diagnostic bundle | `bash install-dpf.sh doctor` |
| Wipe + reinstall (destructive) | `bash dpf-reinstall.sh` |
| Tag + push a release | `bash dpf-release.sh --bump minor` |
| Soft uninstall (keep data) | `bash uninstall-dpf.sh` |
| Full uninstall (wipe data) | `bash uninstall-dpf.sh --purge` |

`bash install-dpf.sh --help` (and the other scripts) document every flag.

## LLM provider

On Apple Silicon, Docker Desktop ships **Docker Model Runner**, which
hosts the local LLM behind an OpenAI-compatible endpoint at
`http://model-runner.docker.internal/engines/v1`. The installer
auto-detects this and sets `DPF_LLM_PROVIDER=model-runner` per the
[provider contract](../superpowers/specs/2026-05-09-deployment-contracts.md).

To use an external endpoint (Anthropic, OpenAI, hosted Ollama, etc.)
instead, set `LLM_BASE_URL` in `.env` before re-running the installer:

```bash
LLM_BASE_URL=https://api.example.com/v1
DPF_LLM_PROVIDER=external
```

## Autostart

The installer registers a LaunchAgent at:

```
~/Library/LaunchAgents/local.dpf-autostart.plist
```

It invokes a generated launch script (`~/.dpf/dpf-autostart.sh`) that
embeds the exact compose `-f` chain captured at install time, so future
overlay edits don't silently break autostart.

To inspect or disable the agent:

```bash
launchctl list | grep dpf-autostart       # is it loaded?
launchctl bootout gui/$UID/local.dpf-autostart   # stop the agent
rm ~/Library/LaunchAgents/local.dpf-autostart.plist
```

`bash uninstall-dpf.sh` removes the agent and stops the stack but
preserves volumes / `.env` / `~/.dpf` state for re-install. `--purge`
nukes those too.

## Preflight refusals

The installer refuses to proceed on configurations that don't match
the supported matrix:

- **Intel Mac.** Force with `--force-unsupported-host`, but Phase 0's
  multi-arch GHCR images target `linux/arm64` for Apple Silicon —
  Intel runs under Rosetta with a hard performance hit.
- **macOS 13 or older.** Older Docker Desktop versions miss
  `host-gateway` and Model Runner.
- **Docker Desktop < 4.40.** Refused because Model Runner isn't
  available; upgrade Docker Desktop first.
- **Podman / rootless Docker / Colima.** Not on the supported matrix;
  the bind-mounts and `host-gateway` mode the platform relies on
  aren't validated against these runtimes.

## Troubleshooting

**Portal didn't come up after `--headless` install.**
Run `bash install-dpf.sh doctor` to capture a diagnostic bundle at
`~/.dpf/doctor-<timestamp>.tar.gz` and check
`docker compose -f docker-compose.yml -f docker-compose.macos.yml logs portal --tail 100`.

**Docker Desktop quarantined the LaunchAgent plist.**
Strip the quarantine xattr: `xattr -d com.apple.quarantine ~/Library/LaunchAgents/local.dpf-autostart.plist`.
The installer attempts this automatically.

**Model Runner not detected even though Docker Desktop ≥ 4.40 is
installed.**
Open Docker Desktop → Settings → Features in development → enable
"Use Docker Compose v2" and "Docker Model Runner", then re-run
`bash install-dpf.sh`.

**`/api/health` returns 500.**
The portal's database migrations may not have completed. Tail the
portal-init container:
`docker compose -f docker-compose.yml -f docker-compose.macos.yml logs portal-init`.

**Browser doesn't open after `bash dpf-start.sh`.**
Pass `--no-browser` (or set `NO_BROWSER=1`) for SSH / headless sessions.
The portal is still running at `http://localhost:3000`.

## Uninstall

| Command | What it removes |
|---------|-----------------|
| `bash uninstall-dpf.sh` | LaunchAgent, running containers. **Preserves** volumes, `.env`, `~/.dpf` state. Re-install resumes cleanly. |
| `bash uninstall-dpf.sh --purge` | Above + all DPF docker volumes (filtered by the `com.docker.compose.project=dpf` label so other stacks on the same host are untouched), `.env`, `~/.dpf`. Destructive — irreversible. |
| `bash uninstall-dpf.sh --purge --keep-env` | Purge but retain `.env`. |
| `bash uninstall-dpf.sh --purge --keep-state` | Purge but retain `~/.dpf` install history. |

## Help us graduate to GA

We can't run this installer on real Apple Silicon hardware from CI
(the GHA `macos-14` runner can't nest-virtualize Docker Desktop), so
the path from "early access" to "GA" runs through the community.
If you ran the install above on a real Mac, **please file a quick
report** — happy paths and failures are equally valuable.

**One-command report (fastest path):**

```bash
# Already installed — just run the verifier:
bash scripts/verify-install-edge.sh

# Fresh host — bootstrap + verify in one shot:
bash scripts/verify-install-edge.sh --bootstrap
```

The script captures a `~/.dpf/verify-bundle-<timestamp>.tar.gz` with a
host fingerprint, portal health, Prometheus targets, Edge Node lifecycle
log, and a paste-able summary — including macOS-specific checks for
architecture (arm64), LaunchAgent autostart, and Docker Model Runner.

Open a [new GitHub issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new)
titled `Install verification — macOS <version> <arch>`
(example: `Install verification — macOS 14.5 arm64 (M2 Pro)`) and
attach the tarball. Secrets in the bundle are redacted automatically.

**Manual report (if the verifier itself fails to run):**

1. Paste the output of:
   ```bash
   sw_vers && uname -srm
   docker --version 2>/dev/null
   echo "DPF version: $(grep DPF_INSTALLER_VERSION install-dpf.sh)"
   ```
2. Note which steps you completed from the
   [verification runbook §2](verification-runbook.md#2-macos-apple-silicon-end-to-end-install)
   and which (if any) failed.
3. Attach the doctor bundle:
   ```bash
   bash install-dpf.sh doctor
   # Attach ~/.dpf/doctor-<timestamp>.tar.gz to the issue.
   ```

The verification runbook also covers:

- LaunchAgent surviving an actual reboot
- Docker Desktop `.dmg` install flow on a Gatekeeper-fresh machine
- Discovery collectors emitting real `pkgutil` / `brew` data
- LLM provider round-trip (Model Runner)

Any subset is useful. We don't need every checkbox before reading your
report — we'll integrate findings as they arrive.

## Going further

- [Linux install guide](linux.md) — same platform, different host.
- [Installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
- [Deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md) — the 10 canonical contracts every install path wraps.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — for contributing back to the platform.

### Connecting Claude Code or VS Code via MCP

Once the platform is running, you can connect Claude Code, Codex CLI, or VS Code to your install's MCP server at `/api/mcp/v1`.

**Option A — CLI (fastest, no browser needed):**

```bash
pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts > .mcp.json
```

This issues a read-only token with the coding-agent scope set and writes a ready-to-paste `.mcp.json` in one step. Restart Claude Code to pick up the `dpf` connector.

```bash
# VS Code instead:
pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format vscode > .vscode/mcp.json
```

**Option B — Admin UI:** Log in → Admin > Platform Development > MCP Token Manager → generate a token → paste the displayed snippet into `.mcp.json`.
