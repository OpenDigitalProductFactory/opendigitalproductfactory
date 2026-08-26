# DPF Install Guide — macOS (Apple Silicon)

This is the end-user install guide for the Open Digital Product Factory
on **Apple Silicon Macs** (M1 or later).

> **Status: GA — validated on real Apple Silicon hardware.**
>
> The macOS installer has been run end-to-end on a real Apple Silicon
> Mac (M-series, macOS 14+) and troubleshot to a working portal,
> including the voice (STT + native-host TTS) path. The findings from
> that validation are folded into the steps and the
> [Troubleshooting](#troubleshooting) section below.
>
> CI still only exercises the `--dry-run` path (the `macos-14` GHA
> runner can't nest-virtualize Docker Desktop), so additional
> verification reports on other Mac models / macOS versions remain
> welcome — see [Verify your install](#verify-your-install). Both
> Windows and macOS Apple Silicon are GA install surfaces today.

For the architectural background, see the
[installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
and the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

## Supported environment

| Component | Required |
|-----------|----------|
| OS | macOS 14 (Sonoma) or newer |
| Architecture | Apple Silicon (`arm64`). Intel Macs are not supported. |
| Disk | ~10 GB free for the application images; buy at least 1 TB, or 2 TB when local models will run on the host. |
| RAM | 32 GB recommended with an external AI provider; 64 GB practical for local-first use; choose 128 GB for larger models or combined operations and development. |

The installer refuses to run on unsupported hosts (Intel Mac, older
macOS) unless you pass `--force-unsupported-host` — see
[Preflight refusals](#preflight-refusals).

## Recommended hardware

Choose the profile that matches where primary AI inference will run:

| Deployment model | Recommended Apple Silicon configuration | Best fit |
| --- | --- | --- |
| Provider-assisted operations | **32 GB unified memory, 1 TB SSD** | Routine DPF operations using approved external AI providers |
| Local-first operations | **64 GB unified memory practical; 128 GB for larger models or combined operations and development; 2 TB SSD** | Local tool-using coworkers, larger models, and longer context |
| Contributor/development workstation | **128 GB unified memory, 4 TB SSD** | Operations plus source work, builds, tests, browser automation, and local model evaluation |

Apple Silicon lets the CPU and GPU share one memory pool. DPF's planning rule
reserves 25% for macOS and the application stack, leaving about 48 GB on a
64 GB Mac and 96 GB on a 128 GB Mac for local AI workloads. Memory cannot be
upgraded after purchase, so buy 128 GB when the Mac must handle larger local
models or serve as both the DPF host and a development workstation.

See [Choosing Hardware for DPF](hardware.md) for current Mac and Windows machine
examples, NVIDIA speed tradeoffs, model sizing, and purchase checks.

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

#### Contributor: separate dev workspace from install (recommended, BI-0856A4CE Phase 1)

Contributor installs default to single-tree mode — the cloned repo at the
install path doubles as your dev workspace where `git worktree add` creates
feature branches. That works, but the dev tree can collide with the running
portal and the self-upgrade merge loop (BI-A8A7CCFD).

Pass `--dev-workspace-path` to register a **separate** clone as the dev
workspace. The dev-loop scripts (`scripts/new-dev-worktree.sh`) then branch
new worktrees from THERE instead of the install path, so the production
install is left alone:

```bash
# 1. Install (production tree at $REPO_ROOT — the cwd):
bash install-dpf.sh --headless --contributor --dev-workspace-path ~/dpf-dev

# 2. Clone the dev workspace separately (one-time):
git clone git@github.com:OpenDigitalProductFactory/opendigitalproductfactory.git ~/dpf-dev

# 3. From now on, run dev-loop scripts from the dev workspace:
cd ~/dpf-dev
bash scripts/new-dev-worktree.sh my-feature
#   → creates ~/dpf-dev-worktrees/my-feature
```

When `--dev-workspace-path` is omitted (or resolves to the install path),
single-tree mode persists — current behavior, full back-compat.

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
   `docker-compose.macos.yml` (+ `docker-compose.release.yml` in
   release/customer mode). The Edge Node is **opt-in**: pass
   `--with-edge` to also bundle a local `docker-compose.edge.yml`
   node. By default no Edge Node is installed — map a network from
   another machine instead via Admin > Platform Development > Edge Nodes.
5. **Docker Desktop** — installs the `.dmg` if missing
   (`hdiutil attach` + `cp -R /Applications`), then starts it and waits
   for the daemon.
6. **Node / pnpm sanity check** — refuses if Node < 20 or pnpm missing.
7. **Workspace dependencies** — `pnpm install`. In **contributor** mode the
   installer also enables the in-repo `.githooks/` (`git config
   core.hooksPath .githooks`), **auto-installs the GitHub CLI (`gh`)** into
   `~/.dpf/tools/bin` (no Homebrew/sudo — downloaded from the official
   release and checksum-verified) and adds it to your `PATH`, then runs the
   agent-toolchain bootstrap so Claude Code / Codex are wired up. It does
   **not** sign you in — finish with `gh auth login --git-protocol https
   --web` (the OAuth flow, which avoids the fine-grained-PAT lifetime limits
   some orgs enforce) and `gh auth setup-git`. Customer mode skips all of
   this.
8. **Host hardware profile** — runs `scripts/detect-hardware-host.ts`
   and emits `DPF_HOST_PROFILE` (Apple Silicon reports
   `architecture: "unified"` for memory). Model selection reads the shared
   `scripts/installer/local-model-policy.json` policy. A 32 GB unified Mac
   selects the curated `ai/qwen3-coder` tier; fresh installs do not
   auto-provision mutable third-party model references.
9. **`.env` generation** — only on first install; existing `.env` is
   preserved.
10. **Release image availability** (customer mode only) — probes the GHCR
    portal image and, if it's gated behind early-access auth, points you at
    `docker login ghcr.io` before bring-up.
11. **`docker compose up -d`** on the macOS overlay.
12. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
13. **Edge Node bootstrap** (only with `--with-edge`) — mints a single-use
    auto-approve token and installs the checksum-verified Go Edge Node as
    `local.dpf-edge-node`, a launchd-supervised host process. It enrolls as a
    trusted `native` node and owns the Mac's physical multicast interfaces, so
    nearby DPF discovery is no longer trapped inside Docker Desktop's Linux VM.
    The installer uses the active private IPv4 portal address by default.
    Discovery works over HTTP; automatic pairing remains blocked until
    `DPF_LAN_AUTHORITY_URL` names a certificate-valid HTTPS origin trusted by
    the other installation.
14. **Voice / TTS sidecar** (Apple Silicon only) — runs
    `scripts/tts/setup-chatterbox-tts-macos.sh` to provision the
    native-host text-to-speech sidecar (port `8771`) and wire its
    `TTS_PROVIDER` / `DPF_TTS_URL` / `DPF_TTS_REFERENCE_HOST_ROOT`
    values into `.env`, so spoken output works out of the box. Idempotent
    and non-fatal (warns and continues if it fails); skipped on
    Linux/Windows, which use the bundled `dpf-tts` container. See
    [Voice (STT + TTS)](#voice-stt--tts).
15. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
16. **LaunchAgent** — installs `~/Library/LaunchAgents/local.dpf-autostart.plist`
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
After a model pull is verified, first boot discovers that model and enables
both the local provider and its routing connection automatically; no provider
toggle is required before using an AI coworker.

To use an external endpoint (Anthropic, OpenAI, hosted Ollama, etc.)
instead, set `LLM_BASE_URL` in `.env` before re-running the installer:

```bash
LLM_BASE_URL=https://api.example.com/v1
DPF_LLM_PROVIDER=external
```

## Voice (STT + TTS)

DPF coworkers support both voice **input** (speech-to-text) and voice
**output** (text-to-speech). On macOS the two halves are provisioned
differently because Docker Desktop can't reach the Apple Neural Engine.

**Speech-to-text (STT) — works out of the box.** A bundled `speaches`
(faster-whisper / distil-whisper) service runs as the `dpf-stt`
container. It's CPU-friendly and needs no GPU, so the mic button in the
coworker panel works immediately after install — click it, speak, and
your words land in the message box. STT is identical across macOS,
Linux, and Windows.

**Text-to-speech (TTS) — provisioned automatically on Apple Silicon.**
Spoken output needs a synthesis engine with hardware acceleration.
Docker Desktop can't expose the Mac's Neural Engine to a container, so
on Apple Silicon the TTS engine runs as a **native-host sidecar** on
the Mac instead of in Docker. The `docker-compose.macos.yml` overlay is
already wired to talk to it (`TTS_PROVIDER=mlx`,
`DPF_TTS_URL=http://host.docker.internal:8771`).

**`bash install-dpf.sh` provisions this sidecar for you** — no manual
step. On an Apple Silicon host the installer runs
`scripts/tts/setup-chatterbox-tts-macos.sh`, which installs a launch
agent so the sidecar restarts at login, listens on port `8771`, and
writes the matching `TTS_PROVIDER` / `DPF_TTS_URL` /
`DPF_TTS_REFERENCE_HOST_ROOT` values into `.env`. A **founder seed
voice** ships in the install seed (with a consent record), so spoken
output works as soon as the install finishes — no voice recording
required to get started.

> Both **customer** (`bash install-dpf.sh`) and **contributor**
> (`scripts/setup.sh`) installs provision the sidecar automatically on
> Apple Silicon; the step is idempotent and skips cleanly on re-runs.
> If the sidecar setup fails the install still completes — it just warns
> and points you at the manual command below. On Linux / Windows hosts
> TTS uses the bundled `dpf-tts` Docker container instead and needs no
> host-side step.
>
> To (re-)provision by hand at any time:
>
> ```bash
> bash scripts/tts/setup-chatterbox-tts-macos.sh
> ```

Once the sidecar is running, voice output features — per-profile
speed / enthusiasm tuning and sentence-level streaming for low
time-to-first-audio — are available in the coworker panel. Real-person
voice cloning always requires an explicit consent record; voice never
changes approval, confidence, or audit rules.

**If the coworker transcribes but won't speak back**, the TTS sidecar
isn't running. Re-run the setup script and confirm the agent loaded:

```bash
bash scripts/tts/setup-chatterbox-tts-macos.sh
launchctl list | grep -E 'mlx-tts|chatterbox-tts'
curl -fsS http://localhost:8771/health    # sidecar health
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

**Install log says "Docker Model Runner isn't available … skipping the AI
model download".**
Expected on Docker Desktop older than 4.40 (the `docker model` CLI isn't
present). The portal installs and runs normally — only the local AI model
is skipped, and the installer no longer leaks a raw `docker: 'model' is not
a docker command` error. Update Docker Desktop and re-run
`bash install-dpf.sh` to pull the model, or point the portal at an external
LLM provider under Admin → Providers.

**Install log says an "optional sidecar … image is unavailable upstream".**
The bundled voice speech-to-text sidecar (`dpf-stt`) is pulled from a
third-party registry that occasionally prunes its image tag. When that
happens the installer brings the platform up *without* voice input rather
than failing the whole install — everything else works. Re-run
`bash install-dpf.sh` later to pick the image up once it's available again.

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

## Verify your install

macOS Apple Silicon is GA, but CI still can't run the installer on real
hardware (the GHA `macos-14` runner can't nest-virtualize Docker
Desktop), so verification reports from additional Mac models / macOS
versions remain valuable for widening the tested matrix. If you ran the
install above, **a quick report is appreciated** — happy paths and
failures are equally useful.

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
