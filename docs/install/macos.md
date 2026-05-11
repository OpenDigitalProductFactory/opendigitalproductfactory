# DPF Install Guide — macOS (Apple Silicon)

This is the end-user install guide for the Open Digital Product Factory
on **Apple Silicon Macs** (M1 / M2 / M3 / M4).

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

The installer is interactive by default. For an unattended (CI / scripted)
install:

```bash
bash install-dpf.sh --headless --release
```

### What the installer does

1. **Preflight** — refuses to run on Intel Macs / older macOS / WSL2 /
   rootless Docker / Podman.
2. **`~/.dpf/install-state.json`** — initializes or migrates the install
   state file (schema-versioned).
3. **Compose chain** — assembles `docker-compose.yml` +
   `docker-compose.macos.yml` (+ `docker-compose.release.yml` if
   `--release`).
4. **Docker Desktop** — installs the `.dmg` if missing
   (`hdiutil attach` + `cp -R /Applications`), then starts it and waits
   for the daemon.
5. **Node / pnpm sanity check** — refuses if Node < 20 or pnpm missing.
6. **Workspace dependencies** — `pnpm install`.
7. **Host hardware profile** — runs `scripts/detect-hardware-host.ts`
   and emits `DPF_HOST_PROFILE` (Apple Silicon reports
   `architecture: "unified"` for memory).
8. **`.env` generation** — only on first install; existing `.env` is
   preserved.
9. **`docker compose up -d`** on the macOS overlay.
10. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
11. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
12. **LaunchAgent** — installs `~/Library/LaunchAgents/local.dpf-autostart.plist`
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

## Going further

- [Linux install guide](linux.md) — same platform, different host.
- [Installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
- [Deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md) — the 10 canonical contracts every install path wraps.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — for contributing back to the platform.
