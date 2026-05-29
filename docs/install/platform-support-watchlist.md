# Platform Support Watch-List (living document)

A running tally of **platform-specific gotchas** to watch for when supporting
DPF's target environments. This is the operational companion to the canonical
design docs — it tracks *symptoms and recurring traps*, not contracts:

- **Authoritative contracts:** [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../superpowers/specs/2026-05-09-deployment-contracts.md) (the 10 deployment contracts).
- **Implementation history:** [`docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`](../superpowers/plans/2026-05-09-macos-linux-native-support.md) (the shipped macOS/Linux roadmap).
- **Verification:** [`docs/install/verification-runbook.md`](verification-runbook.md).

If a rule is *universal* across deployments, it belongs in the deployment
contracts, not here. This file is for "when you touch X on platform Y, watch
out for Z."

## Target environments

| Environment | Status | LLM provider | Host telemetry exporter | Autostart |
|---|---|---|---|---|
| **Windows 10/11** (Docker Desktop) | GA | Docker Model Runner | `windows_exporter` on host (`windows-host` job, :9182) | Scheduled Task |
| **macOS** (Apple Silicon, Docker Desktop 4.40+) | Early access | Docker Model Runner | none (Docker Desktop VM hides host NICs) | LaunchAgent |
| **Linux** (native Docker Engine) | Early access | Ollama (in-compose) | `node-exporter` (`linux-monitoring` profile) | systemd user unit |
| **Cloud VM / TAPPaaS / Edge Node** | Spec-only ("design partner wanted") | per deployment | per deployment | per deployment |

Out of scope (preflight refuses): Intel Mac, Windows-on-ARM, WSL2 without Docker
Desktop, rootless Docker, Podman/containerd, distros older than Ubuntu 22.04 /
Fedora 39 / Debian 12, air-gapped Linux.

## How to use this file

- **Before** adding a host-specific service, scrape target, bind mount, shell
  command, or hardcoded URL/port, scan the relevant section below.
- **When** you fix a new platform-specific defect, add a row. Each PR that
  closes a watch-list item should flip its status here in the same change.
- Status legend: ✅ fixed · ⚠️ open · 📌 by-design (accepted limitation, documented so it isn't "re-fixed").

---

## 1. Monitoring & telemetry

| # | Symptom | Platforms | Root cause | Status | Watch for |
|---|---|---|---|---|---|
| M1 | Platform Health shows **CRITICAL ContainerDown / windows-host** | macOS, Linux | Base `prometheus.yml` scrapes the Windows-only `windows_exporter` (`host.docker.internal:9182`), which can never come up off-Windows → `ContainerDown` fires. | ✅ `prometheus.macos.yml` + `prometheus.linux.yml` drop the job; base keeps it for Windows. Locked by `apps/web/components/monitoring/prometheus-config.test.ts`. | Any new host-OS-specific scrape target must be gated to the substrate whose overlay mounts it — never the shared base config. |
| M2 | Monitoring summary reads **"Degraded — Host telemetry is not available"** on macOS | macOS | `deriveMonitoringSummary` ([`health-summary.ts`](../../apps/web/components/monitoring/health-summary.ts)) treats host telemetry as required (`windows-host==1 \|\| node-exporter==1`); macOS intentionally ships neither. | ⚠️ open | A clean fix distinguishes *absent* (job not configured → not-applicable on this platform) from *down* (job configured but `up==0` → degraded). Needs platform-awareness in the UI; verify against the running app. |
| M3 | Grafana "Open dashboard" link goes to a dead URL on non-default / remote Grafana | all (esp. macOS/Linux remote) | `SystemHealthDashboard.tsx:160` hardcodes `href="http://localhost:3002"`. Roadmap Phase 3 claimed this was fixed; it was not. | ⚠️ open | One-line fix: `href={process.env.NEXT_PUBLIC_GRAFANA_URL \|\| "http://localhost:3002"}`. Touches `.tsx` → run `next build`. |
| M4 | cadvisor / node-exporter crash-loop or refuse to start on macOS | macOS | They bind-mount `/proc`, `/sys`, `/var/lib/docker`, and rootfs `/`, which don't exist / aren't usable in the Docker Desktop Linux VM. | 📌 Gated behind the `linux-monitoring` profile; only `docker-compose.linux.yml` opts in. | Don't add host-path bind mounts to any service started by the macOS or Windows overlay. CI `compose-render` asserts no `/proc`,`/sys`,`/var/lib/docker` mounts in the macOS rendered config. |

**Sweep landmine (do not trip):** the discovery network sweep
([`packages/db/src/discovery-collectors/network.ts`](../../packages/db/src/discovery-collectors/network.ts))
depends on `windows_net_nic_address_info` (Windows) or `node_network_info`
(Linux node-exporter) to enumerate real host NICs. **The `windows-host` scrape
must stay in the base `prometheus.yml` for Windows.** Removing host exporters on
macOS/Linux is safe *only because* the sweep already degrades to
`os.networkInterfaces()` there (Docker Desktop VM boundary hides Mac/Windows
host NICs regardless). See the "Network sweep data path" decision in the
roadmap before touching any host exporter.

## 2. Shell scripts (BSD vs GNU coreutils)

macOS ships BSD userland; Linux ships GNU. The installer targets **bash 3.2**
(stock macOS) — no associative arrays, `mapfile`, or `${var^^}`.

| # | Trap | Platforms | Status | Watch for |
|---|---|---|---|---|
| S1 | `sed -i` differs (BSD requires a backup-suffix arg) | macOS | ✅ Use `dpf_sed_inplace()` in [`scripts/installer/lib/platform.sh`](../../scripts/installer/lib/platform.sh) — never raw `sed -i`. | New scripts calling `sed -i` directly. |
| S2 | `netstat -anP tcp` (`-P` is GNU-only) | macOS | 📌 Works today only because `preflight.sh` tries `lsof` → `ss` → `netstat` and macOS always has `lsof`. | Don't reorder the fallback chain or hardcode `netstat -anP`. |
| S3 | `readlink -f`, `stat -c`, `date -d`, `find -printf`, `grep -P` | macOS | ⚠️ watch | These GNU-isms have no BSD equivalent. Prefer POSIX forms; `shellcheck --shell=bash` runs in CI. |

## 3. Docker / Compose

| # | Trap | Platforms | Status | Watch for |
|---|---|---|---|---|
| D1 | Container cannot see the Mac/Windows host's physical NICs | macOS, Windows (Docker Desktop) | 📌 Architectural limit of the Docker Desktop Linux VM — no `network_mode: host` / macvlan / CNI pierces it. | Don't promise host-LAN topology from in-VM containers on Docker Desktop. The Edge Node "Mode B" native helper is the long-term answer (see roadmap "Future direction"). |
| D2 | `host.docker.internal` unresolved | Linux native Docker | ✅ `extra_hosts: ["host.docker.internal:host-gateway"]` added to host-reaching services. | Add the `host-gateway` entry to any new service that must reach the host on native Linux; it's harmless on Docker Desktop. |
| D3 | Wrong LLM provider endpoint called | Linux (Ollama) vs macOS/Windows (Model Runner) | 📌 `docker-compose.linux.yml` overrides `LLM_BASE_URL` to the in-compose `ollama` service; entrypoint is provider-aware (`DPF_LLM_PROVIDER`). | Don't call Model-Runner-only endpoints (`/models/create`) when provider is `ollama`. |
| D4 | Core runtime service hidden behind a profile | all | 📌 Profiles are for debug/test/monitoring only; core services must start by default. | CI `compose-render` enforces this. |

## 4. Git / repo hygiene

| # | Trap | Platforms | Status | Watch for |
|---|---|---|---|---|
| G1 | `git checkout`/`worktree add` fails with **"remote end hung up unexpectedly"** | macOS/Linux contributor without git-lfs | ⚠️ The repo declares LFS (`.gitattributes`) but the LFS hook fails when the `git-lfs` CLI isn't installed. | Contributors: `brew install git-lfs && git lfs install`. To unblock a single op: `GIT_LFS_SKIP_SMUDGE=1 git -c core.hooksPath=/dev/null <cmd>`. Belongs in CONTRIBUTING.md. |
| G2 | CRLF line endings break shell scripts in Linux containers | Windows authors | 📌 `.gitattributes` enforces `eol=lf` on `*.sh` and `docker-entrypoint.sh`. | Don't add `.sh` without LF enforcement. |
| G3 | Multiple agent sessions sharing one working tree → branch/HEAD collisions, files swept into the wrong commit | all | ⚠️ recurring | One session = one git worktree (AGENTS.md §4). Verify `git worktree list` and your current branch before committing when other sessions may be active. |

---

## Recurring meta-pattern

Most entries above share one root: **a Windows-first assumption baked into a
shared/base artifact, inherited unchanged by macOS/Linux.** When adding anything
host-coupled (a scrape target, a service, a bind mount, a host path, a default
URL/port, a shell builtin), ask: *"does this assume Windows/GNU/Docker-Desktop,
and which substrate overlay should own it?"* Put substrate-specific deltas in
the owning overlay (`docker-compose.{macos,linux}.yml`, `prometheus.{macos,linux}.yml`),
never in the shared base.
