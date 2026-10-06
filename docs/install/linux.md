# DPF Install Guide — Linux (native Docker)

This is the end-user install guide for the Open Digital Product Factory
on **native Linux Docker Engine** (no Docker Desktop).

> **Status: Early access — assisted pilot recommended.**
>
> The [v2026.10.02 release install test](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/37010716830/job/110855309417)
> passed on Ubuntu 24.04 x86-64 with Docker 28.0.4 and Compose 2.38.2
> already installed. It verified HTTP portal health, skipped models and
> autostart, and logged a CA health timeout plus a missing runtime-transition
> signing file. It is evidence of basic startup, not production readiness.
> Complete the [pilot acceptance checks](#pilot-acceptance-checks) before a
> customer depends on the installation. Linux GA remains tracked by BI-3BE9A85C.

For the architectural background, see the
[installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
and the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

## Recommended first deployment

Start with **Ubuntu Server 24.04 LTS, x86-64, systemd, native Docker Engine
and the Compose plugin**, on a dedicated VM or physical server. This matches
the recorded release test. Docker stays: it runs DPF's published Linux
containers directly on the Linux host. Docker Desktop and its additional VM
are not required. A cloud VM uses the same Linux installer; see the
[single-VM guide](cloud-single-vm.md).

Use an approved external AI provider for the first pilot if local inference
is not a requirement. For purchasing and workload sizing, use the canonical
[hardware guide](hardware.md): provider-assisted operations recommend
8–12 modern CPU cores, 32 GB RAM and a 1 TB SSD. Local-first operation needs
separate GPU/model validation; an image published for ARM64 does not prove
that host's GPU drivers, inference, reboot or restore path.

## Compatibility and prerequisites

| Component | Required |
|-----------|----------|
| OS | Ubuntu 24.04 is the first pilot target. Ubuntu 22.04+, Debian 12+ and Fedora 39+ are the installer's version floors, not certification of every newer release. Use a release still supported by its vendor and Docker. |
| Architecture | Images publish for `x86_64` and `arm64`; the recorded installation test above is x86-64. |
| Docker Engine | 20.10 or newer (for `host-gateway` extra-hosts mode) |
| Docker Compose | The `docker compose` plugin, version 2 or newer; standalone legacy `docker-compose` is insufficient. |
| Disk and RAM | Size from the [hardware guide](hardware.md), including images, data, models and backup headroom. The old 10-GB disk estimate is not a deployment target. |

The installer refuses to run on:

- WSL2 without Docker Desktop integration (the host-side bind mounts
  the platform relies on don't survive the WSL boundary cleanly).
- Rootless Docker (volumes / `host-gateway` not validated).
- Older Ubuntu (< 22.04), older Debian (< 12), older Fedora (< 39).

RHEL/CentOS, derivatives, rootless/Podman and air-gapped deployment are not
certified by the Ubuntu test. A distro passing the version preflight is not
evidence of DPF support on that distro.

Force with `--force-unsupported-host` if you know what you're doing.

## Prerequisites

When Docker is absent, the installer configures Docker's official repository
and installs Engine, CLI, containerd, Buildx and Compose together (`apt-get`
on Debian/Ubuntu, `dnf` on Fedora). It preserves existing healthy Docker
installations. Missing Compose, conflicting runtime packages, failed package
installation or a failed Docker service stop setup with a specific message;
it never removes an existing runtime or falls back to Engine alone. You bring:

- **`sudo` privileges** — required for the Docker Engine install and for
  adding your user to the `docker` group.
- **Node.js and npm** — Node 24 matches release CI; the current installer
  enforces only major version 20 or newer. It does not install Node for you.
- **pnpm at the repository's `packageManager` version** — provision that exact
  version for repeatability. If pnpm is absent, the installer currently tries
  `npm install -g pnpm`, which can require package-directory permissions.
- **`git`, `curl`, `bash`, `python3`, CA certificates and systemd** — verify
  these on minimal server images; do not assume a desktop distribution's tools.

## Quick start

The Bash installer ships in the repository. For a customer pilot, use a
selected release tag and matching `DPF_IMAGE_TAG` so source and images agree;
the example below names the release whose evidence is linked above.

```bash
git clone --branch v2026.10.02 https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
DPF_IMAGE_TAG=v2026.10.02 bash install-dpf.sh --customer
```

For unattended (CI / scripted) install:

```bash
DPF_IMAGE_TAG=v2026.10.02 bash install-dpf.sh --headless --customer --release
```

These commands describe the published release, which predates the
BI-E1AA1B3C Docker bootstrap repair. Until a release contains that repair,
pre-provision Docker Engine and Compose using Docker's official distro guide.
Do not claim an unmerged or unpublished fix is in the selected release.

#### Contributor: office document conversion

Office document conversion works in both modes with no extra step. A
Customizable install does not build the converter image: the portal pins
the `dpf-doctools` image published for the release your clone descends
from, by digest, and pins it again after every upgrade. Only when no
published image can be reached (offline or air-gapped) does it build
`Dockerfile.doctools` from your clone instead.

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
6. **Node / pnpm sanity check** — refuses Node < 20; tries `npm install -g pnpm` when pnpm is absent. Pre-provision the repository's pinned version for repeatability. Node 24 is the release-tested version.
7. **Workspace dependencies** — `pnpm install`.
8. **Host hardware profile** — runs `scripts/detect-hardware-host.ts`
   (reads `/proc/cpuinfo`, `nproc`, `free -b`, `nvidia-smi` if present).
   Model selection reads the shared `scripts/installer/local-model-policy.json`
   policy. A 24 GB discrete GPU selects the curated `ai/qwen3-coder` tier;
   fresh installs do not auto-provision mutable third-party model references.
9. **`.env` generation** — only on first install; existing `.env` is
   preserved.
10. **HTTPS at the canonical address** — the install becomes its own
    certificate authority and serves the portal over https at one address:
    `https://localhost` when it serves only this machine, or the machine's
    DNS name when the network resolves it here. It writes `PUBLIC_URL` and
    trusts the certificate for your user (`sudo` asks for your password once). AI clients such as
    Claude Code sign in with OAuth only over https. It also saves the AI
    client address (`DPF_MCP_URL`) and the certificate bundle
    (`NODE_EXTRA_CA_CERTS`) in `~/.dpf/agent-toolchain.env`, loaded by your
    shell profile, on every run. If this step fails, the
    portal stays at `http://localhost:3000` and the installer says so.
11. **`docker compose up -d`** on the Linux overlay. Ollama and host telemetry
    are defined behind capability profiles; their presence in YAML does not
    mean every install starts them. Verify the selected AI capability.
12. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
13. **Edge Node bootstrap** (only with `--with-edge`) — mints a single-use
    auto-approve bootstrap token via
    `apps/web/scripts/issue-edge-bootstrap-token.ts --auto-approve`,
    writes it to `.env` as `DPF_BOOTSTRAP_TOKEN`, restarts the
    `edge-node` container so it enrolls. The new EdgeNode lands
    directly in `trustState=trusted` per spec § Approval policy —
    the operator running `install-dpf.sh` has already proven host
    access, so the Approve click in `/platform/edge-nodes` would be
    ceremonial. The node appears in the admin UI within ~10 seconds.
14. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
15. **systemd user unit** — installs
    `~/.config/systemd/user/dpf.service` and runs
    `loginctl enable-linger $USER` so the stack auto-starts at boot
    (skip with `--no-autostart`).

Installation time depends on image/model downloads and host resources.
Allow time for prerequisite setup and a new login when Docker was just installed.

### Login

Login credentials are written to `.env` in the install directory:

- **Email:** `admin@dpf.local`
- **Password:** `ADMIN_PASSWORD` in `.env` (randomly generated on first
  install). Change it after first login.

## Network exposure after install

Base application ports default to loopback through this value in `.env`:

```
DPF_HOST_BIND_ADDRESS=127.0.0.1
```

This is not a blanket guarantee for every overlay: the Linux Ollama service
publishes `11434:11434` when enabled. Inspect the effective profile's published
ports before exposing a host. For remote customer access, configure the HTTPS
ingress deliberately and keep database, cache, management and model endpoints
private. Do not change the global bind address simply to expose the portal.
Docker-published ports can bypass ufw/firewalld expectations; review the
[Docker firewall guidance](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

## Pilot acceptance checks

Record the distro/version, CPU architecture, Docker/Compose versions, exact
release/image identity and selected capabilities with each result. A check
not exercised is **unrun**, not passed.

- Install on a clean host without preinstalled Docker; reconnect after the
  group change and rerun successfully. Verify repeat installation is safe.
- Verify the canonical HTTPS address, certificate trust, administrator login
  and the intended MCP/OAuth sign-in. HTTP health alone is insufficient.
- Complete a real coworker interaction and embedding/search operation with
  the chosen provider. For local AI, exercise model download and inference
  with the intended GPU or CPU configuration.
- Confirm required capabilities start without missing-state errors. The
  v2026.10.02 job logged `/dpf-state/runtime-transition.secret` missing.
- Reboot the host without interactive login; verify Docker, DPF and selected
  capabilities recover through the systemd/linger path.
- Restore a backup into a separate declared test installation; verify records,
  uploaded files and required configuration. Never test restore over production.
- Upgrade through `/ops/self-upgrade` and verify the recovery point and
  post-upgrade behavior. Do not substitute a hand-built image or database downgrade.
- Validate remote access and port exposure from a second machine; retain the
  diagnostic report with secrets redacted.

Use the [verification runbook](verification-runbook.md) for execution. Repeat
this matrix for Debian, Fedora or ARM64 before extending the support claim.
The prerequisite regression tests do not replace these runtime checks.

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

With `--with-edge`, a single-host install bundles a **DPF Edge Node** alongside
the Authority Core. It is opt-in. The Edge Node is a small Node.js container that:

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

DPF's Linux compose overlay (`docker-compose.linux.yml`) defines an
**`ollama`** service behind its AI capability profile and defaults
`LLM_BASE_URL=http://ollama:11434/v1` per the
[provider contract](../superpowers/specs/2026-05-09-deployment-contracts.md).

[Docker Model Runner also supports Docker Engine](https://docs.docker.com/ai/model-runner/get-started/#docker-engine).
It is not provisioned by DPF's Linux installer. Use the currently configured
provider until the alternative's model lifecycle and inference are verified.

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

**Speech-to-text (STT) — connect a provider.** DPF ships no speech
container. Voice input becomes available as soon as you configure a
provider that can transcribe, under **Platform Tools → Communications**.
Any provider serving an OpenAI-compatible `/v1/audio/transcriptions`
endpoint works, including OpenAI and Groq. If you would rather audio
never left your own network, run your own speech server — speaches and
whisper.cpp server are both MIT-licensed — and give DPF its address under
the self-hosted speech provider. DPF stopped bundling one so that a third
party's registry housekeeping could no longer block platform releases.

**Text-to-speech (TTS) — automatic on an NVIDIA GPU.** Spoken output
uses the bundled `dpf-tts` container (Chatterbox — self-hosted, no API
key, data stays on the Docker network). It needs hardware acceleration,
so the installer starts it **automatically when it detects an NVIDIA GPU
with ≥ 6 GB VRAM** — no manual `--profile tts` step. The portal is
already wired to reach it (`TTS_PROVIDER=chatterbox`,
`DPF_TTS_URL=http://dpf-tts:8000`), so spoken output just works.

**No NVIDIA GPU?** The installer skips `dpf-tts` — its GPU reservation
can't start on a GPU-less host, and the self-hosted CPU tier is
~10–30× slower. Voice input is unaffected — it follows your provider
configuration, not this container. For spoken output without a GPU, route
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

The recorded release test proves basic startup on Ubuntu with preinstalled
Docker. It does not prove fresh Docker provisioning, HTTPS, inference,
reboot, restore or upgrade on each supported host configuration.
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
   > `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are shared by the portal
   > and the `inngest` service, so recreate both services together after
   > rotating either one.

We especially want reports from:

- **Debian 12+** (similar to Ubuntu but uses different package
  defaults; auto-install via `apt` path)
- **A currently supported Fedora release** (different package manager — `dnf` — and SELinux
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
