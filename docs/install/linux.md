# DPF Install Guide — Linux (native Docker)

This is the end-user install guide for the Open Digital Product Factory
on **native Linux Docker Engine** (no Docker Desktop).

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

### What the installer does

1. **Preflight** — refuses to run on WSL2-without-DD / rootless Docker /
   Podman / older distros.
2. **`~/.dpf/install-state.json`** — initializes or migrates the install
   state file (schema-versioned). Honors `XDG_STATE_HOME`.
3. **Compose chain** — assembles `docker-compose.yml` +
   `docker-compose.linux.yml` (+ `docker-compose.release.yml` if
   `--release`).
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
9. **`.env` generation** — only on first install; existing `.env` is
   preserved.
10. **`docker compose up -d`** on the Linux overlay (which adds the
    `ollama` service for local LLM hosting and enables the
    `linux-monitoring` profile for cAdvisor + node-exporter).
11. **Health check** — polls `http://localhost:3000/api/health` for up
    to 5 minutes (configurable via `DPF_HEALTH_TIMEOUT`).
12. **Persist state** — records `lastSuccessfulInstallVersion` and
    `lastHealthCheck`.
13. **systemd user unit** — installs
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
| Tail logs | `docker compose -f docker-compose.yml -f docker-compose.linux.yml logs -f` |
| Diagnostic bundle | `bash install-dpf.sh doctor` |
| Wipe + reinstall (destructive) | `bash dpf-reinstall.sh` |
| Tag + push a release | `bash dpf-release.sh --bump minor` |
| Soft uninstall (keep data) | `bash uninstall-dpf.sh` |
| Full uninstall (wipe data) | `bash uninstall-dpf.sh --purge` |

Pass `--help` to any of those scripts to see all flags.

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
Stop whatever is binding it (`sudo lsof -i :3000`) before re-running.
Phase 10 of the installer roadmap adds upfront port-conflict detection.

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
They're behind the `linux-monitoring` profile. The Linux overlay opts
in by default. To opt out:
`docker compose -f docker-compose.yml -f docker-compose.linux.yml stop cadvisor node-exporter`.

## Uninstall

| Command | What it removes |
|---------|-----------------|
| `bash uninstall-dpf.sh` | systemd-user unit, running containers. **Preserves** volumes, `.env`, `~/.dpf` state. Re-install resumes cleanly. |
| `bash uninstall-dpf.sh --purge` | Above + all DPF docker volumes (filtered by the `com.docker.compose.project=dpf` label so other stacks on the same host are untouched), `.env`, `~/.dpf`. Destructive — irreversible. |
| `bash uninstall-dpf.sh --purge --keep-env` | Purge but retain `.env`. |
| `bash uninstall-dpf.sh --purge --keep-state` | Purge but retain `~/.dpf` install history. |

`loginctl disable-linger $USER` is **not** run automatically; if you
enabled lingering only for DPF, disable it manually after uninstall.

## Going further

- [macOS install guide](macos.md) — same platform, different host.
- [Installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)
- [Deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md) — the 10 canonical contracts every install path wraps.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — for contributing back to the platform.
