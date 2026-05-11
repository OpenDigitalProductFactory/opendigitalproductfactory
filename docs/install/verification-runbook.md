# DPF Install Verification Runbook

**Purpose:** The CI gates in `.github/workflows/release-gates.yml` and
`install-verification.yml` cover what GitHub-hosted runners can run.
This runbook covers everything else — the environments and end-states
that need a real human at a real host to verify.

Until each row in the matrix below is checked off, the corresponding
install path is **"shipped, runtime-verification pending"** — not
**"GA"**. The README and roadmap status should reflect that until
verification lands.

## Verification matrix

| Path | What CI proves | What this runbook covers | Status |
|------|----------------|--------------------------|--------|
| Windows installer | n/a (no CI gate today) | Production usage by real users | ✓ verified |
| Linux end-to-end install | `install-verification.yml` (ubuntu-latest, dev + release modes) — full compose up, `/api/health=200`, doctor bundle | Distro coverage beyond Ubuntu: Debian 12, Fedora 39. Autostart-after-reboot. | **pending** |
| macOS end-to-end install | dry-run only (`macos-14` can't nest-virt Docker Desktop) | The actual `.dmg` install + Docker Desktop boot + portal up + LaunchAgent reboot survival | **pending** |
| Discovery collectors (darwin) | unit tests with mocked deps | Real `pkgutil --pkgs` / `brew list` enumeration emits sensible discovery items | **pending** |
| Observability stack | compose-render only | Prometheus actually scrapes metrics; Grafana dashboards populate; `linux-monitoring` profile cAdvisor / node-exporter on real Linux | **pending** |
| LLM provider — Docker Model Runner | dry-run | Real Model Runner serves chat completions to portal | **pending** |
| LLM provider — Ollama (Linux) | compose-render | `ollama` service actually pulls + serves a model | **pending** |
| LLM provider — external | code review | Real `LLM_BASE_URL` (Anthropic / OpenAI / hosted Ollama) round-trips | **pending** |
| TAPPaaS deployment | none — spec only | Pilot deploy into a real TAPPaaS environment | **not started** |
| DPF Edge Node enrollment | none — spec only | First-draft enrollment ceremony executed end-to-end | **not started** |
| Cloud deployment (Single VM / Container / k8s) | none — spec only | At least one substrate pilot per packaging target | **not started** |

## How to run each verification

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

**Status:** spec-only — no code shipped. This row stays "not started"
until a Phase-0 spike lands.

The spike should:

- [ ] Implement the enrollment ceremony first-draft contract per the spec.
- [ ] Stand up one Edge Node (container with `network_mode: host` on a separate Linux box) and enroll it against an Authority Core.
- [ ] Run a discovery sweep from the Edge Node and verify items appear in the Authority Core's Postgres + Neo4j with the `edgeNodeId` foreign key populated.
- [ ] Validate the "in-VM fallback" mode on a macOS host (Edge Node as a binary inside the Docker Desktop VM since `host` networking isn't supported there).

Linked spec: [docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md](../superpowers/specs/2026-05-09-dpf-edge-node-design.md).

### 8. Cloud deployment patterns

**Status:** spec-only — no code shipped per substrate.

Each of the three substrates needs its own pilot before declaring the
substrate verified:

- [ ] **Single VM** — `install-dpf.sh --headless` inside a cloud VM (EC2 / Compute Engine / Azure VM). Validate the same matrix as the Linux install above.
- [ ] **Managed container service** — ECS / Cloud Run / Azure Container Apps. Pull from GHCR. Validate `/api/health=200`.
- [ ] **Managed Kubernetes** — Helm chart deploy into a real EKS / GKE / AKS cluster. Validate the same plus a pod-restart survival test.

Linked spec: [docs/superpowers/specs/2026-05-09-cloud-deployment-design.md](../superpowers/specs/2026-05-09-cloud-deployment-design.md).

## Reporting verification results

When a row in the matrix is verified, update its row to `✓ verified`
plus the verifier's name, date, and a link to the captured artifacts
(GitHub issue, Drive folder, etc.). Don't mark anything "✓ verified"
without artifacts — the bar is "we have evidence", not "we believe".

Until the Linux + macOS rows are both `✓ verified`, the README install
section should say **"preview"** alongside macOS / Linux entries, not
**"GA"**.
