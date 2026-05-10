# Mac (Apple Silicon) + Linux Native Support — Roadmap

> Branch: `claude/mac-docker-compatibility-uN4Ya`
> Deliverable for this branch: **this plan only**. Each phase below lands as a
> separate PR per AGENTS.md §4 ("one concern per branch, one concern per PR").
>
> Revision history:
> - 2026-05-09 — initial roadmap (7 phases).
> - 2026-05-09 — chief architect amendment: promoted release-artifact and
>   LLM-provider contracts to first-class phases ahead of the installer;
>   re-numbered to 10 phases; added install-state contract and Docker-context
>   discovery; expanded risk register.
> - 2026-05-09 — monitoring-scope amendment (now partially reversed below):
>   first attempt to scope all host exporters out of the installer.
> - 2026-05-09 — sweep-dependency correction: the previous amendment was
>   wrong. The network sweep at `packages/db/src/discovery-collectors/network.ts`
>   queries `windows_net_nic_address_info` (Windows) and `node_network_info`
>   (Linux) from Prometheus to enumerate real host NICs; without those
>   metrics it falls back to container-local interfaces with degraded
>   confidence (0.70 vs 0.95). `windows_exporter` therefore stays in
>   `install-dpf.ps1`; the `windows-host` scrape stays in `prometheus.yml`.
>   Added a "Network sweep data path" cross-cutting decision documenting the
>   per-platform contract. Added a Phase 3 fix for the hardcoded Grafana URL
>   at `apps/web/components/monitoring/SystemHealthDashboard.tsx:158`. Added
>   Qdrant-silent-failure historical context. Future direction section now
>   sketches a cleaner discovery-plane architecture to replace the
>   exporter-on-host pattern over time.

## Context

DPF (Digital Product Factory) currently installs and runs only on Windows
10/11. The day-to-day setup is a 1,329-line PowerShell installer
(`install-dpf.ps1`) plus `dpf-{start,stop,reinstall,release}.ps1` siblings,
Docker Desktop with a multi-service compose stack (Postgres, Neo4j, Qdrant,
Redis, Inngest, portal, portal-init, sandbox/Build Studio, promoter,
browser-use, adp, integration-test-harness, plus a Prometheus/Grafana
monitoring stack), and a Docker Model Runner-hosted local LLM. AGENTS.md §2
explicitly pins PowerShell scripts to Windows + PS 5.1+; AGENTS.md §4 has
been updated in this branch to cover macOS/Linux worktree conventions
alongside the existing Windows ones. README.md:208 already lists "Mac &
Linux Installers" as a future feature.

This roadmap tees up **full installer-parity native support** for two new
platforms:

- **macOS Apple Silicon (arm64)** via Docker Desktop 4.40+ (keeps Docker
  Model Runner as the LLM source).
- **Linux (native Docker Engine, no Docker Desktop)** — no Docker Model
  Runner; LLM provided by an Ollama service inside compose.

**Out of scope:** Intel Mac, Windows on ARM, BSD/illumos, WSL2 without
Docker Desktop, Podman/containerd, rootless Docker, air-gapped Linux,
distros older than Ubuntu 22.04 / Fedora 39 / Debian 12.

**Why the observability stack exists (durable context):** the AI Coworker's
semantic memory subsystem (Qdrant-backed) was once completely non-functional
for an unknown period. No alert fired. No dashboard showed the failure. The
team discovered it by accident during unrelated testing. See
`docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`.
Anything in this roadmap that touches Prometheus, Grafana, or the discovery
sweep must preserve the post-incident invariants: silent failures of
critical infrastructure (databases, vector store, model runner, sandbox)
must produce alerts and dashboard signal.

## Chief architect amendment

This roadmap separates three contracts that must not be collapsed into one
installer:

1. **Developer setup** — clone, install dependencies, build locally, run
   tests.
2. **Release runtime** — versioned images, compose overlays, env schema,
   health checks.
3. **End-user installation** — host prerequisites, secrets, state,
   autostart, lifecycle.

The native installer must orchestrate a known release runtime. It must not
become a portable build system that compensates for missing multi-arch
images or unclear compose contracts.

## Already portable (do not redo)

Phase-1 exploration confirmed the following are already cross-platform:

- All third-party base images are multi-arch (`node:24-alpine`,
  `postgres:16-alpine`, `neo4j:5-community`, `qdrant/qdrant:latest`,
  `python:3.11-slim`); no `platform:` directives in `docker-compose.yml`.
- `docker-entrypoint.sh` runs inside the Linux container — platform-neutral.
  Line 162 already supports `LLM_BASE_URL` override, but is currently
  Model-Runner-flavored (Phase 4 below formalizes provider awareness).
- `Makefile`, `package.json` scripts (pure `pnpm --filter`), and all
  `apps/web` Docker shell-outs (`apps/web/lib/integrate/sandbox/sandbox.ts`,
  `apps/web/lib/mcp-tools.ts:1025-1162, 9420-9499`) are POSIX-clean.
- `packages/db/src/discovery-collectors/host.ts:31` already branches on
  `process.platform === "win32"` and falls through to `dpkg`/`rpm`.
- `apps/web/lib/integrate/codebase-tools.ts:47-71` blocks `^[A-Za-z]:` paths
  — harmless on Mac/Linux.
- `dpf-release.ps1` is pure git operations — direct port to bash.
- `.devcontainer/devcontainer.json` exists and is fully container-based.

## Cross-cutting decisions

> **Doctrine reference:** this roadmap wraps the canonical deployment
> contracts at
> `docs/superpowers/specs/2026-05-09-deployment-contracts.md`
> (release artifacts, runtime config, lifecycle, identity, edge,
> build execution, observability, secrets, LLM/agent-provider
> routing, and client/API surfaces).
>
> **Hierarchy on conflict:** this roadmap repeats selected doctrine
> contracts only where a phase implements them. If the roadmap and
> the doctrine ever appear to conflict, **the doctrine owns the
> contract; this roadmap owns sequencing.** Doctrine changes
> propagate to every wrapper, including this one; sequencing
> decisions stay local to the implementation phase that needs
> them. Anything universal across deployments belongs in the
> doctrine, not here — if you find yourself wanting to introduce a
> new universal rule via this roadmap, raise it as a doctrine
> amendment first.

### Deployment wrapper compatibility

The Linux installer is the canonical VM-shaped install surface. It
must remain usable by:

- bare-metal Linux installs,
- customer cloud VMs (Shape 1 of the cloud-deployment spec),
- TAPPaaS VM modules (packaging target wrapping Shape 1),
- future marketplace VM images.

Therefore `install-dpf.sh --headless` (Phase 6 below) must not
assume an interactive desktop environment, local-only DNS, or a
human prompt flow. Deployment wrappers may provision infrastructure,
secrets, ingress, and backups around the installer — they must not
fork the installer or runtime contract. This keeps TAPPaaS and cloud
VM from becoming separate installers.

- **Three distinct script contracts.** `scripts/setup.sh` = contributor
  bootstrap. `install-dpf.sh` = end-user release installer. `dpf-{start,
  stop,reinstall,release,uninstall}.sh` = lifecycle. They share helpers in
  `scripts/installer/lib/` but their inputs and outputs differ.
- **Compose layering as platform API.**
  - `docker-compose.yml` — shared developer/build baseline (has `build:`
    for custom services).
  - `docker-compose.release.yml` — image-based installed runtime; **no
    `build:` entries** for installed-runtime services.
  - `docker-compose.macos.yml` — Docker Desktop + Model Runner defaults.
  - `docker-compose.linux.yml` — Docker Engine + Ollama defaults; gates the
    `linux-monitoring` profile (cadvisor + node-exporter).
  - One helper, `scripts/installer/lib/compose.sh`, assembles the correct
    `-f` chain. **No scattered `docker compose -f ...` invocations** across
    installer, lifecycle scripts, VS Code tasks, docs, and CI.
- **LLM provider contract** (env vars, consumed everywhere LLM is used):
  - `DPF_LLM_PROVIDER=model-runner|ollama|external`
  - `LLM_BASE_URL=` (URL, no provider-specific default)
  - `LLM_MODEL=`, `EMBEDDING_MODEL=`, `BROWSER_USE_MODEL=`
  - `DPF_MODEL_PULL_MODE=auto|skip|verify-only`
  - The entrypoint must verify models, but must not call Model-Runner-only
    endpoints (`/models/create`) when `DPF_LLM_PROVIDER=ollama`.
- **Install state file** — `~/.dpf/install-state.json` with `platform`,
  `installPath`, `stateDir`, `composeFiles[]`, `imageTag`, `llmProvider`,
  `dockerEndpoint`, `autostart{enabled,kind}`, `lastHealthCheck`. All
  lifecycle scripts read this instead of redetecting platform reality.
- **Docker discovery** — prefer `docker context inspect` → `DOCKER_HOST` →
  known socket paths as fallback. Replaces socket-only guessing in
  `packages/db/src/discovery-collectors/docker.ts:6-9`.
- **VS Code tasks** — per-task `osx`/`linux` overrides in
  `.vscode/tasks.json`. Keeps the existing 16 Windows tasks untouched.
- **Shell target** — bash 3.2 baseline so the installer runs on stock
  macOS without `brew install bash`. `#!/usr/bin/env bash`, `shellcheck
  --shell=bash` in CI, no associative arrays / `mapfile` / `${var^^}`.
- **Install paths** — repo at `~/dpf/`, state at `~/.dpf/{logs,config}/`.
- **Auto-start** — LaunchAgent on macOS
  (`~/Library/LaunchAgents/local.dpf-autostart.plist`), systemd user unit
  on Linux (`~/.config/systemd/user/dpf.service` with `loginctl
  enable-linger`). Both unprivileged.
- **Monitoring scope.** The installer's Prometheus + Grafana stack
  monitors the DPF runtime (its own containers, databases, app metrics)
  **plus the local host exporter the discovery sweep depends on** — see
  the next decision. Onboarding *other* machines as managed nodes
  remains a separate platform feature ("Add a managed host" UX) and is
  out of scope for installer-parity work.
- **Network sweep data path.** The discovery sweep at
  `packages/db/src/discovery-collectors/network.ts` is load-bearing for
  network topology and writes to both Postgres (`InventoryEntity`,
  `InventoryRelationship`) and Neo4j (`InfraCI` nodes with OSI-layered
  relationships). Its data sources per platform:

  | Platform | Real-host NIC source | Confidence | Action |
  |---|---|---|---|
  | Windows | `windows_exporter` on host (port 9182) → Prometheus metric `windows_net_nic_address_info` | 0.95 | **Keep** `windows_exporter` install in `install-dpf.ps1`; **keep** `windows-host` scrape job. |
  | Linux | `node-exporter` (in `linux-monitoring` profile, container with `network_mode: host` or equivalent) → metric `node_network_info` | 0.95 | Already in compose; ensure `linux-monitoring` profile is on by default in `docker-compose.linux.yml`. |
  | macOS | None reachable from container — Docker Desktop's Linux VM hides Mac NICs | 0.70 (container-local fallback) | Document inherent limitation; sweep operates in degraded mode for the DPF host. See "Future direction" for the cleaner long-term architecture. |

  The sweep gracefully degrades if its preferred source is unavailable
  (3-second Prometheus timeout, then `os.networkInterfaces()`). It is
  acceptable for the macOS dev install to operate in degraded mode for
  *its own* host; managed *fleet* topology comes from the separate
  managed-fleet feature regardless of where DPF itself is installed.

## Phases (each = one PR)

### Phase 1 — Release artifact contract and multi-arch publishing
**Goal:** a release install can consume versioned multi-arch artifacts
without building any installed-runtime services locally.
**Files:**
- `.github/workflows/publish-image.yml` (lines 64-82 currently publish only
  `dpf-portal` and `dpf-sandbox`, single-arch). Add
  `docker/setup-qemu-action`, `docker/setup-buildx-action`, and
  `platforms: linux/amd64,linux/arm64` to every existing build step **and**
  add new build steps for any custom service classified as installed-runtime
  (see decision below).
- `docker-compose.release.yml` **(new)** — overrides `build:` with
  `image: ghcr.io/${GHCR_OWNER}/dpf-${SERVICE}:${DPF_IMAGE_TAG:-latest}` for every
  installed-runtime service.
- `.env.docker.example` — document `DPF_IMAGE_TAG`.
**Service classification (decided before Phase 1 starts, not inside the
PR):** classify each custom-built service as **installed-runtime** (must
publish multi-arch) or **developer/test-only** (stays `build:`-only):

| Service | Classification | Notes |
|---|---|---|
| `portal` | installed-runtime | Already published; multi-arch added in this phase |
| `portal-init` | installed-runtime via `portal` image | Shares the portal image (same Dockerfile target). Confirmed reusable. |
| `sandbox` | installed-runtime | Already published; multi-arch added |
| `sandbox-init` | installed-runtime via `portal` image | Same target as portal |
| `promoter` | installed-runtime, profile-only | `promote` profile; ships in release manifest but not started by default |
| `browser-use` | installed-runtime | UX verification path; user-facing |
| `adp` | installed-runtime | ADP MCP server; part of product runtime |
| `integration-test-harness` | developer/test-only | `integration-test` profile; not in release publish |

This decision lands as part of this phase's planning so the PR
that establishes artifact doctrine doesn't double as a service
taxonomy debate.

**Supply-chain attestation gates (in this phase, not deferred):**
the publish workflow must produce signed image artifacts with
SBOM and provenance attestations from day one. Per Docker's GHA
attestation docs (`docker/build-push-action`):

- `provenance: mode=max` on every build step.
- `sbom: true` on every build step.
- Image digests recorded in the release manifest for reproducibility.
- No secrets leaked through build args (Docker explicitly warns
  build args appear in provenance metadata).
- `docker-compose.release.yml` references images by tag for
  Preview / GA channels but supports digest-pinning
  (`@sha256:...`) for tested release manifests.

**Exit gates:**
  - `docker compose -f docker-compose.yml -f docker-compose.release.yml
    config` shows zero `build:` entries for installed-runtime services.
  - `docker buildx imagetools inspect ghcr.io/${GHCR_OWNER}/${IMAGE}:${TAG}` lists
    both `linux/amd64` and `linux/arm64` for every installed-runtime image.
  - `docker buildx imagetools inspect --raw ghcr.io/${GHCR_OWNER}/${IMAGE}:${TAG}`
    shows SBOM and provenance attestation manifests alongside each
    platform manifest.
  - Release notes for the publish workflow's first multi-arch tag
    record the digest for every installed-runtime image.

**Risk:** medium. Forces an explicit ownership decision per service
plus the supply-chain gates from day one rather than retrofitting
them under a security review later.

### Phase 2 — Platform preflight, AGENTS.md, contributor setup
**Goal:** a Mac/Linux contributor can clone and run the dev loop. **Not**
the end-user installer.
**Files:**
- `AGENTS.md` — §2 (line 23) extend to cover bash on macOS/Linux. (§4 line
  51 already updated in this branch.)
- `scripts/setup.sh` — full rewrite. Fix BSD `sed -i` portability bugs at
  lines 66/69/82/83 (use `sed -i.bak '...' file && rm file.bak`). Remove
  the dead `ollama` wait at lines 110-119 (no `ollama` service exists in
  base compose); the LLM is provider-aware via Phase 4. Stop assuming the
  `ollama` service exists.
- `scripts/installer/lib/{logging,prompts,platform}.sh` **(new)** — shared
  helpers for both `setup.sh` and `install-dpf.sh`.
- `.vscode/tasks.json` — add `osx` + `linux` overrides to all 16 tasks.
**Verify:** `bash scripts/setup.sh && make dev` succeeds on Apple Silicon
and on Ubuntu 22.04. "DPF: Type Check" task runs from VS Code on both.

### Phase 3 — Compose portability and platform overlays
**Goal:** `docker compose up` with the right overlay chain works on
macOS Docker Desktop and on native Linux Docker Engine.
**Files:**
- `docker-compose.yml` — replace promoter relative paths
  (`./backups`, `.:/host-source:ro` at lines 217-218) with
  `${DPF_HOST_INSTALL_PATH}` (already declared in `.env.docker.example:41`,
  unused). Add `extra_hosts: host.docker.internal:host-gateway` to sandbox,
  promoter, adp, prometheus (currently only on portal:128 and
  browser-use:252). Move cadvisor (lines 466-469) and node-exporter (lines
  478-481) behind `profiles: ["linux-monitoring"]` — their `/proc`, `/sys`,
  `/var/lib/docker`, `/` bind mounts cannot work on macOS.
- `docker-compose.macos.yml` **(new)** — Docker Desktop + Model Runner
  defaults. No host node_exporter integration (Docker Desktop VM boundary
  blocks it; sweep operates in degraded mode on macOS — see Future
  direction for the cleaner long-term path).
- `docker-compose.linux.yml` **(new)** — adds `ollama` service; opts in to
  the `linux-monitoring` profile by default. The `node-exporter` in that
  profile must run with `network_mode: host` (or equivalent) so the sweep
  sees the Linux host's real NICs via `node_network_info`.
- `monitoring/prometheus/prometheus.yml` — **keep** the `windows-host`
  scrape job. Reverses the prior amendment; the sweep needs it on
  Windows. (When the cleaner discovery-plane architecture in Future
  direction lands, the sweep moves off this scrape and the job retires
  cleanly.)
- `monitoring/prometheus/alerts.yml` (line 73) — comment unchanged; the
  `HostNetworkInterfaceDown` alert at line 74 uses `node_network_up`
  from the in-cluster node-exporter and continues to work.
- `install-dpf.ps1` lines 281-328 — **keep**. Reverses the prior
  amendment. `windows_exporter` install stays until the
  discovery-plane refactor in Future direction replaces it.
- `apps/web/components/monitoring/SystemHealthDashboard.tsx` line 158 —
  replace `href="http://localhost:3002"` with
  `href={process.env.NEXT_PUBLIC_GRAFANA_URL || "http://localhost:3002"}`
  so Mac/Linux Docker Desktop users with a non-default port or remote
  Grafana aren't broken.
- `scripts/installer/lib/compose.sh` **(new)** — single source of truth for
  the `-f` chain assembly. Used by installer, lifecycle scripts, and CI.
**Verify:** `docker compose -f docker-compose.yml -f docker-compose.release.yml
-f docker-compose.${DPF_PLATFORM}.yml config` exits 0; `up portal postgres
ollama|model-runner` then `curl localhost:3000/api/health` returns 200 on
both OSes.

### Phase 4 — LLM and model lifecycle hardening
**Goal:** consistent provider contract; entrypoint never calls
provider-specific endpoints for the wrong provider.
**Files:**
- `docker-entrypoint.sh` — replace lines 156-175 with a provider-aware
  block that branches on `DPF_LLM_PROVIDER` and `DPF_MODEL_PULL_MODE`. For
  `ollama`, POST to `/api/pull`. For `model-runner`, keep the existing
  `/models/create` POST. For `external`, only verify (`GET /v1/models`).
- `apps/web/lib/inference/ollama-url.ts` — already exists per Phase-1
  exploration; align with the new env var names.
- `packages/db/data/providers-registry.json` — drop hardcoded base URL;
  read from `LLM_BASE_URL`.
- `.env.docker.example` — add the full env var contract.
- `apps/web/lib/ai-inference.ts` — already supports `LLM_BASE_URL`
  override; verify model fields are present.
**Verify:** integration test `apps/web/__tests__/llm-provider.test.ts`
**(new)** asserts the entrypoint never POSTs to `/models/create` when
`DPF_LLM_PROVIDER=ollama`.

### Phase 5 — Host profile and platform discovery
**Goal:** `DPF_HOST_PROFILE` JSON populated correctly on macOS / Linux;
Docker discovery uses `docker context` first.
**Files:**
- `scripts/detect-hardware-host.ts` **(new)** — `os.platform()` dispatches
  to `sysctl hw.ncpu / hw.memsize`, `system_profiler SPDisplaysDataType`
  (macOS), or `/proc/cpuinfo`, `nproc`, `free -b`, `lspci`, `nvidia-smi`
  (Linux). Emits the same JSON shape that auto-model-selection consumes.
  Apple Silicon entries include `architecture: "unified"` so the unified
  memory model is honored by consumers.
- `scripts/detect-hardware.ts` (49 lines, `/proc/*` only) — unchanged;
  still consumes `DPF_HOST_PROFILE` env var.
- `packages/db/src/discovery-collectors/docker.ts` (lines 6-9) — replace
  socket-only check with `docker context inspect` → `DOCKER_HOST` → socket
  fallback chain.
- `packages/db/src/discovery-collectors/host.ts` (line 31) — add `darwin`
  branch using `pkgutil --pkgs` + `brew list` (the existing `dpkg`/`rpm`
  fallback already handles Linux).
- `apps/web/lib/agent-grants.ts` and provider-selection paths — accept
  unified-memory architecture without breaking discrete-VRAM selection on
  Windows.
**Verify:** `pnpm exec tsx scripts/detect-hardware-host.ts` prints valid
JSON with `architecture: "unified"` on Apple Silicon and `architecture:
"discrete"` on Linux+NVIDIA. `PlatformConfig` row populated after first
boot.

### Phase 6 — Installer framework vertical slice
**Goal:** `install-dpf.sh` skeleton ready for platform-specific phases —
preflight, logging, state, dry-run, idempotency, **a minimal `dpf doctor`
diagnostic surface**, and explicit unsupported-host detection. **No**
Docker Engine install or autostart yet.
**Files:**
- `install-dpf.sh` **(new)** — phases 1, 5, 7, 8 from `install-dpf.ps1`
  (platform check, install mode selection, env generation, compose up).
  Mac/Linux platform branch via `case "$(uname -s)"`.
- `scripts/installer/lib/{docker,model,paths,state,doctor,preflight}.sh`
  **(new)** — module helpers. `state.sh` reads/writes
  `~/.dpf/install-state.json`. `doctor.sh` implements the minimum
  `dpf doctor` (see below). `preflight.sh` implements the unsupported-host
  detector (see below).
- `scripts/installer/install-state.schema.json` **(new)** — JSON schema for
  the install state file. Schema includes a versioning + migration
  contract (see below).
- `--dry-run` flag — prints the planned compose chain, env file, and state
  file diffs without touching the host.
- `--headless` flag — non-interactive; required for CI.

**Install-state schema (with versioning + migration):**

```json
{
  "schemaVersion": 1,
  "installerVersion": "2026.05.09",
  "lastSuccessfulInstallVersion": null,
  "lastSuccessfulComposeHash": null,
  "composeProjectName": "dpf",
  "platform": "darwin",
  "arch": "arm64",
  "dockerContext": "desktop-linux",
  "dockerEndpoint": "unix:///Users/me/.docker/run/docker.sock",
  "installPath": "/Users/me/dpf",
  "stateDir": "/Users/me/.dpf",
  "composeFiles": ["docker-compose.yml", "docker-compose.release.yml", "docker-compose.macos.yml"],
  "imageTag": "v0.42.0",
  "llmProvider": "model-runner",
  "resourceLabels": { "dpf": "true" },
  "autostart": { "enabled": true, "kind": "launchagent" },
  "lastHealthCheck": "2026-05-09T12:00:00Z",
  "lastBackupAt": null,
  "lastDoctorBundlePath": null
}
```

`schemaVersion` is required; lifecycle scripts (`dpf-{start,stop,reinstall,
release}.sh`) must run a forward migration when they encounter an older
schema version (or refuse to operate and direct the operator to
re-run the installer). Reinstall scripts treat missing or corrupt
state as a fresh install with explicit confirmation. **No spelunking
through stale JSON in shell heuristics; the schema is the contract.**

**Minimum `dpf doctor` (delivered in this phase, not deferred to
Phase 10):**

`bash install-dpf.sh doctor` (and the standalone `scripts/dpf-doctor.sh`)
emits a diagnostic bundle covering:

- Host OS and architecture (`uname -s -m`, `sw_vers -productVersion` /
  `lsb_release -rs`)
- Docker version (`docker version`), Docker context (`docker context inspect`)
- Docker Desktop version on macOS (when applicable)
- Compose file chain (the actual `-f` list assembled by `compose.sh`)
- Rendered compose hash (`docker compose ... config | sha256sum`)
- `~/.dpf/install-state.json` contents (redacted of secrets)
- Per-container status (`docker compose ps`)
- Last 200 lines of core service logs (portal, postgres, neo4j, qdrant)
- Port-conflict scan for the platform's published ports
- LLM provider reachability check (`curl ${LLM_BASE_URL}/v1/models`)
- Redacted env / config summary

Output: a tarball at `~/.dpf/doctor-<timestamp>.tar.gz` for support
reports plus a human-readable summary printed to stdout. **Every
failed install will need this; the long-tail Phase 10 hardening
extends `dpf doctor`, but Phase 6 ships the minimum so early
macOS / Linux installs don't write bug reports in fog.**

**Unsupported-host preflight (delivered in this phase):**

The installer must detect known-unsupported hosts during preflight
and refuse to proceed with a crisp reason rather than failing
opaquely later. Detected scenarios (each a clear exit code +
message):

- Intel Mac (`uname -m` reports `x86_64` on Darwin) — out of scope
  per this roadmap; suggest the Windows installer or running inside
  a Linux VM.
- Windows on ARM — out of scope.
- WSL2 without Docker Desktop — refuse; suggest installing Docker
  Desktop.
- Rootless Docker (`docker info` shows `rootless` security option) —
  refuse; explain `host-gateway` and selected-profile host-network
  semantics aren't supported in rootless mode.
- Podman / containerd masquerading as Docker (`docker --version`
  reports a non-Docker engine) — refuse; suggest standard Docker
  Engine.
- Linux distros older than the supported floor (Ubuntu 22.04 /
  Fedora 39 / Debian 12) — warn and offer `--force-unsupported-host`
  override for advanced users.
- Air-gapped Linux (no outbound network during preflight) — warn,
  suggest the upcoming air-gapped install path.

Each refusal prints a `Reason:` and a `Next:` line so the operator
knows what to do.

**Verify:** `bash install-dpf.sh --dry-run` on Mac and Linux prints the
expected plan. `bash install-dpf.sh --headless` on a host with Docker
already installed brings the stack up using release images.
`bash install-dpf.sh doctor` produces a bundle on a deliberately
broken install (e.g., portal container down). `install-dpf.sh` on
each unsupported scenario above exits non-zero with the expected
message.

### Phase 7 — Full native installer and autostart
**Goal:** `install-dpf.sh` from a fresh host (no Docker, no Homebrew
required, no manual prerequisites beyond Xcode CLT on macOS) to a
running portal.
**Files:**
- `install-dpf.sh` — add platform-specific phases:
  - Phase 3 macOS: detect existing Docker Desktop via
    `mdfind 'kMDItemCFBundleIdentifier=="com.docker.docker"'`. **If
    not installed, fetch the Docker Desktop `.dmg` directly from
    Docker's official download URL (resolved via `curl -fsSL` against
    `https://desktop.docker.com/...`), mount it via `hdiutil attach`,
    copy `Docker.app` into `/Applications` via `cp -R`, eject via
    `hdiutil detach`, then start the app via `open -a Docker`.** No
    Homebrew dependency. **The installer does not bootstrap Homebrew
    itself.** If the customer wants Homebrew, that's their package
    manager choice; if a customer already has Homebrew, the installer
    detects `brew --prefix Docker` as an additional path before
    falling through to the .dmg flow. If permissions block the
    `/Applications` copy (e.g. corporate MDM), the installer prints
    a manual-install instruction and exits with a clear "Next:" line.
  - Phase 3 Linux: distro package manager
    (`apt-get install docker-ce docker-buildx-plugin docker-compose-plugin`,
    or dnf equivalent), `systemctl enable --now docker`, add `$USER` to
    `docker` group. **No magical `newgrp docker`** — installer reports
    "log out and back in (or run `newgrp docker`) before continuing"
    explicitly. Refuse Docker `< 20.10` (required for `host-gateway`).
  - Phase 9: provider-aware model pull (Ollama on Linux via
    `curl -X POST localhost:11434/api/pull`; `docker model pull` on macOS).
  - Phase 10: install LaunchAgent (macOS) / systemd user unit (Linux).
- `scripts/installer/macos-launchagent.plist.tmpl` **(new)**.
- `scripts/installer/linux-systemd.service.tmpl` **(new)**.
- `uninstall-dpf.sh` **(new)** — must require `--purge` for destructive
  resource removal; only removes resources labeled `dpf=true`.
**Verify:** **fresh-Mac-from-zero** (clean macOS 14 VM with Xcode
CLT only — no Docker, no Homebrew → `bash install-dpf.sh` →
`http://localhost:3000/api/health` returns 200). **Fresh-Linux**
(clean Ubuntu 22.04, cloud-init only → same flow → portal
reachable). **Reboot** → portal back up via auto-start. The
"no Homebrew" branch of the macOS verification is mandatory — that's
the contract the previous draft accidentally broke by listing brew
as a fallback on a host that explicitly has no brew.

### Phase 8 — Lifecycle scripts
**Goal:** start/stop/reinstall/release siblings, all reading
`install-state.json`.
**Files:** `dpf-start.sh`, `dpf-stop.sh`, `dpf-reinstall.sh`,
`dpf-release.sh`, plus copies in `scripts/`. `dpf-reinstall.sh` replaces
the PS script's hardcoded `${drive}:\docker-data\dpf` (lines 186-195) with
`docker volume rm $(docker volume ls -q --filter label=dpf=true)` — drops
Windows drive-letter assumptions. Destructive resets require `--purge`.
**Verify:** `dpf-stop.sh && dpf-start.sh` round-trips clean on both
platforms; `dpf-reinstall.sh --purge` wipes only DPF-labeled resources.

### Phase 9 — Docs, CI, release gates
**Goal:** documentation reflects the canonical contracts; CI proves
the installed runtime works on Apple Silicon and Linux.
**Files:**
- `README.md` (line 208) — split into Developer Setup vs End-user Install
  sections; add Mac and Linux flows.
- `docs/install/{macos,linux}.md` **(new)**.
- `CONTRIBUTING.md` — distinguish contributor bootstrap from end-user
  install.
- `.github/workflows/ci.yml` — add jobs:
  - **`compose-render`**: for every supported `-f` chain combination,
    run `docker compose ... config` and **upload the rendered output
    as a CI artifact**. Enforce policy checks on the rendered output:
    - installed-runtime services have `image:` and zero `build:`
      entries (per Phase 1).
    - macOS rendered config has no `/proc`, `/sys`,
      `/var/lib/docker`, or rootfs bind mounts.
    - Linux `linux-monitoring` profile rendered config includes
      `node-exporter` with the expected host networking.
    - Release config has no developer/test-only services unless an
      explicit profile is enabled.
    - All compose-managed resources carry the `dpf=true` label.
    - Every published port is declared in the deployment support
      matrix (Doctrine).
    - **Core runtime services are not hidden behind a profile** —
      Docker Compose's documented recommendation. Profiles are for
      debug / test / monitoring surfaces only.
    Policy violations fail the job; rendered artifacts are kept on
    failed runs for diagnostic review.
  - **`linux-smoke-install`**: `runs-on: ubuntu-22.04`, runs
    `install-dpf.sh --headless`, hits `/api/health`.
  - **`apple-silicon-release-gate`**: `runs-on: macos-14`. Asserts
    arm64 by failing the job early if the runner isn't:
    `test "$(uname -m)" = "arm64"`. Then runs `docker version`,
    `docker compose version`, and the same `install-dpf.sh
    --headless` smoke. **Real release gate**, not implied by generic
    macOS checks. The `uname` assertion turns the documentation
    assumption ("macos-14 is arm64") into a failing CI check; if
    GitHub renames or reclassifies the runner, this catches it.
  - `shellcheck`: every `.sh` file (`shellcheck --shell=bash` per
    the cross-cutting decision; bash 3.2 baseline).
  - `image-manifests`: `docker buildx imagetools inspect` on every
    installed-runtime image post-publish, asserts both architectures
    present **and** that SBOM and provenance attestations exist (per
    Phase 1's supply-chain gates).

### Phase 10 — Hardening and long-tail discovery
**Goal:** close gaps surfaced by Phases 7-9.
**Files:**
- `apps/web/lib/integrate/codebase-tools.ts` (lines 47-71) — unit test
  that POSIX absolute paths are not falsely blocked by the `^[A-Za-z]:`
  guard.
- `install-dpf.sh` — port conflict detection (3000, 5432, 7474, 7687,
  6333, 8500, 8600, 11434).
- `scripts/installer/lib/diagnostics.sh` **(new)** — `dpf doctor` command
  that bundles compose state, container logs, and `install-state.json`
  for support reports.
- Backup/restore for `pgdata`, `neo4jdata`, `qdrant_data` named volumes —
  pre-`--purge` snapshot.
- Sanity-check argument quoting in
  `apps/web/lib/integrate/sandbox/sandbox.ts` and
  `apps/web/lib/mcp-tools.ts` under bash.

## Risk register

| Risk | Mitigation |
|---|---|
| **Release artifact drift** — installed-runtime images not all published, installer silently falls back to local builds | Phase 1 must publish every installed-runtime custom image multi-arch, or explicitly mark non-release. CI `image-manifests` job in Phase 9 enforces. |
| **Installer sprawl** — multiple scripts re-detecting platform reality differently | Shared shell libraries in `scripts/installer/lib/` plus `~/.dpf/install-state.json` as single source of truth. |
| **Model provider mismatch** — entrypoint calls Model-Runner endpoints when provider is Ollama, or vice versa | Phase 4 makes the entrypoint provider-aware; `DPF_MODEL_PULL_MODE=verify-only` for external providers. Integration test asserts no cross-provider calls. |
| **Docker group permissions on Linux** — installer assumes magical `newgrp` works | Honest flow: report "log out and back in (or run `newgrp docker`)" then exit and require re-run. No `newgrp` dependency unless tested on Ubuntu 22.04 + Fedora 39 + Debian 12. |
| **CI false confidence** — generic macOS check passes on Intel runners but fails on Apple Silicon | Phase 9 `apple-silicon-release-gate` is explicit on `macos-14` (arm64). Treated as release gate, not advisory. |
| **Monitoring bind-mount breakage** — cadvisor / node-exporter assume Linux host paths | Phase 3 moves both behind `linux-monitoring` profile; Linux overlay opts in, macOS overlay omits. Prometheus config generated, not committed with hardcoded targets. |
| **Apple Silicon + Chromium in `services/browser-use`** — Python+Chromium image | Phase 1 verifies arm64 build during multi-arch publish. If broken, add `--platform linux/amd64` for that one service (Rosetta perf hit acknowledged). |
| **Sandbox `bubblewrap` on Apple Silicon** — `Dockerfile.sandbox:3` adds `bubblewrap` | Alpine ships arm64. Codex's `sandbox_mode="danger-full-access"` (Dockerfile.sandbox:21) already disables bubblewrap at runtime, but install must still succeed. |
| **macOS Gatekeeper / quarantine on LaunchAgent plist** | Phase 7 verification on a fresh Gatekeeper-enabled machine; installer strips `com.apple.quarantine` xattr if present. |
| **Monitoring scope creep** — well-meaning future PR re-adds host-exporter auto-install logic to `install-dpf.{ps1,sh}` because "we used to have it on Windows" | Phase 3 commit message + this plan's monitoring-scope decision are the durable record. The alerts.yml comment update points to the managed-fleet feature for anyone who notices the gap. |
| **Sweep regression** — a future PR removes `windows_exporter` install or the `windows-host` scrape job without realizing the network sweep depends on its metrics for accurate Windows-host topology | The "Network sweep data path" cross-cutting decision documents the per-platform contract. Anyone proposing to remove the scrape must first refactor the sweep onto the discovery-plane architecture in Future direction. |
| **Grafana URL hardcoded in portal frontend** — `apps/web/components/monitoring/SystemHealthDashboard.tsx:158` ships `http://localhost:3002` so non-default Docker Desktop port mappings or remote Grafana break the link-out | Phase 3 file edit makes it env-var-driven. |

## Critical files referenced

- `/home/user/opendigitalproductfactory/install-dpf.ps1` (1,329 lines —
  primary source for phase mapping)
- `/home/user/opendigitalproductfactory/docker-compose.yml` (550 lines —
  Phases 1, 3)
- `/home/user/opendigitalproductfactory/docker-entrypoint.sh:155-175`
  (Phase 4)
- `/home/user/opendigitalproductfactory/scripts/setup.sh` (Phase 2
  rewrite)
- `/home/user/opendigitalproductfactory/scripts/detect-hardware.ts`
  (Phase 5 pair)
- `/home/user/opendigitalproductfactory/.vscode/tasks.json` (Phase 2)
- `/home/user/opendigitalproductfactory/.github/workflows/publish-image.yml`
  (Phase 1)
- `/home/user/opendigitalproductfactory/AGENTS.md` §2/§4 (Phase 2; §4
  already updated in this branch)
- `/home/user/opendigitalproductfactory/packages/db/src/discovery-collectors/{docker,host}.ts`
  (Phase 5)

## Future direction (out of scope for this roadmap)

These are noted so follow-up plans don't accidentally reverse the
decisions in this one, and so the cleaner architecture is captured
while the context is fresh.

- **SDN reduction** — long-term simplification of DPF's own software-
  defined network footprint. Fewer custom services, fewer compose
  overlays per service, fewer extra_hosts entries. Any new compose
  service introduced by this roadmap should justify itself against this
  direction.

### Discovery plane refactor (replaces the host-exporter pattern)

> **Canonical location for this epic:**
> `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
> (DRAFT). The summary below is preserved for context; further design
> work happens in that spec, not here.
>
> **Scope evolved:** what started as a narrow "discovery agent" has
> been reframed as a broader **DPF Edge Node** — a host-resident
> trust and connectivity component with modular capabilities
> (network discovery first, then host metrics, MCP/A2A gatewaying,
> identity/device attestation, private-link tunneling, managed-fleet
> onboarding). Identity authority remains in the DPF core
> (per `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`);
> Edge Nodes are least-privilege participants. Discovery is the
> first capability slice, not the whole product.

The current pattern — install `windows_exporter` as a Windows service,
scrape it from a container, parse `windows_net_nic_address_info` to
recover the host's real NICs — is fragile (MSI install can fail,
firewall holes, port collisions) and OS-specific. A cleaner architecture
exists, but its constraints are physical:

**Hard constraint:** on macOS and Windows with Docker Desktop, the
container fleet runs inside a Linux VM. **No software configuration
exposes the Mac/Windows host's physical NICs to a container** — there
is no Docker network driver, CNI plugin, or "magic IP" that pierces the
Docker Desktop VM boundary. macvlan/ipvlan/network_mode-host all operate
inside the VM. This is a Docker Desktop architectural limit, not a
configuration gap.

Given that constraint, the elegant cross-platform answer is a
**three-mode discovery plane** that produces identical data into the
existing `InventoryEntity` / `InventoryRelationship` / `InfraCI` schema:

**Mode A — Linux container with `network_mode: host` (default for Linux
installs).** A new `discovery-agent` service in `docker-compose.linux.yml`
that ships with `nmap`, `arp-scan`, `lldpd`, and the sweep code. Joins
the host network namespace directly — gets a real LAN IP, sees real
NICs, walks the real ARP table. Replaces the round-trip through
Prometheus + node_exporter for the sweep's purposes. macvlan is the
alternative if multi-tenancy or static IP per agent is needed; for a
single sweep agent, `network_mode: host` is simpler.

**Mode B — Native helper binary (for Mac/Windows hosts that need
accurate local-host topology).** A small statically-linked Go or Rust
binary (~5 MB), bundled with the installer (no separate MSI download).
Installs as a LaunchAgent on macOS / scheduled task or service on
Windows, using the same auto-start mechanism the installer already
configures for the platform itself. Runs the same scan logic as Mode A
and POSTs results to the existing `/api/v1/discovery/sweep` endpoint
using an MCP bearer token. Downstream consumers unchanged. **This is
also the same code path the eventual "Add a managed host" feature
needs** — the DPF host is just the first managed node onboarded by the
binary.

**Mode C — In-VM container (Mac/Windows fallback when Mode B not
installed).** Same `discovery-agent` service running inside Docker
Desktop's Linux VM. Sees the VM's network, not the Mac/Windows host's
physical NICs. Sweep flags affected `DiscoveredItem` rows with reduced
`confidence`. Acceptable for dev installs that don't care about
host-LAN topology.

**Why this beats the current pattern:**
- One sweep implementation, three deployment modes — no per-OS
  collector branches in TypeScript.
- The native helper binary (Mode B) is dramatically lighter than
  `windows_exporter` (~5 MB vs ~30 MB MSI), uses the platform's
  existing API surface, and inherits the platform's auth model.
- Mode B is reusable as the foundation for managed-fleet
  observability — every managed host gets the same binary.
- Honest about the Docker Desktop VM boundary on Mac/Windows; provides
  a real escape hatch (Mode B) instead of pretending containers can
  reach the host's NICs.
- `windows_exporter` and the `windows-host` scrape job retire cleanly
  once Mode B is shipped, removing the moving piece this plan currently
  has to keep.

**Sequencing:** the discovery plane refactor is its own epic, ordered
after this roadmap's Phase 7 (full installer ships). Until it lands,
the sweep keeps its current data path on Windows (`windows_exporter`)
and Linux (`node-exporter` in `linux-monitoring` profile). Mac sweep
operates in degraded Mode-C semantics by default.

**Open questions for that future epic:**
- Distribution: ship Mode B's binary inside the GHCR-published portal
  image and have the installer extract it on first run, or publish
  separately as a GitHub Release asset?
- Auth: re-use existing MCP `dpfmcp_*` tokens (Admin > Platform
  Development), or introduce a narrower `dpfagent_*` scope?
- Update path: how does Mode B self-update when the platform upgrades?
- Telemetry parity: what subset of `windows_exporter` /
  `node_exporter` metrics, if any, need to keep flowing for Grafana
  host-resource panels independent of the sweep?

### Managed-fleet observability

A portal feature ("Add a managed host") that deploys Mode B above to
any host being onboarded as a managed node. The DPF host itself becomes
one such node, treated the same way as any other. This is the umbrella
under which the discovery plane refactor naturally lands.

### Customer-cloud deployment

> **Canonical location for this epic:**
> `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
> (DRAFT). Depends on Edge Node spec landing first.

The Edge Node split makes deploying DPF on a customer's own AWS / GCP
/ Azure account a deployment-template exercise rather than a product
fork: Authority Core no longer needs LAN proximity to the managed
estate, so it can run on managed container services / managed
databases anywhere, while Edge Nodes phone in over standard outbound
HTTPS. **DPF stays single-tenant** — each customer runs their own
instance on their own resources; no SaaS multi-tenancy is introduced.
The Linux installer from this roadmap (Phase 6's `--headless` flag in
particular) becomes the bootstrap step inside Terraform / Helm
templates rather than being replaced.

## End-to-end verification (after Phase 9)

1. **Fresh Apple Silicon Mac**: clean macOS 14 VM → install Xcode CLT →
   `bash <(curl ... install-dpf.sh)` → `http://localhost:3000/api/health`
   returns 200 → log in with admin credentials → run a Build Studio task →
   reboot → portal back up within 60s via LaunchAgent.
2. **Fresh Linux box**: clean Ubuntu 22.04 → `bash install-dpf.sh` → user
   added to docker group (with explicit logout/login prompt) → portal
   reachable → Ollama-served model responds → `dpf-stop.sh && dpf-start.sh`
   round-trips clean → systemd user unit survives reboot.
3. **Existing Windows install**: `install-dpf.ps1` continues to work
   unchanged. CI matrix proves no regression.
