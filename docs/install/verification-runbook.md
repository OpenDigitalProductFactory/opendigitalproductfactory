# DPF Install Verification Runbook

> **For early adopters with hardware in hand.** The CI gates in
> `.github/workflows/release-gates.yml` and `install-verification.yml`
> cover what GitHub-hosted runners can run. **This runbook covers
> everything CI can't reach** — and you're the person who can close
> those gaps.
>
> The macOS and Linux installers are code-complete and statically
> CI-green. They graduate to GA when the community sends us
> verification reports from real hardware. If you have an Apple
> Silicon Mac, a non-Ubuntu Linux box, a TAPPaaS environment, or a
> cloud VM you can spare for an hour, **please pick a section below
> and run through it.** Both happy-path and failure reports are
> valuable.
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
| Windows installer | n/a (no CI gate today) | Production usage by real users | ✓ verified |
| Linux end-to-end install | `install-verification.yml` (ubuntu-latest, dev + release modes) — full compose up, `/api/health=200`, doctor bundle | Distro coverage beyond Ubuntu: Debian 12, Fedora 39. Autostart-after-reboot. | 🙋 **reports wanted** |
| macOS end-to-end install | dry-run only (`macos-14` can't nest-virt Docker Desktop) | The actual `.dmg` install + Docker Desktop boot + portal up + LaunchAgent reboot survival | 🙋 **reports wanted** |
| Discovery collectors (darwin) | unit tests with mocked deps | Real `pkgutil --pkgs` / `brew list` enumeration emits sensible discovery items | 🙋 **reports wanted** |
| Observability stack | compose-render only | Prometheus actually scrapes metrics; Grafana dashboards populate; `linux-monitoring` profile cAdvisor / node-exporter on real Linux | 🙋 **reports wanted** |
| LLM provider — Docker Model Runner | dry-run | Real Model Runner serves chat completions to portal | 🙋 **reports wanted** |
| LLM provider — Ollama (Linux) | compose-render | `ollama` service actually pulls + serves a model | 🙋 **reports wanted** |
| LLM provider — external | code review | Real `LLM_BASE_URL` (Anthropic / OpenAI / hosted Ollama) round-trips | 🙋 **reports wanted** |
| TAPPaaS deployment | none — spec only | Pilot deploy into a real TAPPaaS environment | 🧪 **design partner wanted** |
| DPF Edge Node enrollment | none — spec only | First-draft enrollment ceremony executed end-to-end | 🧪 **design partner wanted** |
| Cloud deployment (Single VM / Container / k8s) | none — spec only | At least one substrate pilot per packaging target | 🧪 **design partner wanted** |

## Fastest path: one command for the whole sweep

If you just want to run **all** the Linux + observability + Edge Node
verification in one shot and produce one tarball to attach to a GitHub
issue, use the wrapper:

```bash
# On a host that already has DPF installed and running:
bash scripts/verify-install-edge.sh

# Or, on a fresh host (clones + installs first):
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh --headless --release --no-autostart
bash scripts/verify-install-edge.sh
```

The wrapper covers ledger rows 1–4 in a single sweep:

- Captures host fingerprint (uname, sw_vers / os-release, docker / node / pnpm versions, installer version)
- Asserts portal `/api/health` returns 200
- Snapshots Prometheus scrape targets (observability outcome)
- Issues a bootstrap token via `apps/web/scripts/issue-edge-bootstrap-token.ts`
- Runs `services/edge-node/scripts/verify-lifecycle.ts` end-to-end (enroll → heartbeat → discovery-run + idempotency)
- Captures `install-dpf.sh doctor` diagnostic bundle
- Bundles everything into `~/.dpf/verify-bundle-<timestamp>.tar.gz` and prints a paste-able markdown summary

Attach the resulting tarball to a [new install-verification issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md)
and paste the printed summary into the body. That's a complete
verification report for the Linux row of the matrix.

The wrapper does **not** cover macOS (no `--bootstrap` path for the
`.dmg` install yet), real-LAN multi-host, or the TAPPaaS / Edge / cloud
substrate spikes. Those still need the manual sections below.

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

### 8. Cloud deployment patterns

**Status:** spec-only — no code shipped per substrate.

Each of the three substrates needs its own pilot before declaring the
substrate verified:

- [ ] **Single VM** — `install-dpf.sh --headless` inside a cloud VM (EC2 / Compute Engine / Azure VM). Validate the same matrix as the Linux install above.
- [ ] **Managed container service** — ECS / Cloud Run / Azure Container Apps. Pull from GHCR. Validate `/api/health=200`.
- [ ] **Managed Kubernetes** — Helm chart deploy into a real EKS / GKE / AKS cluster. Validate the same plus a pod-restart survival test.

Linked spec: [docs/superpowers/specs/2026-05-09-cloud-deployment-design.md](../superpowers/specs/2026-05-09-cloud-deployment-design.md).

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
