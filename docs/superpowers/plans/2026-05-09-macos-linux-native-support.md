# Mac (Apple Silicon) + Linux Native Support — Roadmap

> Branch: `claude/mac-docker-compatibility-uN4Ya`
> Deliverable for this branch: **this plan only**. Each phase below lands as a
> separate PR per AGENTS.md §4 ("one concern per branch, one concern per PR").

## Context

DPF (Digital Product Factory) currently installs and runs only on Windows
10/11. The day-to-day setup is a 1,329-line PowerShell installer
(`install-dpf.ps1`) plus `dpf-{start,stop,reinstall,release}.ps1` siblings,
Docker Desktop with a multi-service compose stack (Postgres, Neo4j, Qdrant,
Redis, Inngest, portal, portal-init, sandbox/Build Studio, promoter,
browser-use, adp, integration-test-harness, plus a Prometheus/Grafana
monitoring stack), and a Docker Model Runner-hosted local LLM. AGENTS.md §2
explicitly pins PowerShell scripts to Windows + PS 5.1+, and §4 names `d:\DPF`
as the Windows worktree root. README.md:208 already lists "Mac & Linux
Installers" as a future feature.

Interest in additional environments is growing. This roadmap tees up
**full installer-parity native support** for two new platforms:

- **macOS Apple Silicon (arm64)** via Docker Desktop 4.40+ (keeps Docker Model
  Runner as the LLM source).
- **Linux (native Docker Engine, no Docker Desktop)** — no Docker Model
  Runner; LLM provided by an Ollama service inside compose.

**Out of scope:** Intel Mac, Windows on ARM, BSD/illumos, WSL2 without Docker
Desktop, Podman/containerd, rootless Docker, air-gapped Linux, distros older
than Ubuntu 22.04 / Fedora 39 / Debian 12.

## Already portable (do not redo)

Phase-1 exploration confirmed the following are already cross-platform:

- All base images are multi-arch (`node:24-alpine`, `postgres:16-alpine`,
  `neo4j:5-community`, `qdrant/qdrant:latest`, `python:3.11-slim`); no
  `platform:` directives in `docker-compose.yml`.
- `docker-entrypoint.sh` runs inside the Linux container — platform-neutral.
  Line 162 already supports `LLM_BASE_URL` override of the Model Runner
  default, which is exactly the Linux-without-Docker-Desktop story.
- `Makefile`, `package.json` scripts (pure `pnpm --filter`), and all
  `apps/web` Docker shell-outs (`apps/web/lib/integrate/sandbox/sandbox.ts`,
  `apps/web/lib/mcp-tools.ts:1025-1162, 9420-9499`) are POSIX-clean.
- `packages/db/src/discovery-collectors/docker.ts:6-9` already enumerates both
  the Unix socket and the Windows pipe.
- `packages/db/src/discovery-collectors/host.ts:31` already branches on
  `process.platform === "win32"` and falls through to `dpkg`/`rpm`.
- `apps/web/lib/integrate/codebase-tools.ts:47-71` blocks `^[A-Za-z]:` paths —
  harmless on Mac/Linux.
- `dpf-release.ps1` is pure git operations — direct port to bash.
- `.devcontainer/devcontainer.json` exists and is fully container-based.
- `scripts/setup.sh` exists (174 lines) but is stale: assumes Ollama, has BSD
  `sed -i` portability bugs at lines 66/69/82/83, doesn't match the PS
  installer's phase structure. Will be rewritten in Phase 1.

## Cross-cutting decisions

- **VS Code tasks** — use per-task `windows`/`osx`/`linux` overrides in
  `.vscode/tasks.json`. Keeps the existing 16 Windows tasks untouched and
  adds bash equivalents in one focused diff. (Rejected: routing all tasks
  through `pnpm run` pollutes `package.json`; relying on shell auto-detect
  leaks shell quirks.)
- **Linux LLM provider** — ship an `ollama` service in
  `docker-compose.linux.yml` and set `LLM_BASE_URL=http://ollama:11434/v1`.
  Honor a pre-existing `LLM_BASE_URL` in `.env` so users with an external
  endpoint can skip Ollama. Zero code change in `apps/web/lib/ai-inference.ts`.
- **Shell target** — bash 3.2 baseline so the installer runs on a stock
  macOS without `brew install bash`. `#!/usr/bin/env bash`, `shellcheck
  --shell=bash` in CI, no associative arrays / `mapfile` / `${var^^}`.
- **Install paths** — repo at `~/dpf/`, state at `~/.dpf/{logs,config}/`.
  Mirrors the Windows `D:\DPF` repo / `D:\docker-data\dpf` data split.
- **Auto-start** — LaunchAgent on macOS (`~/Library/LaunchAgents/local.dpf-autostart.plist`),
  systemd user unit on Linux (`~/.config/systemd/user/dpf.service` with
  `loginctl enable-linger`). Both unprivileged.

## Phases (each = one PR)

### Phase 0 — Multi-arch GHCR images (PREREQUISITE)
**Goal:** the Consumer install path can pull `linux/arm64` images.
**Files:** `.github/workflows/publish-image.yml` (lines 64-82 build with
`docker/build-push-action@v7` but no `platforms:` arg → currently amd64-only).
Add `docker/setup-qemu-action`, `docker/setup-buildx-action`, and
`platforms: linux/amd64,linux/arm64` to the portal, sandbox, and promoter
build steps. Tag a fresh release; verify `docker manifest inspect
ghcr.io/.../dpf-portal:latest` shows both architectures.
**Why first:** Phase 4's installer can't function on Apple Silicon without it
(QEMU fallback is too slow for the portal+sandbox stack).
**Risk:** low. Single workflow file.

### Phase 1 — Repo navigability + AGENTS.md
**Goal:** clone, `make dev`, run VS Code tasks on Mac/Linux without Docker.
**Files:**
- `AGENTS.md` (extend §2 line 23 to add a bash-on-macOS/Linux paragraph;
  extend §4 line 51 with `~/dpf-worktrees/` for non-Windows).
- `scripts/setup.sh` — full rewrite: align with `install-dpf.ps1` phase
  numbering, fix `sed -i` BSD portability bugs (lines 66/69/82/83 → use
  `sed -i.bak '...' file && rm file.bak`), default to Docker Model Runner
  with Ollama fallback when `command -v docker model` fails.
- `.vscode/tasks.json` — add `osx` + `linux` overrides to all 16 tasks.
- `Makefile` — sanity-check (already POSIX-clean).
**Verify:** `bash scripts/setup.sh && make dev` succeeds on Apple Silicon
and on Ubuntu 22.04. "DPF: Type Check" task runs from VS Code on both.

### Phase 2 — Compose portability
**Goal:** `docker compose up` works on macOS Docker Desktop and on native
Linux Docker Engine.
**Files:**
- `docker-compose.yml` — replace promoter relative paths
  (`./backups`, `.:/host-source:ro` at lines 217-218) with
  `${DPF_HOST_INSTALL_PATH}` (already in `.env.docker.example:41`); add
  `extra_hosts: host.docker.internal:host-gateway` to sandbox, promoter, adp,
  prometheus (currently only on portal:128 and browser-use:252); gate
  cadvisor (lines 466-469) and node-exporter (lines 478-481) behind
  `profiles: ["linux-monitoring"]` (their `/proc`, `/sys`, `/var/lib/docker`,
  `/` bind mounts cannot work on macOS).
- `docker-compose.linux.yml` **(new)** — adds `ollama` service, sets
  `LLM_BASE_URL=http://ollama:11434/v1`, opts in to `linux-monitoring` profile.
- `docker-compose.macos.yml` **(new)** — keeps Docker Model Runner endpoint;
  optionally points at host `node_exporter` on `host.docker.internal:9100`.
- `monitoring/prometheus/prometheus.yml` — rename `windows-host` job to
  `host-exporter`; make target an env-substituted variable.
- `.env.docker.example` — document the new toggles.
**Verify:** `docker compose -f docker-compose.yml -f
docker-compose.<platform>.yml config` exits 0; `up portal postgres
ollama|model-runner` then `curl localhost:3000/api/health` returns 200 on
both OSes.

### Phase 3 — Host-side hardware detection
**Goal:** `DPF_HOST_PROFILE` JSON populated correctly on macOS / Linux. The
existing `scripts/detect-hardware.ts` (49 lines) only reads `/proc/*` from
inside the container; the host-side WMI logic lives in `install-dpf.ps1`
lines 1038-1118 and has no bash counterpart.
**Files:**
- `scripts/detect-hardware-host.ts` **(new)** — `os.platform()` dispatches to
  `sysctl hw.ncpu / hw.memsize`, `system_profiler SPDisplaysDataType` (macOS),
  or `/proc/cpuinfo`, `nproc`, `free -b`, `lspci`, `nvidia-smi` (Linux).
  Emits the same JSON shape that auto-model-selection consumes.
- `scripts/detect-hardware.ts` — unchanged; continues to consume
  `DPF_HOST_PROFILE` env var.
- Add `architecture: "unified"` flag for Apple Silicon since GPU/RAM share
  the same pool. Coordinate with consumers in `apps/web/lib/agent-grants.ts`
  and provider-selection paths.
**Verify:** `pnpm exec tsx scripts/detect-hardware-host.ts` prints valid JSON
on Apple Silicon and Linux; row visible in `PlatformConfig` after
`docker compose up portal-init`.

### Phase 4 — `install-dpf.sh` (the big one)
**Goal:** parity with the 10-phase `install-dpf.ps1` for macOS + Linux.
**New files:**
- `install-dpf.sh` — main installer; mirrors PS phases 1, 3-10 (phase 2 WSL
  skipped via `case "$(uname -s)"`).
- `uninstall-dpf.sh`.
- `scripts/installer/lib/{platform,docker,model,paths,autostart,logging,prompts}.sh`
  — modular helpers, sourced by installer + lifecycle scripts.
- `scripts/installer/macos-launchagent.plist.tmpl`.
- `scripts/installer/linux-systemd.service.tmpl`.
**Phase notes:**
- Phase 3 macOS: `mdfind 'kMDItemCFBundleIdentifier=="com.docker.docker"'`,
  fallback to `brew install --cask docker`.
- Phase 3 Linux: distro package manager, `systemctl enable --now docker`,
  add `$USER` to `docker` group, prompt logout-or-`newgrp docker`. Refuse
  Docker `< 20.10` (required for `host-gateway`).
- Phase 9 macOS: `docker model pull <model>`. Linux: bring up `ollama`
  service and `curl -X POST localhost:11434/api/pull`.
- Phase 10: install LaunchAgent (macOS) / systemd user unit (Linux).
**Verify:** **fresh-Mac-from-zero** (clean macOS 14 VM, no Docker, no brew →
`bash install-dpf.sh` → `http://localhost:3000` reachable). **Fresh-Linux**
(clean Ubuntu 22.04, cloud-init only → same flow → portal reachable).
**Risk:** highest. See risks below.

### Phase 5 — Lifecycle scripts
**Goal:** start/stop/reinstall/release siblings.
**Files:** `dpf-start.sh`, `dpf-stop.sh`, `dpf-reinstall.sh`, `dpf-release.sh`,
plus copies in `scripts/`. `dpf-reinstall.sh` replaces the PS script's
hardcoded `${drive}:\docker-data\dpf` (lines 186-195) with a
`docker volume rm $(docker volume ls -q --filter label=dpf=true)` sweep —
removes Windows drive-letter assumptions entirely.
**Verify:** reboot host; portal auto-starts within 60s.
`dpf-reinstall.sh` wipes volumes and reinstalls cleanly.

### Phase 6 — Docs + CI matrix
**Goal:** README install sections + CI runs on `macos-14` (arm64) and
`ubuntu-22.04`.
**Files:** `README.md` (line 208), `docs/install/macos.md` **(new)**,
`docs/install/linux.md` **(new)**, `.github/workflows/ci.yml` (matrix entry
that runs `install-dpf.sh --headless --no-autostart` then `make test`),
`CONTRIBUTING.md`. Guard the macos-14 job with path filters to manage runner
cost.

### Phase 7 — Hardening + long-tail discovery
**Goal:** close gaps surfaced by Phases 4-6.
**Files:** `apps/web/lib/integrate/codebase-tools.ts` (add unit test that
POSIX absolute paths are not falsely blocked at lines 47-71);
`packages/db/src/discovery-collectors/host.ts` (add `darwin` branch using
`pkgutil --pkgs` + `brew list`); `packages/db/src/discovery-collectors/docker.ts`
(add macOS Docker Desktop socket fallback path
`~/Library/Containers/com.docker.docker/Data/docker.raw.sock` if `/var/run/docker.sock`
is missing); sanity-check argument quoting in
`apps/web/lib/integrate/sandbox/sandbox.ts` and
`apps/web/lib/mcp-tools.ts` under bash.

## Risks

1. **Multi-arch image publishing** — handled by Phase 0; without it Phase 4
   is a non-starter on Apple Silicon.
2. **Apple Silicon + Chromium in `services/browser-use`** — Python+Chromium
   image. Verify `Dockerfile` builds clean on `linux/arm64` during Phase 2;
   if not, add `--platform linux/amd64` to that one service (with a known
   Rosetta perf hit).
3. **Sandbox `bubblewrap` on Apple Silicon** — `Dockerfile.sandbox:3` adds
   `bubblewrap`. Alpine ships it for arm64, but interactions with Docker
   Desktop's gVisor on macOS are unproven. Already mitigated by Codex's
   `sandbox_mode="danger-full-access"` (Dockerfile.sandbox:21) which disables
   bubblewrap at runtime — but the package install must still succeed.
4. **Apple Silicon GPU schema** — unified memory architecture doesn't fit
   the discrete-VRAM assumption baked into auto-model-selection (`install-dpf.ps1:1086-1118`).
   Phase 3 must add an `architecture: "unified"` flag and update consumers
   without breaking Windows logic.
5. **macOS Gatekeeper / quarantine** — LaunchAgent plist may need
   `xattr -d com.apple.quarantine` on a fresh Gatekeeper-enabled machine.
   Test in Phase 4 verification.

## Critical files referenced

- `/home/user/opendigitalproductfactory/install-dpf.ps1` (1,329 lines —
  primary source for phase mapping)
- `/home/user/opendigitalproductfactory/docker-compose.yml` (550 lines —
  Phase 2)
- `/home/user/opendigitalproductfactory/docker-entrypoint.sh:155-175` (LLM
  endpoint logic)
- `/home/user/opendigitalproductfactory/scripts/setup.sh` (Phase 1 rewrite)
- `/home/user/opendigitalproductfactory/scripts/detect-hardware.ts` (Phase 3
  pair)
- `/home/user/opendigitalproductfactory/.vscode/tasks.json` (Phase 1)
- `/home/user/opendigitalproductfactory/.github/workflows/publish-image.yml`
  (Phase 0)
- `/home/user/opendigitalproductfactory/AGENTS.md` §2/§4 (Phase 1)

## End-to-end verification (after Phase 6)

1. **Fresh Apple Silicon Mac**: clean macOS 14 VM → install Xcode CLT →
   `bash <(curl ... install-dpf.sh)` → `http://localhost:3000/api/health`
   returns 200 → log in with admin credentials → run a Build Studio task →
   reboot → portal back up within 60s via LaunchAgent.
2. **Fresh Linux box**: clean Ubuntu 22.04 → `bash install-dpf.sh` →
   user added to docker group → portal reachable → Ollama-served model
   responds → `dpf-stop.sh && dpf-start.sh` round-trip clean → systemd user
   unit survives reboot.
3. **Existing Windows install**: `install-dpf.ps1` continues to work
   unchanged. CI matrix proves no regression.
