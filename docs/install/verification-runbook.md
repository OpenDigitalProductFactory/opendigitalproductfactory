# DPF Install Verification Runbook

> **For early adopters with hardware in hand.** The CI gates in
> `.github/workflows/release-gates.yml` and `install-verification.yml`
> cover what GitHub-hosted runners can run. **This runbook covers
> everything CI can't reach** — and you're the person who can close
> those gaps.
>
> macOS Apple Silicon is **GA** — validated end-to-end on real
> hardware. The Linux and cloud installers are code-complete and
> statically CI-green and graduate to GA when the community sends us
> verification reports from real hardware. Reports still widen the
> tested matrix on every platform, including additional Mac models /
> macOS versions. If you have an Apple Silicon Mac, a non-Ubuntu Linux
> box, a TAPPaaS environment, or a cloud VM you can spare for an hour,
> **please pick a section below and run through it.** Both happy-path
> and failure reports are valuable.
>
> **How to report:** open an issue using the
> [Install verification report template](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md)
> (it pre-fills the title prefix `Install verification — ` and the
> `install-verification` label). Paste your environment fingerprint,
> tick the checklist items you observed, and attach the doctor bundle
> (`bash install-dpf.sh doctor` → `~/.dpf/doctor-<timestamp>.tar.gz`).
> Secrets are redacted automatically.
>
> We don't need every checkbox before reading your report —
> partial reports are useful too.

## Verification matrix

| Path | What CI proves | What this runbook covers | Status |
|------|----------------|--------------------------|--------|
| Repository unit tests | `.github/workflows/ci.yml` runs `pnpm test` with an ephemeral Postgres service and `prisma migrate deploy` before the package tests | Local package-specific repros when a test is tied to host Docker state, platform credentials, or a dirty install | 🧪 **CI informational until issue #104 is drained** |
| Windows installer | n/a (no CI gate today) | One-command wrapper now available (`verify-install-windows.ps1`); community reports wanted | ✓ verified — formal reports now enabled |
| Linux end-to-end install | `install-verification.yml` (ubuntu-latest, dev + release modes) — full compose up, `/api/health=200`, doctor bundle | Distro coverage beyond Ubuntu: Debian 12, Fedora 39. Autostart-after-reboot. | 🙋 **reports wanted** |
| macOS end-to-end install | dry-run only (`macos-14` can't nest-virt Docker Desktop) | The actual `.dmg` install + Docker Desktop boot + portal up + LaunchAgent reboot survival | 🙋 **reports wanted** |
| Discovery collectors (darwin) | unit tests with mocked deps | Real `pkgutil --pkgs` / `brew list` enumeration emits sensible discovery items | 🙋 **reports wanted** |
| Observability stack | compose-render only | Prometheus actually scrapes metrics; Grafana dashboards populate; `linux-monitoring` profile cAdvisor / node-exporter on real Linux | 🙋 **reports wanted** |
| LLM provider — Docker Model Runner | dry-run | Real Model Runner serves chat completions to portal | 🙋 **reports wanted** |
| LLM provider — Ollama (Linux) | compose-render | `ollama` service actually pulls + serves a model | 🙋 **reports wanted** |
| LLM provider — external | code review | Real `LLM_BASE_URL` (Anthropic / OpenAI / hosted Ollama) round-trips | 🙋 **reports wanted** |
| TAPPaaS deployment | none — spec only | Pilot deploy into a real TAPPaaS environment | 🧪 **design partner wanted** |
| DPF Edge Node enrollment (single-host) | none — spec only | First-draft enrollment ceremony executed end-to-end | 🙋 **reports wanted** |
| DPF Edge Node — multi-host LAN (T2) | none — code-complete via T2.1-T2.4 | Authority on Host A, Edge Node on Host B over a real LAN with a switch; non-loopback IP attribution; ARP / nmap / SNMP collector output reaching Postgres + Neo4j | 🙋 **reports wanted** |
| Cloud — Single VM substrate (AWS / GCP / Azure) | runbook + verify-wrapper ready ([cloud-single-vm.md](cloud-single-vm.md)) | First real-cloud pilot report on each major cloud | 🙋 **reports wanted** |
| Cloud — Managed Container service / Managed k8s | none — spec only | Substrate pilot per packaging target | 🧪 **design partner wanted** |
| Cloud — Cloudflare-fronted managed isolated cells | architecture + live decomposed backlog; no runtime implementation | Two synthetic cells, edge/origin failure drills, restore/exit proof, and full deployment-contract evidence | 🔬 **research — not yet a pilot offer** |

## Fastest path: one command for the whole sweep

### Linux + macOS

Run the bash wrapper to verify the full install + Edge Node path and
produce one tarball:

```bash
# On a host that already has DPF installed and running:
bash scripts/verify-install-edge.sh

# Or, on a fresh host (clones + installs first):
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh --headless --release --no-autostart
bash scripts/verify-install-edge.sh
```

The wrapper covers ledger rows 1-4 in a single sweep:

- Captures host fingerprint (uname, sw_vers / os-release, docker / node / pnpm versions, installer version)
- On macOS: checks architecture (arm64), LaunchAgent loaded, Docker Model Runner reachable
- Asserts portal `/api/health` returns 200
- Snapshots Prometheus scrape targets (observability outcome)
- Issues a bootstrap token via `apps/web/scripts/issue-edge-bootstrap-token.ts`
- Runs `services/edge-node/scripts/verify-lifecycle.ts` end-to-end (enroll -> heartbeat -> discovery-run + idempotency)
- Captures `install-dpf.sh doctor` diagnostic bundle
- Bundles everything into `~/.dpf/verify-bundle-<timestamp>.tar.gz` and prints a paste-able markdown summary

### Windows

Run the PowerShell wrapper from the repo root:

```powershell
# On a host that already has DPF installed and running:
.\scripts\verify-install-windows.ps1

# Override the portal URL (e.g. remote host):
.\scripts\verify-install-windows.ps1 -AuthorityUrl http://my-host:3000
```

The wrapper covers the same surface as the bash version, adapted for Windows:

- Captures host fingerprint (Windows edition, architecture, Docker Desktop, Node, pnpm)
- Checks Docker Desktop is running (`docker info`)
- Asserts portal `/api/health` returns 200
- Checks Docker Model Runner reachability (SKIP if using external LLM_BASE_URL)
- Snapshots Prometheus scrape targets (SKIP if monitoring profile not active)
- Issues a bootstrap token and runs Edge Node lifecycle verification
- Bundles everything into `%USERPROFILE%\.dpf\verify-bundle-<timestamp>.zip`

### Filing a report

Attach the resulting bundle (`.tar.gz` on Linux/macOS, `.zip` on Windows)
to a [new install-verification issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md)
and paste the printed summary into the body.

The wrappers do **not** cover real-LAN multi-host, TAPPaaS, or cloud
substrate pilots. Those still need the manual sections below.

## Local scratch rehearsal before promotion

For Windows development machines that already have a production-served local
DPF install running, use the non-destructive scratch rehearsal instead of
resetting the real stack:

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute
```

See [Scratch Install Rehearsal](scratch-install-rehearsal.md). The script
creates a separate worktree, a separate Compose project, alternate ports, and
scratch-only secrets, then records evidence under the scratch directory.

For install, setup, provider, Build Studio, Work Capsule, or promotion-sensitive
branches, include the browser-driven new-customer path:

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute -RunFirstRunWalkthrough
```

That mode verifies `/setup`, owner account creation, provider setup access, and
`/build/work` access from the scratch install before cleanup. The browser
walkthrough uses a 120-second per-step timeout for cold production containers;
raise `-WalkthroughTimeoutSeconds` only when the machine is known to be slower.

## How to run each verification (manual sections)

Each section below is paste-able. Copy the block, fill in the
prompts, capture the artifacts named at the bottom of the section,
and check the corresponding row off the matrix.

### 1. Linux end-to-end install (real distro coverage)

**Hardware:** any of Ubuntu 22.04+ / Debian 12+ / Fedora 39+. A fresh
VM is ideal so you exercise the "user has nothing installed" path.

```bash
# Capture environment fingerprint before starting.
uname -a > /tmp/dpf-verify-host.txt
[ -r /etc/os-release ] && cat /etc/os-release >> /tmp/dpf-verify-host.txt

# Prerequisites the installer expects you to bring.
which git curl bash
node -v          # must report v20.x or higher
pnpm -v          # any recent version

# Clone + install.
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh                 # interactive — say "Ready to go"
# Or: bash install-dpf.sh --headless --release --no-autostart
```

**Expected outcomes (check each):**

- [ ] Preflight passes; no unsupported-host refusal.
- [ ] Port preflight passes (or fails with a clear "bound by X" message).
- [ ] Docker Engine installs via apt-get / dnf and `systemctl enable --now docker` succeeds.
- [ ] If user was added to `docker` group: installer exits 75 with a clear logout-or-newgrp instruction. Re-running succeeds.
- [ ] `~/.dpf/install-state.json` exists with `"schemaVersion": 1`, `"platform": "linux"`.
- [ ] `docker compose -p dpf ps` shows portal, postgres, neo4j, qdrant, redis, sandbox, promoter, inngest, adp, ollama all running.
- [ ] `curl http://localhost:3000/api/health` returns 200.
- [ ] Login at http://localhost:3000 with `admin@dpf.local` + the password printed at end of install (also in `.env`).
- [ ] `systemctl --user status dpf.service` reports `active (exited)` (with `--no-autostart` skipped, this is enabled).
- [ ] **Reboot the host.** Verify portal is back at `http://localhost:3000` within 60 seconds.
- [ ] `bash dpf-stop.sh && bash dpf-start.sh` round-trip clean.
- [ ] `bash uninstall-dpf.sh --purge --yes` removes volumes, `.env`, and `~/.dpf`. Verify with `docker volume ls --filter label=com.docker.compose.project=dpf` — empty.

**Artifacts to capture:**

- `/tmp/dpf-verify-host.txt`
- `bash install-dpf.sh doctor` bundle from `~/.dpf/doctor-<ts>.tar.gz`
- Screenshot of the portal home page (proves UI rendering works under Apple Silicon Chromium / Linux Firefox)

### 2. macOS Apple Silicon end-to-end install

**Hardware:** a real Apple Silicon Mac (M1 / M2 / M3 / M4). macOS 14
(Sonoma) or newer. **A fresh user account or a VM is ideal** — you
need to exercise the "no Docker Desktop installed yet" path.

```bash
# Capture environment fingerprint.
sw_vers > /tmp/dpf-verify-host.txt
uname -a >> /tmp/dpf-verify-host.txt

# Prerequisites.
xcode-select --install            # one-time, if not already installed
which git curl bash
node -v                           # v20.x or higher; brew install node or use nvm
pnpm -v                           # npm install -g pnpm

# Clone + install. Do NOT pre-install Docker Desktop — let the
# installer exercise the `.dmg` flow.
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh
```

**Expected outcomes:**

- [ ] Preflight passes; no Intel-Mac refusal.
- [ ] Docker Desktop `.dmg` downloads from `desktop.docker.com`.
- [ ] `hdiutil attach` mounts; installer `cp -R Docker.app /Applications`; `hdiutil detach`.
- [ ] Docker Desktop launches; daemon reachable within ~60s.
- [ ] Installer proceeds through compose up.
- [ ] `curl http://localhost:3000/api/health` returns 200.
- [ ] Login works.
- [ ] `~/Library/LaunchAgents/local.dpf-autostart.plist` exists.
- [ ] `launchctl print gui/$UID/local.dpf-autostart` shows the agent loaded.
- [ ] **Reboot.** Log back in. Verify portal is reachable within 60s.
- [ ] **Capture `xattr` state on the plist** — first-install machines sometimes have `com.apple.quarantine` set; the installer strips it; verify with `xattr -l ~/Library/LaunchAgents/local.dpf-autostart.plist` (should be empty or have `com.apple.metadata:_kMDItemUserTags` only).
- [ ] `bash uninstall-dpf.sh --purge --yes` removes volumes + state + plist.

**Artifacts to capture:**

- `/tmp/dpf-verify-host.txt`
- `bash install-dpf.sh doctor` bundle
- `launchctl print gui/$UID/local.dpf-autostart` output (post-reboot)
- Screenshot of the portal home page

### 3. Discovery collectors — real macOS data

After the macOS install above is green, verify the discovery pipeline
emits real data, not just unit-test fixtures.

```bash
# Trigger a bootstrap discovery run from the portal:
#   Settings -> Discovery -> Run Bootstrap

# Then inspect the database for host evidence.
docker compose -p dpf exec postgres psql -U dpf -c \
  "SELECT count(*), \"evidenceSource\", \"packageManager\"
   FROM \"DiscoveredSoftware\"
   GROUP BY \"evidenceSource\", \"packageManager\";"
```

**Expected outcomes:**

- [ ] At least one row with `packageManager = 'pkgutil'` (macOS system receipts).
- [ ] If brew installed: rows with `packageManager = 'brew'` and `'brew-cask'`.
- [ ] No rows with `packageManager = 'dpkg'` or `'rpm'` (those are Linux-only).
- [ ] `DiscoveredItem` table has a row with `itemType = 'docker_runtime'` and a `sourcePath` matching one of the macOS Docker Desktop socket paths (`/var/run/docker.sock`, `~/.docker/run/docker.sock`, or `~/Library/Containers/com.docker.docker/Data/docker.raw.sock`).

### 4. Observability stack — real metrics flow

```bash
# After a Linux install with the linux-monitoring profile active.
curl --silent http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job, health}'
```

**Expected outcomes:**

- [ ] Prometheus targets list includes `node-exporter`, `cadvisor`,
      `postgres-exporter`, and the portal scrape — all with `health: "up"`.
- [ ] Grafana at `http://localhost:3002` reachable. Dashboards under
      "DPF" folder render with non-empty panels.
- [ ] Network sweep in the portal (Settings → Topology) shows host
      NICs (not just container-local interfaces). Confidence column
      should read 0.95, not 0.70.

### 5. LLM providers

| Provider | Verification |
|----------|--------------|
| **Docker Model Runner** (macOS DD ≥ 4.40) | Settings → AI → run a prompt against the local model. Portal logs show `POST http://model-runner.docker.internal/engines/v1/chat/completions` returning 200. |
| **Ollama** (Linux native Docker) | `docker compose -p dpf exec portal curl http://ollama:11434/api/tags` lists at least one model after first portal use. A chat completion round-trips. |
| **External** | Set `LLM_BASE_URL=https://api.anthropic.com/v1` and a real `API_KEY` in `.env`; restart portal; verify a chat completion succeeds. |

### 6. TAPPaaS pilot deployment

**Status:** spec-only — no code shipped. This row stays "not started"
until a Phase-0 spike lands.

The spike should:

- [ ] Identify a real TAPPaaS environment with admin access.
- [ ] Define the packaging target — TAPPaaS module spec format, version, etc.
- [ ] Build a minimum-viable TAPPaaS module that wraps `install-dpf.sh`'s
      Single-VM substrate path.
- [ ] Deploy + reach `/api/health=200` from outside the TAPPaaS network.
- [ ] Document upgrade + rollback semantics.

Linked spec: [docs/superpowers/specs/2026-05-09-cloud-deployment-design.md](../superpowers/specs/2026-05-09-cloud-deployment-design.md).

### 7. DPF Edge Node enrollment

**Status:** Phase 0 code shipped — Authority Core surface
(`/api/v1/edge/enroll`, `/heartbeat`, `/discovery-runs`), service
skeleton at `services/edge-node`, Admin UI at
`/platform/edge-nodes`, lifecycle verification script.
**Verification reports wanted** for a real Edge Node enrolling
against a running Authority Core on each platform.

#### How to run the lifecycle verification script

The script exercises the spec's reference flow (enroll → heartbeat →
submit → idempotent replay → stale_observation → rate limit) against
a running Authority Core and exits non-zero on any assertion failure.

```bash
# 1. Bring up the platform.
bash dpf-start.sh   # or dpf-start on Windows

# 2. Sign in as an HR-000 / superuser at /platform/edge-nodes and
#    issue a bootstrap token. Copy the plaintext shown ONCE.

# 3. Run the lifecycle verification.
cd services/edge-node
DPF_AUTHORITY_URL=http://localhost:3000 \
DPF_BOOTSTRAP_TOKEN='dpfboot_YOURPLAINTEXTHERE' \
DPF_VERIFY_NODE_NAME='verify-2026-05-12-mike-laptop' \
  pnpm verify-lifecycle

# 4. The script enrolls; if your Approval policy is "operator
#    approval required" (the default for paste-provisioned tokens),
#    it pauses at Phase 2 and prints a "node needs approval" message.
#    Go back to /platform/edge-nodes, click Approve on the new
#    pending node, then re-run the script. (Phases 1-2 will run
#    again because the script issues a fresh runKey per invocation.)
#
#    On a "trusted" enroll path (auto-approve metadata on the
#    bootstrap token), the script runs all six phases in one pass.

# 5. The script prints
#       Results: N passed, M failed
#    and exits 0 if M = 0.
```

Then file the verification report (template below) and check off the
matrix row for your platform.

#### Phase 0 verification matrix

- [ ] **Linux container (Mode 1)** — Edge Node service from `services/edge-node` enrolls and submits against a Linux Authority install, full six-phase pass.
- [ ] **macOS host (Mode 2 native binary, Phase 1+)** — blocked by the binary-language decision (see spec § Open question resolutions). When unblocked, repeat the lifecycle on real Apple Silicon.
- [ ] **macOS Docker Desktop fallback (Mode 3)** — Edge Node container in Docker Desktop's VM enrolls and submits with the documented degraded capability set.
- [ ] **Windows native (Mode 4, Phase 1+)** — blocked on Mode 2 decision.
- [ ] **DB attribution check** — after a successful submit, query Postgres directly: `SELECT id, runKey, edgeNodeId, sourceSlug FROM "DiscoveryRun" WHERE edgeNodeId IS NOT NULL ORDER BY startedAt DESC LIMIT 5;` — verify the `edgeNodeId` is populated, `sourceSlug` matches `edge-node:<nodeId>`, and items projected to `InventoryEntity`.
- [ ] **Audit chain check** — `SELECT toolName, executionMode, parameters->>'nodeId' AS nodeId, result->>'status' AS status, success FROM "ToolExecution" WHERE executionMode='edge-rest' ORDER BY "createdAt" DESC LIMIT 10;` — verify every route invocation produced a row, including the 429 / 413 / 401 rejections you exercised.

Linked spec: [docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md](../superpowers/specs/2026-05-09-dpf-edge-node-design.md).
Lifecycle script: [services/edge-node/scripts/verify-lifecycle.ts](../../services/edge-node/scripts/verify-lifecycle.ts).

#### Clock sync prerequisite (NTP)

The Authority's `/api/v1/edge/discovery-runs` route enforces a
freshness window on submitted observations. The default bounds are
asymmetric:

- **Past:** 24 hours (matches spec § Soft-fail policy windows — Edge
  Nodes are allowed to queue submissions locally for up to 24h when
  the Authority is unreachable, then flush on reconnect stamping the
  original `observedAt`).
- **Future:** 5 minutes (NTP-tightened — a healthy NTP-synced LAN has
  sub-second skew between hosts; anything more than a few minutes
  ahead is almost certainly a clock-sync problem on the Edge Node
  side and worth catching loudly).

**Prerequisite:** every Edge Node host must run NTP. On a freshly
provisioned VM:

```bash
# Debian / Ubuntu — systemd-timesyncd is the default
sudo timedatectl set-ntp true
timedatectl status                # expect: System clock synchronized: yes

# Fedora / RHEL — chrony is the default
sudo systemctl enable --now chronyd
chronyc tracking                  # expect: Leap status: Normal
```

If you see `stale_observation` errors with the message "must be at
most 5.0min ahead of server time (likely cause: NTP skew on the Edge
Node host)" or "must be at most 24.0h before server time", that's the
freshness gate firing. Fix NTP first, then re-check; widening the
bounds with the env vars below should be a last resort.

**Operator-configurable bounds:**

The Authority Core honors two env vars (set on the **Authority** host,
not on the Edge Node — the check runs server-side):

| Env var | Default | Purpose |
|---|---|---|
| `DPF_EDGE_FRESHNESS_PAST_SEC` | `86400` (24h) | How old `observedAt` may be. Tighten for air-gap deployments where 24h-stale data is suspicious by definition. |
| `DPF_EDGE_FRESHNESS_FUTURE_SEC` | `300` (5min) | How far ahead `observedAt` may be. Widen only if you have chronic clock skew that's expected (rare). |

Either bound set to a non-numeric value or `<= 0` falls back to the
default — operator typos don't accidentally disable the check.

Audit rows for rejections include the signed `deltaMs`, `direction`
(`past` or `future`), and the bounds in force at the time:

```sql
SELECT parameters->'summary' AS summary
FROM "ToolExecution"
WHERE "toolName" = 'edge.discovery_runs.submit'
  AND "result"->>'error' = 'stale_observation'
ORDER BY "createdAt" DESC LIMIT 5;
```

### 7b. Edge Node multi-host LAN verification (T2)

**Status:** T2 code-complete per T2.1 through T2.4. **Real-hardware
reports wanted** for a real second-host Edge Node enrolling against a
remote Authority Core across a LAN.

This is the next verification rung up from § 7 (which covers
single-host enrollment). The bar:

```
Authority Core on Host A
   │  (over a real LAN, separated by at least one switch)
   ▼
Edge Node on Host B   ← a different machine, native Linux Docker
```

The Authority portal shows the Edge Node enrolled with a **non-loopback
IP attributed to it**, and the discovery rows include real LAN-side
IPs plus at least one switch / gateway / non-portal-host item with
`osiLayer >= 2`.

#### Full runbook

The end-to-end ceremony — Authority preflight, bootstrap token,
operator approval, first sweep, and the SQL that verifies it landed —
is in [`docs/install/edge-node-multi-host.md`](edge-node-multi-host.md).

It also walks the optional HTTPS path (T2.2 — Caddy sidecar on the
Authority, `NODE_EXTRA_CA_CERTS` on the Edge Node).

#### Operational notes you'll want before starting

These are the gotchas the T2 verification gap list (G4 + G7) called
out — they bite operators who jump straight to `docker compose up -d`:

**1. Authority Core URL stability (G4).** The Edge Node persists the
`DPF_AUTHORITY_URL` it enrolled against. If Host A reboots and DHCP
hands it a different IP, every enrolled Edge Node on the LAN loses
contact until you reconfigure. Use one of:

- Static IP / DHCP reservation for Host A on your router
- mDNS `.local` name via `avahi-daemon` (Linux) or Bonjour (macOS)
- DNS A record on your LAN

A dynamic DHCP IP is fine for the first verification run, but plan
to pin it before you treat the deployment as durable. Authority
auto-discovery (mDNS-SD, Zeroconf, etc.) is deferred to a later
thread — T2's expectation is "operator pins it."

**2. Operator approval gate (G7).** Paste-provisioned bootstrap
tokens always land in `trustState=pending` per spec § Approval
policy. The node enrolls successfully but **cannot submit
observations** until an operator clicks **Approve** in
`/platform/edge-nodes`. This is the friction that makes Edge Node
enrollment opt-in, not silent.

The Phase 0 single-host demo glosses over this because the local
installer-issued bootstrap token auto-approves. The multi-host path
does NOT — if you skip the Approve click, your sweeps will keep
failing with `node_not_trusted` errors and your `DiscoveryRun` table
will stay empty. Watch for this in your first run.

**3. NTP on both hosts.** See § 7's "Clock sync prerequisite (NTP)"
subsection above. The Authority's `/api/v1/edge/discovery-runs` route
rejects submissions whose `observedAt` falls outside the asymmetric
freshness window. Fresh VMs without NTP can drift tens of seconds
and silently fail their first sweep.

#### Verification gate

Same checklist as § 7's Phase 0 matrix, plus the multi-host-specific
rows from the
[Edge Node multi-host verification template](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=edge_node_multi_host_verification.md):

- [ ] Authority is reachable from Host B (not just from Host A)
- [ ] Edge Node enrolls and lands in `pending`
- [ ] Operator approves; node flips to `trusted`
- [ ] First sweep submits within one sweep interval
- [ ] `EdgeNode.metadata.host.ipAddresses` includes the Host B LAN IP
- [ ] `DiscoveredItem` rows include real LAN-side addresses (not
      Docker bridge IPs)
- [ ] At least one switch / gateway / non-portal-host item with
      `osiLayer >= 2`
- [ ] Audit chain rows in `ToolExecution` for every route exercised
- [ ] (Optional) TLS path: bring up `docker-compose.tls.yml` on
      Host A; distribute `ca-bundle.crt` to Host B; switch
      `DPF_AUTHORITY_URL` to `https://...`; re-verify

When that happens, **T2 flips to `verified on real LAN`** in the
parent thread ledger.

#### File a report

Open an issue with the
[Edge Node multi-host verification template](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=edge_node_multi_host_verification.md).
The template asks for LAN topology, the path you took (HTTP / HTTPS),
the T2 checklist tick-list, the SQL output, and a doctor bundle from
each host. Partial reports are valuable — failure reports name the
symptom and the LAN topology and are more useful than no report.

### 8. Cloud deployment patterns

Three substrates per the [cloud deployment design](../superpowers/specs/2026-05-09-cloud-deployment-design.md);
each needs its own pilot to flip from spec to verified.

- [ ] **Single VM** — runbook + verify-wrapper are ready.
      Follow [cloud-single-vm.md](cloud-single-vm.md) on AWS / GCP /
      Azure, then run `bash scripts/verify-install-edge.sh`. Status:
      🙋 reports wanted (this is the lowest-friction cloud pilot).
- [ ] **Managed container service** — ECS / Cloud Run / Azure Container
      Apps. Pull from GHCR. Validate `/api/health=200`. Status:
      🧪 design partner wanted (spec-only, no runbook yet).
- [ ] **Managed Kubernetes** — Helm chart deploy into a real EKS / GKE /
      AKS cluster. Validate the same plus a pod-restart survival test.
      Status: 🧪 design partner wanted (Helm chart not yet shipped).

## Reporting verification results

When you've run a section, file your report through the
[Install verification report template](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md).
The form mirrors the checklist above and pre-fills:

- Title prefix `Install verification — `
- Labels: `install-verification`, `community-report`

The template prompts for everything maintainers need:

- Environment fingerprint (`uname -a`, `sw_vers` / `cat /etc/os-release`,
  Docker version, Node + pnpm versions, installer version)
- Install command + outcome (cleanly / with warnings / hit a wall)
- Checklist of preflight, install, autostart, discovery, lifecycle steps
- Doctor bundle attachment (`bash install-dpf.sh doctor` → attach
  `~/.dpf/doctor-<timestamp>.tar.gz`)
- Free-text "anything else" for surprises, papercuts, copy issues

Maintainers will:

- For 🙋 **reports wanted** rows: integrate your findings and, once a
  handful of independent reports come in for a row, flip its status
  from "reports wanted" to ✅ **verified** and the corresponding
  README row from "Early access" to **GA**.
- For 🧪 **design partner wanted** rows (TAPPaaS / Edge Node / Cloud):
  reach out to discuss scope — those need actual implementation work
  before they're runnable; what we're looking for is co-design
  partners, not bug reports against shipping code.

The bar for ✅ verified is "we have evidence on real hardware",
not "we believe". Partial reports still count — even a "got to step
N and failed" failure report is more valuable than no report.
