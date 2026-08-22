# DPF Install Guide — Windows 10/11

This is the end-user install guide for the Open Digital Product Factory
on **Windows 10 / 11** with Docker Desktop (WSL2 backend).

> **Status: GA.** Windows is DPF's primary, generally-available install
> surface — the one CI and the maintainers exercise most. macOS (Apple
> Silicon) and Linux are [early access](macos.md). If something here is
> wrong or stale, please [open an issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new).

For the architectural background, see the
[deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md)
and the [platform support watch-list](platform-support-watchlist.md).

## Supported environment

| Component | Required |
|-----------|----------|
| OS | Windows 10 (21H2+) or Windows 11, x64 |
| Backend | Docker Desktop with the **WSL2** backend (not Hyper-V/Windows-containers) |
| Disk | ~10 GB free (Docker Desktop + images). The installer can suggest a roomier non-`C:` drive. |
| RAM | 16 GB host recommended for the local-LLM tier; 8 GB works with an external `LLM_BASE_URL` |
| Docker VM memory | **≥ 6 GB (8 GB recommended)** for the **Customizable** source-build path — see [Docker memory](#docker-memory). Consumer installs pull pre-built images and are lighter. |

Out of scope (per the [watch-list](platform-support-watchlist.md)):
Windows-on-ARM, and WSL2 *without* Docker Desktop.

## Prerequisites

- **Docker Desktop** with the WSL2 backend enabled. The installer checks
  for it and points you to the download if it's missing.
- **Git for Windows** — required for the **Customizable** (source-build)
  mode; not needed for **Ready to go**.
- **Node.js 20+** and **pnpm** — required for **Customizable** mode only
  (the contributor toolchain). The installer does not auto-install the
  Node runtime (out of scope per Contract 3).

## Quick start

Clone the repo and run the launcher. **`install-dpf.bat`** is the
entry point — it self-elevates to Administrator (UAC prompt) and runs
`install-dpf.ps1` with `-ExecutionPolicy Bypass`, so you don't have to
adjust PowerShell policy yourself:

```bat
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory %USERPROFILE%\dpf
cd %USERPROFILE%\dpf
install-dpf.bat
```

The installer is interactive by default and first asks **how you want
to use DPF**:

- **`[1] Ready to go` (consumer)** — runs the pre-built release images
  pulled from GHCR. No contributor tooling. This is the default and the
  fastest path.
- **`[2] Customizable` (customizer)** — builds the full stack from your
  local source, enables the in-repo git hooks, and wires up the
  agent-toolchain (Claude Code / Codex).

Your choice is saved to `%USERPROFILE%\.dpf\.install-mode` and reused on
re-runs without re-prompting.

### What the installer does

1. **Preflight** — verifies Docker Desktop / WSL2, and (Customizable mode)
   git, Node 20+, and pnpm.
2. **Install mode** — prompts for Ready-to-go vs Customizable, persists the
   choice to `%USERPROFILE%\.dpf\.install-mode`, and resumes it on re-run.
3. **Compose chain** — assembles `docker-compose.yml` (+
   `docker-compose.release.yml` in consumer mode) and the Edge Node overlay.
4. **`.env` generation** — only on first install; an existing `.env` is
   preserved.
5. **Images** —
   - *Ready to go:* `docker compose pull` of the CI-stamped GHCR images.
   - *Customizable:* a [Docker-memory preflight](#docker-memory), then
     stamps the build with the real `DPF_VERSION` (`git rev-parse HEAD`)
     and `DPF_PLATFORM_VERSION` (`git describe --tags`) so
     `/ops/self-upgrade` reports the correct identity, then
     `docker compose build`.
6. **`docker compose up -d`** — brings up postgres, portal-init
   (migrations + seed), and the portal.
7. **Health check** — polls `http://localhost:3000/api/health`.
8. **Edge Node bootstrap** — mints a single-use auto-approve token, downloads
   and checksum-verifies the native Go Edge Node, and supervises it with a
   Windows Scheduled Task at logon. The host process owns the physical
   multicast interfaces that Docker Desktop hides from Linux containers. It
   derives the active private IPv4 portal address by default. Discovery works
   over HTTP; automatic pairing requires an explicitly trusted, certificate-
   valid HTTPS `DPF_LAN_AUTHORITY_URL`.
9. **Autostart** — registers a Windows **Scheduled Task** so the stack
   starts at logon (see [Autostart](#autostart)).

### Login

Login credentials are written to `.env` in the install directory:

- **Email:** `admin@dpf.local`
- **Password:** `ADMIN_PASSWORD` in `.env` (randomly generated on first
  install). Change it after first login.

The portal is at **`http://localhost:3000`** — always use `localhost`,
not the machine's LAN IP.

## Day-to-day

| Task | Command (PowerShell, from the install dir) |
|------|--------------------------------------------|
| Start the stack | `.\dpf-start.ps1` |
| Stop the stack | `.\dpf-stop.ps1` |
| Tail logs | `docker compose logs -f portal` |
| Wipe + reinstall (destructive) | `.\dpf-reinstall.ps1` |

`powershell -File install-dpf.ps1 -Help` documents every flag.

## Docker memory

The Next.js production build needs ~4 GB of Node.js heap; with parallel
image builds and OS overhead the Docker VM needs **at least 6 GB
(8 GB recommended)**. Docker Desktop on Windows **defaults to 2 GB**,
which makes a from-source (**Customizable**) build OOM silently inside
the container.

The installer's Customizable path checks this up front and stops with a
clear message if the VM is under-provisioned. To fix:

> **Docker Desktop → Settings → Resources → Memory** → set to **8 GB** →
> Apply & restart, then re-run `install-dpf.bat`.

Advanced override (not recommended): set
`$env:DPF_FORCE_UNSUPPORTED_HOST = '1'` before re-running to proceed
anyway. Tune the thresholds with `DPF_DOCKER_MIN_MEM_MB` /
`DPF_DOCKER_WARN_MEM_MB`.

## LLM provider

On Windows, Docker Desktop ships **Docker Model Runner**, which hosts the
local LLM behind an OpenAI-compatible endpoint. The installer auto-detects
it and sets `DPF_LLM_PROVIDER=model-runner` per the
[provider contract](../superpowers/specs/2026-05-09-deployment-contracts.md).
After a model pull is verified, first boot discovers that model and enables
both the local provider and its routing connection automatically; no provider
toggle is required before using an AI coworker.

To use an external endpoint (Anthropic, OpenAI, hosted Ollama, etc.) set
`LLM_BASE_URL` in `.env` before re-running the installer:

```
LLM_BASE_URL=https://api.example.com/v1
DPF_LLM_PROVIDER=external
```

## Voice (STT + TTS)

DPF coworkers support voice **input** (speech-to-text) and voice
**output** (text-to-speech).

**Speech-to-text (STT) — works out of the box.** The bundled `dpf-stt`
container (faster-whisper) is profile-free, so it starts on a plain
install and the coworker mic button works immediately. CPU-friendly; no
GPU required.

**Text-to-speech (TTS) — automatic on an NVIDIA GPU.** Spoken output
uses the bundled `dpf-tts` container (Chatterbox — self-hosted, no API
key). It needs hardware acceleration, so the installer starts it
**automatically when it detects an NVIDIA GPU with ≥ 6 GB VRAM** — no
manual `--profile tts` step. The portal is already wired to reach it
(`TTS_PROVIDER=chatterbox`, `DPF_TTS_URL=http://dpf-tts:8000`). GPU
passthrough requires Docker Desktop on the WSL2 backend with current
NVIDIA drivers installed on the Windows host.

**No NVIDIA GPU?** The installer skips `dpf-tts` — its GPU reservation
can't start on a GPU-less host, and the self-hosted CPU tier is
~10–30× slower. STT still works. For spoken output without a GPU, route
to a managed TTS API: set `TTS_PROVIDER=cartesia` or
`TTS_PROVIDER=fish-audio` (plus the provider's API key) in `.env` and
re-run the installer. (A GPU-reservation-free CPU-tier default is
tracked as a follow-up.)

## Autostart

The installer registers a Windows **Scheduled Task** that starts the
stack at logon. Inspect or remove it:

```powershell
Get-ScheduledTask -TaskName 'DPF*'        # is it registered?
Unregister-ScheduledTask -TaskName 'DPF-Autostart' -Confirm:$false
```

## Troubleshooting

**`localhost:3000` times out / published ports invisible after install.**
Check your WSL config. `C:\Users\<you>\.wslconfig` with
`networkingMode=mirrored` (shipped by some installer builds) makes
Docker Desktop's published container ports invisible to the Windows host
on Windows 11 25H2. Comment out the `[wsl2]` `networkingMode=mirrored`
lines, then `wsl --shutdown` and restart Docker Desktop. This is the
**first thing to check** when the portal "won't start."

**Build fails with an out-of-memory / killed error (Customizable mode).**
The Docker VM is under-provisioned — see [Docker memory](#docker-memory).

**`/api/health` returns 500.**
The database migrations may not have completed. Tail the portal-init
container: `docker compose logs portal-init`.

**Install log says "Docker Model Runner isn't available … skipping the AI
model download".**
Expected on Docker Desktop older than 4.40 (the `docker model` CLI isn't
present). The portal installs and runs normally — only the local AI model
is skipped, and the installer no longer leaks a raw `docker: 'model' is not
a docker command` error. Update Docker Desktop and re-run the installer to
pull the model, or point the portal at an external LLM provider under
Admin → Providers.

**Install log says an "optional sidecar … image is unavailable upstream".**
The bundled voice speech-to-text sidecar (`dpf-stt`) is pulled from a
third-party registry that occasionally prunes its image tag. When that
happens the installer brings the platform up *without* voice input rather
than failing the whole install — everything else works. Re-run the
installer later to pick the image up once it's available again.

**`install-dpf.bat` closed instantly / "running scripts is disabled".**
Run it from an elevated prompt; the `.bat` launcher passes
`-ExecutionPolicy Bypass` for you, so you should not need to change the
machine policy. If Windows SmartScreen blocked it, choose **More info →
Run anyway**.

## Uninstall

| Command | What it removes |
|---------|-----------------|
| `.\dpf-stop.ps1` | Stops the running containers. Preserves volumes, `.env`, `%USERPROFILE%\.dpf`. |
| `.\dpf-reinstall.ps1` | **Destructive.** Wipes and rebuilds. Removes DPF docker volumes (filtered by the `com.docker.compose.project=dpf` label so other stacks are untouched). Irreversible. |

## Going further

- [macOS install guide](macos.md) · [Linux install guide](linux.md)
- [Platform support watch-list](platform-support-watchlist.md) — per-platform gotchas.
- [Deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md) — the 10 canonical contracts every install path wraps.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — for contributing back to the platform.

### Connecting Claude Code or VS Code via MCP

Once the platform is running, connect Claude Code, Codex CLI, or VS Code
to your install's MCP server. The fastest path is the **Admin UI:**
log in → Admin > Platform Development > MCP Token Manager → generate a
token → paste the displayed snippet into `.mcp.json`.
