# DPF Install Guide — Linux (native Docker)

This is the end-user install guide for the Open Digital Product Factory
on **native Linux Docker Engine** (no Docker Desktop).

> **Status: Early access — please try it!**
>
> The Linux installer is code-complete and passes static CI gates.
> An on-demand end-to-end install gate runs the full compose stack
> on `ubuntu-latest`
> ([`.github/workflows/install-verification.yml`](../../.github/workflows/install-verification.yml)),
> but we still need real-world reports on **distros beyond Ubuntu**
> (Debian 12+, Fedora 39+) and on the **autostart-after-reboot** path
> — neither of which CI can exercise.
>
> **If you run Debian, Fedora, or a Linux VM you can spare for an
> hour, please try the install and [tell us how it went](#help-us-graduate-to-ga).**
> Happy paths and failures are equally useful. A handful of community
> verification reports is what we need to flip this guide from
> "early access" to "GA."
>
> The Windows installer remains the only GA install surface today.

For the architectural background, see the
[installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
and the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

## Supported environment

| Component | Required |
|-----------|----------|
| OS | Ubuntu 22.04+ / Debian 12+ / Fedora 39+ |
| Architecture | `x86_64` or `arm64` (the multi-arch GHCR images cover both) |
| Docker Engine | 20.10 or newer (for `host-gateway` extra-hosts mode) |
| Disk | ~10 GB free (images + Ollama models + volumes) |
| RAM | 16 GB recommended for the local-LLM tier; 8 GB works with an external `LLM_BASE_URL` |

The installer refuses to run on:

- WSL2 without Docker Desktop integration (the host-side bind mounts
  the platform relies on don't survive the WSL boundary cleanly).
- Rootless Docker (volumes / `host-gateway` not validated).
- Older Ubuntu (< 22.04), older Debian (< 12), older Fedora (< 39),
  CentOS 7, RHEL 7.

Force with `--force-unsupported-host` if you know what you're doing.

## Prerequisites

The installer auto-installs Docker Engine via the distro package manager
(`apt-get` on Debian/Ubuntu, `dnf` on Fedora). You bring:

- **`sudo` privileges** — required for the Docker Engine install and for
  adding your user to the `docker` group.
- **Node.js 20+** and **pnpm** — install via your distro pkg manager,
  `nvm`, or `npm install -g pnpm`. The installer refuses if Node < 20
  or pnpm is missing; it does **not** auto-install Node-runtime tooling.
- **`git`, `curl`, `bash`** — already present on every supported distro.

## Quick start

Clone the repo and run the installer:

```bash
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh
```

For unattended (CI / scripted) install:

```bash
bash install-dpf.sh --headless --release
```

#### Contributor: separate dev workspace from install (recommended, BI-0856A4CE Phase 1)

The clone at the install path doubles as a dev tree by default — that works,
but the dev tree can collide with the running portal and the self-upgrade
merge loop (BI-A8A7CCFD). Pass `--dev-workspace-path` to register a
**separate** clone as the dev workspace; the dev-loop scripts then branch
new worktrees from there:

```bash
# 1. Install (production tree = $REPO_ROOT, the cwd):
bash install-dpf.sh --headless --contributor --dev-workspace-path ~/dpf-dev

# 2. Clone the dev workspace separately (one-time):
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf-dev

# 3. Use ~/dpf-dev for all dev work; worktrees go in ~/dpf-dev-worktrees/:
cd ~/dpf-dev
bash scripts/new-dev-worktree.sh my-feature
```

Omitting `--dev-workspace-path` (or pointing it at the install path) keeps
single-tree mode — the current default and fully back-compat.

### What the installer does

1. **Preflight** — refuses to run on WSL2-without-DD / rootless Docker /
   Podman / older distros.
2. **`~/.dpf/install-state.json`** — initializes or migrates the install
   state file (schema-versioned). Honors `XDG_STATE_HOME`.
3. **Compose chain** — assembles `docker-compose.yml` +
   `docker-compose.linux.yml` (+ `docker-compose.release.yml` if
   `--release`). The Edge Node is **opt-in**: pass `--with-edge` to
   also bundle a local `docker-compose.edge.yml` node for network
   discovery from this host. By default no Edge Node is installed —
   map a network from another machine instead via Admin > Platform
   Development > Edge Nodes.
4. **Docker Engine** — installs via distro pkg manager if missing
   (Docker's official `apt`/`dnf` repos), runs `systemctl enable --now
   docker`, adds your user to the `docker` group.
5. **`docker` group requires re-login.** If you were just added, the
   installer exits with code `75` and asks you to log out and back in
   (or `newgrp docker`). Re-run `bash install-dpf.sh` afterward.
6. **Node / pnpm sanity check** — refuses if Node < 20 or pnpm missing.
7. **Workspace dependencies** — `pnpm install`.
8. **Host hardware profile** — runs `scripts/detect-hardware-host.ts`
   (reads `/proc/cpuinfo`, `nproc`, `free -b`, `nvidia-smi` if present).
   Model selection reads the shared `scripts/installer/local-model-policy.json`
   policy. A 24 GB discrete GPU selects the curated `ai/qwen3-coder` tier;
   fresh installs do not auto-provision mutable third-party model references.
9. **`.env` generation** — only on first install; existing `.env` is
   preserved.
10. **`docker compose up -d`** on the Linux overlay (which adds the
    `ollama` service for local LLM hosting, cAdvisor, node-exporter,
    and the matching Prometheus scrape config).
11. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
12. **Edge Node bootstrap** (only with `--with-edge`) — mints a single-use
    auto-approve bootstrap token via
    `apps/web/scripts/issue-edge-bootstrap-token.ts --auto-approve`,
    writes it to `.env` as `DPF_BOOTSTRAP_TOKEN`, restarts the
    `edge-node` container so it enrolls. The new EdgeNode lands
    directly in `trustState=trusted` per spec § Approval policy —
    the operator running `install-dpf.sh` has already proven host
    access, so the Approve click in `/platform/edge-nodes` would be
    ceremonial. The node appears in the admin UI within ~10 seconds.
13. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
14. **systemd user unit** — installs
    `~/.config/systemd/user/dpf.service` and runs
    `loginctl enable-linger $USER` so the stack auto-starts at boot
    (skip with `--no-autostart`).

Total wall time: ~10 minutes including the initial Ollama model pull
(varies with model size and connection).

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
| Tail logs | `docker compose -f docker-compose.yml -f docker-compose.linux.yml -f docker-compose.edge.yml logs -f` |
| Diagnostic bundle | `bash install-dpf.sh doctor` |
| Wipe + reinstall (destructive) | `bash dpf-reinstall.sh` |
| Tag + push a release | `bash dpf-release.sh --bump minor` |
| Soft uninstall (keep data) | `bash uninstall-dpf.sh` |
| Full uninstall (wipe data) | `bash uninstall-dpf.sh --purge` |

Pass `--help` to any of those scripts to see all flags.

## Edge Node — what's running and why

A single-host install bundles a **DPF Edge Node** alongside the
Authority Core. The Edge Node is a small Node.js container that:

- Reports its host (hostname + LAN IP addresses) to the Authority
- Submits discovery observations on a regular sweep cadence (default
  5 min)
- Receives policy + interval updates from the Authority on each
  heartbeat (default 60s)

It enrolls automatically on first install (the installer mints a
single-use `dpfboot_*` token flagged as installer-issued, writes it
to `.env`, and the container consumes it on startup). Per spec §
Approval policy the new node lands directly in `trustState=trusted`
— no Approve click needed because the operator running
`install-dpf.sh` already has host access.

Verify it's running:

```bash
# Container is up
docker compose -f docker-compose.yml -f docker-compose.linux.yml \
               -f docker-compose.edge.yml \
               ps edge-node

# Node appears in the admin UI at /platform/edge-nodes with
# trustState=trusted, a recent lastSeenAt, and (after a few minutes)
# a DiscoveryRun count > 0.
```

**Skip the Edge Node:** `bash install-dpf.sh --no-edge` for
Authority-only deployments (cloud / headless installs where Edge
Nodes will be added later from separate hosts via the
`docker-compose.edge-standalone.yml` path —
[multi-host runbook](edge-node-multi-host.md)).

**Add Edge Nodes from other hosts later:** when you want to
discover topology on a second machine (different physical box, VM,
LAN segment), follow the
[multi-host runbook](edge-node-multi-host.md). The remote host
runs only the Edge Node container, points it at this Authority's
URL, and goes through the operator Approve click (paste-provisioned
tokens always require explicit approval per spec § Approval policy).

## LLM provider

On Linux without Docker Desktop, there's no Docker Model Runner. The
Linux compose overlay (`docker-compose.linux.yml`) brings up an
**`ollama`** service inside the stack and sets
`LLM_BASE_URL=http://ollama:11434/v1` per the
[provider contract](../superpowers/specs/2026-05-09-deployment-contracts.md).

Models are pulled by `portal-init` on first boot using
`DPF_MODEL_PULL_MODE=ollama` (translated to
`curl -X POST http://ollama:11434/api/pull -d '{"name": "<model>"}'`).

To use an external endpoint instead (Anthropic, OpenAI, hosted Ollama,
self-hosted vLLM, etc.), set `LLM_BASE_URL` in `.env` before re-running
the installer:

```bash
LLM_BASE_URL=https://api.example.com/v1
DPF_LLM_PROVIDER=external
```

The Linux overlay still defines the `ollama` service, but you can stop
it with `docker compose stop ollama` if you don't want it running.

## Voice (STT + TTS)

DPF coworkers support voice **input** (speech-to-text) and voice
**output** (text-to-speech).

**Speech-to-text (STT) — works out of the box.** The bundled `dpf-stt`
container (faster-whisper) is profile-free, so it starts on a plain
install and the coworker mic button works immediately. CPU-friendly; no
GPU required.

**Text-to-speech (TTS) — automatic on an NVIDIA GPU.** Spoken output
uses the bundled `dpf-tts` container (Chatterbox — self-hosted, no API
key, data stays on the Docker network). It needs hardware acceleration,
so the installer starts it **automatically when it detects an NVIDIA GPU
with ≥ 6 GB VRAM** — no manual `--profile tts` step. The portal is
already wired to reach it (`TTS_PROVIDER=chatterbox`,
`DPF_TTS_URL=http://dpf-tts:8000`), so spoken output just works.

**No NVIDIA GPU?** The installer skips `dpf-tts` — its GPU reservation
can't start on a GPU-less host, and the self-hosted CPU tier is
~10–30× slower. STT still works. For spoken output without a GPU, route
to a managed TTS API: set `TTS_PROVIDER=cartesia` or
`TTS_PROVIDER=fish-audio` (plus the provider's API key) in `.env` and
re-run the installer. (A GPU-reservation-free CPU-tier default is
tracked as a follow-up.)

> macOS Apple Silicon uses a native-host sidecar instead of `dpf-tts` —
> see the [macOS guide](macos.md#voice-stt--tts).

## Autostart

The installer registers a systemd **user** unit at:

```
~/.config/systemd/user/dpf.service
```

It invokes a generated launch script (`~/.dpf/dpf-autostart.sh`) that
embeds the exact compose `-f` chain captured at install time, so future
overlay edits don't silently break autostart.

`loginctl enable-linger $USER` is run as part of the install so the
unit can survive logout and start at boot. If you don't want lingering,
the unit will run only while you have an active user session.

To inspect or disable the unit:

```bash
systemctl --user status dpf.service
systemctl --user disable --now dpf.service
rm ~/.config/systemd/user/dpf.service
sudo loginctl disable-linger $USER     # optional
```

`bash uninstall-dpf.sh` removes the unit and stops the stack but
preserves volumes / `.env` / `~/.dpf` state for re-install. `--purge`
nukes those too.

## Preflight refusals

The installer refuses to proceed on configurations that don't match
the supported matrix:

- **WSL2 without Docker Desktop integration.** Use the Windows
  installer (`install-dpf.ps1`) instead — it sets up Docker Desktop +
  WSL2 properly.
- **Rootless Docker.** Bind mounts and `host-gateway` extra-hosts mode
  aren't validated against rootless. Switch to root-mode Docker or
  force with `--force-unsupported-host`.
- **Podman / containerd / `nerdctl`.** Not on the supported matrix.
- **Docker < 20.10.** Refused — `host-gateway` arrived in 20.10 and the
  platform's `extra_hosts: host.docker.internal:host-gateway` requires
  it. Upgrade Docker first.
- **Older distros** (Ubuntu < 22.04 / Debian < 12 / Fedora < 39 /
  CentOS 7 / RHEL 7). systemd / cgroup v2 expectations differ enough
  that lifecycle behavior isn't guaranteed.

## Troubleshooting

**"You cannot perform this operation unless you are root"-style errors
right after install.**
You were added to the `docker` group by the installer but your shell
doesn't have it yet. Log out and back in, or run `newgrp docker` and
re-run `bash install-dpf.sh`.

**Portal didn't come up after `--headless` install.**
Run `bash install-dpf.sh doctor` to capture a diagnostic bundle at
`~/.dpf/doctor-<timestamp>.tar.gz` and check
`docker compose -f docker-compose.yml -f docker-compose.linux.yml logs portal --tail 100`.

**Port 3000 already in use.**
The installer's port preflight refuses to proceed if port 3000 is
bound by a non-DPF process, naming the holder and exit code 64.
Stop the conflicting process (`sudo lsof -nP -iTCP:3000 -sTCP:LISTEN`)
or set `DPF_PORTAL_PORT` to an unused port before re-running. Force
through with `DPF_PORT_CONFLICTS_IGNORE=1` if you know the holder
won't actually conflict at compose-up time.

**Ollama model pull stalls.**
Watch the pull progress:
`docker compose -f docker-compose.yml -f docker-compose.linux.yml logs ollama -f`.
Default model size is 4–8 GB; expect minutes on a typical home
connection. Set `DPF_MODEL_PULL_MODE=skip` to defer.

**`systemctl --user enable dpf.service` failed.**
The user systemd instance may not be running. Check
`systemctl --user status` and ensure your distro is configured for
user-level units (default on Ubuntu 22.04+, Debian 12+, Fedora 39+).

**cAdvisor / node-exporter aren't reachable.**
The Linux overlay should start them and mount the matching Prometheus
scrape config. If they are stopped, restart the Linux stack:
`docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d`.

## Uninstall

| Command | What it removes |
|---------|-----------------|
| `bash uninstall-dpf.sh` | systemd-user unit, running containers. **Preserves** volumes, `.env`, `~/.dpf` state. Re-install resumes cleanly. |
| `bash uninstall-dpf.sh --purge` | Above + all DPF docker volumes (filtered by the `com.docker.compose.project=dpf` label so other stacks on the same host are untouched), `.env`, `~/.dpf`. Destructive — irreversible. |
| `bash uninstall-dpf.sh --purge --keep-env` | Purge but retain `.env`. |
| `bash uninstall-dpf.sh --purge --keep-state` | Purge but retain `~/.dpf` install history. |

`loginctl disable-linger $USER` is **not** run automatically; if you
enabled lingering only for DPF, disable it manually after uninstall.

## Help us graduate to GA

The CI gate proves the install path works on `ubuntu-latest`. What
it doesn't prove: that it works on your specific distro, your specific
kernel, your specific Docker version, with your specific user setup.
**That's where you come in.**

**One-minute report:**

1. Open a [new GitHub issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new)
   titled `Install verification — Linux <distro> <version>`
   (example: `Install verification — Linux Debian 12.6 (cloud VM)`).
2. Paste the output of:
   ```bash
   uname -srm && cat /etc/os-release | head -5
   docker --version 2>/dev/null && docker compose version 2>/dev/null
   echo "DPF version: $(grep DPF_INSTALLER_VERSION install-dpf.sh)"
   ```
3. Note which steps you completed from the
   [verification runbook §1](verification-runbook.md#1-linux-end-to-end-install-real-distro-coverage)
   and which (if any) failed.
4. Attach the doctor bundle:
   ```bash
   bash install-dpf.sh doctor
   # Then attach ~/.dpf/doctor-<timestamp>.tar.gz to the issue.
   # Secrets are redacted automatically.
   ```

   > **If you attached a doctor bundle before 2026-08-28, rotate your secrets.**
   > Until then the bundle's `compose-rendered.yml` was written straight from
   > `docker compose config`, which expands every environment variable, so that
   > file carried live values for `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`,
   > `ADMIN_PASSWORD` and `INNGEST_SIGNING_KEY`. Rotate each of them in `.env`
   > and restart the stack. `CREDENTIAL_ENCRYPTION_KEY` decrypts stored
   > credentials, so re-enter any provider secrets after rotating it.

We especially want reports from:

- **Debian 12+** (similar to Ubuntu but uses different package
  defaults; auto-install via `apt` path)
- **Fedora 39+** (different package manager — `dnf` — and SELinux
  context)
- **A real reboot** verifying `systemctl --user` + `loginctl
  enable-linger` survives session loss
- **Air-gapped or restricted-egress installs** if you have a relevant
  environment

Any subset is useful. We don't need every checkbox before reading your
report — we'll integrate findings as they arrive.

## Going further

- [macOS install guide](macos.md) — same platform, different host.
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
