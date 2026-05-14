# DPF Edge Node — Air-Gapped Installation

> **Status:** T5 — Authority Core and Edge Node on a disconnected
> network, no internet access, no GHCR pull-through. T5 builds on
> [T2 multi-host](edge-node-multi-host.md) (LAN deployment) and
> the [T2.2 TLS overlay](../../docker-compose.edge-standalone-tls.yml)
> (internal-CA HTTPS); read those first if you haven't already.
>
> **What this is not:** macOS / Windows native binary install (T3)
> or mTLS hardening (T4). The Phase 0 Edge Node is a Linux container
> only. Air-gap with native binaries arrives in T5+T3.
>
> **Spec:** [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)
> **Verification harness:** [`scripts/verify-edge-node-air-gap.sh`](../../scripts/verify-edge-node-air-gap.sh)
> **Report template:** [`edge-node-air-gapped-verification-report.md`](edge-node-air-gapped-verification-report.md)

## Why this exists

Regulated and on-prem fleets routinely run with no outbound internet:
no GHCR, no public DNS, no SaaS phone-home of any kind. The Phase 0
Edge Node is already air-gap-safe by code construction — `undici`
to one URL is the only outbound surface (see
[Phone-home audit](#phone-home-audit-static-grounding) below). What
*isn't* covered yet is the install path itself: pulling images from
GHCR, copying CA bundles via scp, and timing bootstrap-token TTLs
all assume an operator with internet access and same-room access to
the host. This runbook is the path for the case where neither holds.

## What you'll have at the end

- **Staging workstation** (one-time, connected): assembled an offline
  bundle of pinned-digest images, the Edge Node release tarball, and
  the operator-trusted CA bundle, ready to hand-carry into the
  air-gapped network.
- **Host A** (air-gapped, Authority Core): full DPF Authority Core
  running from `docker load`-ed images, never reached GHCR or any
  public DNS.
- **Host B** (air-gapped, Edge Node): Edge Node container enrolled
  against Host A over HTTPS using the internal CA, heartbeating and
  submitting discovery runs.
- A verification report (`edge-node-air-gapped-verification-report.md`)
  captured during a 24-hour-minimum soak demonstrating: zero outbound
  packets off the Authority allow-list, buffer-replay correctness
  through scheduled offline windows, and `EdgeNode.lastSeenAt`
  monotonicity.

## What you need

| Resource | Notes |
|---|---|
| **Staging workstation** with internet | Any Linux host with docker + scp. Used once to assemble the bundle. Never connected to the air-gapped network. |
| **Two Linux hosts** on a disconnected network | Bare-metal or VMs both fine. No NAT to the internet, no DNS forwarder out. Same broadcast domain is simplest; one hop / one switch acceptable. **Not Docker Desktop** — same constraint as T2 (see *Why not Docker Desktop* in the multi-host runbook). |
| **Static-ish IP for Host A** | DHCP fine if the reservation is stable. mDNS `.local` works inside the air-gap; internal DNS A record is cleaner. |
| **Internal NTP source** on the air-gapped network | Host A's freshness window rejects observations more than 5 minutes ahead or 24 hours behind server time. The default `DPF_EDGE_FRESHNESS_PAST_SEC` is configurable downward for air-gap (see [Tighten the freshness window](#tighten-the-freshness-window-recommended)). Drift without NTP wedges the install. |
| **Internal CA** with a cert valid for Host A's CN/SAN | The Edge Node's TLS overlay requires a CA bundle. Self-signed CA fine if the operator controls trust. Plain HTTP works (Phase 0 floor) but the LAN must be treated as a trust boundary — bearer tokens on plain HTTP are sniffable. |
| **Hand-carry medium** | USB-C drive, write-once optical, or whatever your environment permits. Bundle is ~3–5 GB depending on which third-party images you include. |
| **HR-000 / superuser login** on the Authority | Required to issue the bootstrap token. |

## Stage 1 — Assemble the offline bundle (staging workstation)

This stage runs on a connected workstation. None of it touches the
air-gapped network.

### Step 1.1 — Pin image digests

The `docker-compose.release.yml` ships tag-pinned (`:latest` by
default). For air-gap, freeze the digests so the bundle and the
verifier agree on which exact image bytes are in scope.

```bash
# On the staging workstation.
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf-staging
cd ~/dpf-staging

# Pick a release tag (not :latest — air-gap rules forbid moving targets).
export DPF_IMAGE_TAG=v0.4.0   # example; use whichever release you're staging

# Pull each release image and capture its digest.
for img in \
  dpf-portal dpf-sandbox dpf-promoter dpf-browser-use dpf-adp dpf-edge-node; do
  docker pull "ghcr.io/opendigitalproductfactory/${img}:${DPF_IMAGE_TAG}"
done

# Plus the third-party base images from docker-compose.yml.
for img in \
  postgres:16-alpine \
  neo4j:5-community \
  qdrant/qdrant:latest \
  prom/prometheus:latest \
  grafana/grafana-oss:latest \
  gcr.io/cadvisor/cadvisor:latest \
  prom/node-exporter:latest \
  prometheuscommunity/postgres-exporter:latest \
  redis:7-alpine \
  inngest/inngest:latest; do
  docker pull "$img"
done

# Capture digest-pinned manifest.
docker images --no-trunc --format '{{.Repository}}:{{.Tag}}@{{.Digest}}' \
  | grep -E '(opendigitalproductfactory|postgres|neo4j|qdrant|prom|grafana|cadvisor|redis|inngest)' \
  | sort -u > images-manifest.txt

cat images-manifest.txt
# Should list ~16 image@sha256:... lines. Each row is what the
# verifier will assert matches at load time.
```

> **Why pin digests:** tags are mutable; `redis:7-alpine` on Monday is
> not the same image bytes on Friday. The bundle you hand-carried and
> the bundle a verifier pulls later must be byte-identical, or your
> air-gap verification is meaningless.

### Step 1.2 — Save images to a tarball

```bash
# Read images-manifest.txt and save each. xargs handles long lists.
xargs -a images-manifest.txt docker save -o dpf-images.tar
ls -lh dpf-images.tar
# ~3–5 GB depending on which optional images you included.

# Per-image digests, for tamper-evidence:
sha256sum dpf-images.tar > dpf-images.tar.sha256
```

### Step 1.3 — Bundle the repo + Edge Node compose + TLS overlay

The Edge Node host doesn't need the full repo — only the compose
files and `.env.edge-standalone.example`. Strip to the minimum:

```bash
mkdir dpf-air-gap-bundle
cp docker-compose.yml \
   docker-compose.release.yml \
   docker-compose.edge-standalone.yml \
   docker-compose.edge-standalone-tls.yml \
   .env.docker.example \
   .env.edge-standalone.example \
   install-dpf.sh \
   dpf-air-gap-bundle/

# Pin the tag in a wrapper .env so the operator can't accidentally
# pull :latest on the air-gapped side.
cat > dpf-air-gap-bundle/.env.air-gap-pinned <<EOF
GHCR_OWNER=opendigitalproductfactory
DPF_IMAGE_TAG=${DPF_IMAGE_TAG}
EOF

cp images-manifest.txt dpf-images.tar dpf-images.tar.sha256 dpf-air-gap-bundle/
tar -czf dpf-air-gap-bundle.tar.gz dpf-air-gap-bundle/
sha256sum dpf-air-gap-bundle.tar.gz > dpf-air-gap-bundle.tar.gz.sha256
```

### Step 1.4 — Generate the internal CA + Authority cert

If you already have an internal CA, skip to importing it. Otherwise
the repo ships a helper:

```bash
# scripts/issue-authority-tls-cert.sh produces a self-signed cert
# (which doubles as its own CA bundle), the private key, and a
# Caddyfile for the Authority's TLS sidecar. Add --hostname once
# per SAN you want on the cert.
bash scripts/issue-authority-tls-cert.sh \
  --hostname dpf-authority.lan \
  --out-dir ./tls-bundle/ \
  --org "Your Org"

ls tls-bundle/
# authority.crt   ← Authority Core's certificate (Host A)
# authority.key   ← Authority Core's private key (Host A, 0600)
# ca-bundle.crt   ← what the Edge Node trusts (both hosts)
# Caddyfile       ← drop-in for docker-compose.tls.yml (Host A)
```

> The private key (`authority.key`) is `chmod 0600` and **must not**
> leave Host A. Copy it to Host A only. `ca-bundle.crt` is the
> public-trust artifact that both hosts (and any future Edge Node
> joining) need.

### Step 1.5 — Hand-carry the bundle

Transfer `dpf-air-gap-bundle.tar.gz`, `dpf-air-gap-bundle.tar.gz.sha256`,
and the `tls-bundle/` directory to your hand-carry medium. The
sha256 files exist so you can verify on the disconnected side.

## Stage 2 — Authority Core (Host A, air-gapped)

### Step 2.1 — Verify the bundle, load images

```bash
# On Host A.
# Verify the tarball wasn't tampered with in transit.
sha256sum -c dpf-air-gap-bundle.tar.gz.sha256
# dpf-air-gap-bundle.tar.gz: OK

tar -xzf dpf-air-gap-bundle.tar.gz
cd dpf-air-gap-bundle

sha256sum -c dpf-images.tar.sha256
# dpf-images.tar: OK

# Load every image into Host A's local Docker daemon.
docker load -i dpf-images.tar
# Loaded image: ghcr.io/opendigitalproductfactory/dpf-portal:v0.4.0
# Loaded image: postgres:16-alpine
# ... (one line per image)

# Spot-check that the digest matches what the manifest says.
docker images --no-trunc --format '{{.Repository}}:{{.Tag}}@{{.Digest}}' \
  | sort -u > images-on-host.txt
diff <(sort images-manifest.txt) images-on-host.txt
# Empty diff means every image bytes match. Any diff = abort and
# investigate before continuing.
```

### Step 2.2 — Install CA bundle + NTP

```bash
sudo mkdir -p /etc/dpf-edge
sudo cp ../tls-bundle/ca-bundle.crt /etc/dpf-edge/ca-bundle.crt
sudo cp ../tls-bundle/authority.crt /etc/dpf-edge/authority.crt
sudo cp ../tls-bundle/authority.key /etc/dpf-edge/authority.key
sudo chmod 0644 /etc/dpf-edge/{ca-bundle.crt,authority.crt}
sudo chmod 0600 /etc/dpf-edge/authority.key

# NTP — point at your internal time source. Skip if the host
# already runs chrony/systemd-timesyncd against an internal pool.
sudo timedatectl set-ntp true
sudo systemctl status systemd-timesyncd | grep -i 'time correction\|status'
# Confirm the host is synced before continuing. The Edge Node's
# freshness window will reject submissions if the two hosts disagree.
```

### Step 2.3 — Install the Authority

Use the bundled `.env.air-gap-pinned` so the install never tries to
pull a fresh tag.

```bash
cd dpf-air-gap-bundle
cp .env.air-gap-pinned .env
$EDITOR .env
# Set:
#   AUTH_URL=https://dpf-authority.lan
#   ADMIN_EMAIL=admin@dpf.local
#   ADMIN_PASSWORD=<your choice>
#   (any other site-specific config from .env.docker.example)

# Bring up the stack from the loaded images. The release overlay
# ensures `build:` is reset to null so no image is built locally.
docker compose -f docker-compose.yml -f docker-compose.release.yml up -d

# Wait for portal to be healthy.
until curl -sS --cacert /etc/dpf-edge/ca-bundle.crt \
  https://dpf-authority.lan/api/health > /dev/null; do
  sleep 2
done
echo "Authority up."
```

### Step 2.4 — Tighten the freshness window (recommended)

The default `DPF_EDGE_FRESHNESS_PAST_SEC` is 24 hours — sized for the
soft-fail policy in the spec § *Soft-fail policy windows*. In an
air-gap deployment, 24-hour-old observations are usually
suspicious by definition (the buffer is in-memory and bounded; older
data means the node restarted and lost it, or something stranger
happened).

```bash
# Add to the .env on Host A:
echo 'DPF_EDGE_FRESHNESS_PAST_SEC=3600   # 1 hour' >> .env
echo 'DPF_EDGE_FRESHNESS_FUTURE_SEC=300  # 5 min default' >> .env
docker compose up -d portal  # apply env change
```

### Step 2.5 — Issue a bootstrap token (with extended TTL)

The default bootstrap token TTL is 15 minutes (`BOOTSTRAP_TOKEN_DEFAULT_TTL_MS`
in `packages/db/src/edge-node-types.ts`) — too short for hand-carry
in regulated facilities. The spec-enforced maximum is 24 hours
(`BOOTSTRAP_TOKEN_MAX_TTL_MS`); use that as the air-gap default.

Two paths:

**A. From the Admin UI** (requires a browser that trusts the internal CA):

1. Open `https://dpf-authority.lan/platform/edge-nodes`.
2. Sign in as HR-000 / superuser.
3. Click **Issue bootstrap token**. Pick the longest TTL the UI
   offers (capped at 24 h).
4. **Copy the plaintext token immediately** — shown exactly once.
   Token has `dpfboot_` prefix.

**B. From the CLI on Host A** (no browser required, audit-logged
under the synthetic *DPF installer (local host)* principal):

```bash
# Run from the repo root on Host A. Talks to Postgres directly via
# Prisma; respects the same single-use semantics as the UI path.
pnpm --filter web exec tsx apps/web/scripts/issue-edge-bootstrap-token.ts \
  --ttl-minutes 1440
# Plaintext token prints to stdout; redirect to a file or copy it.
# Use --auto-approve only if this is a local-host install (single-host
# demo) — for multi-host air-gap deployments, omit it so the node
# lands in trustState=pending and Operator approval is required.
```

## Stage 3 — Edge Node (Host B, air-gapped)

### Step 3.1 — Stage the bundle on Host B

```bash
# On Host B.
sha256sum -c dpf-air-gap-bundle.tar.gz.sha256 && \
  tar -xzf dpf-air-gap-bundle.tar.gz && \
  cd dpf-air-gap-bundle && \
  sha256sum -c dpf-images.tar.sha256 && \
  docker load -i dpf-images.tar

# CA bundle.
sudo mkdir -p /etc/dpf-edge
sudo cp ../tls-bundle/ca-bundle.crt /etc/dpf-edge/ca-bundle.crt
sudo chmod 0644 /etc/dpf-edge/ca-bundle.crt
```

### Step 3.2 — Configure the Edge Node

```bash
cp .env.edge-standalone.example .env
$EDITOR .env
# Set:
#   DPF_AUTHORITY_URL=https://dpf-authority.lan
#   DPF_BOOTSTRAP_TOKEN=dpfboot_<paste-from-step-2.5>
#   DPF_AUTHORITY_CA_CERT=/etc/dpf-edge/ca-bundle.crt
#   DPF_EDGE_NODE_NAME=<descriptive-name>
#   GHCR_OWNER=opendigitalproductfactory
#   DPF_IMAGE_TAG=v0.4.0   # MUST match Stage 1.1's pinned tag
```

### Step 3.3 — Bring the Edge Node up with TLS overlay

```bash
docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-standalone-tls.yml \
               up -d

docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-standalone-tls.yml \
               logs -f edge-node
```

Within ~10 seconds:

```
... DPF Edge Node 0.1.0 starting.
...   authority=https://dpf-authority.lan
... No prior state found; running enrollment.
... Enrolled as nodeId=edge_xxxxxxxx (trustState=pending). ...
... State persisted to /var/lib/dpf-edge-node/state.json
```

### Step 3.4 — Approve the node (Host A)

Same as multi-host T2: refresh the Edge Nodes admin UI, click
**Approve**, watch `trustState` flip from `pending` to `trusted`.

### Step 3.5 — First discovery run

Within one sweep interval (5 minutes default) the node submits its
first discovery run. Verify on Host A using the same SQL from the
T2 multi-host runbook § Step 6.

## Stage 4 — Verification

This stage exists to produce auditable evidence that the install is
air-gap-safe in practice, not just in theory. Two phases: a fast
sanity check (minutes) and a soak (≥24 hours, ideally 7 days).

### Step 4.1 — Fast sanity check

Run [`scripts/verify-edge-node-air-gap.sh`](../../scripts/verify-edge-node-air-gap.sh)
in `--mode=sanity` on Host B:

```bash
sudo ./scripts/verify-edge-node-air-gap.sh \
  --mode=sanity \
  --authority-url=https://dpf-authority.lan \
  --report=./air-gap-sanity-report.txt
```

The script:

- Confirms `iptables` is available and the host can install an
  OUTPUT log-and-deny rule.
- Resolves the Authority URL to an IP and inserts a single ACCEPT
  rule for that IP, everything else LOG + DROP on OUTPUT.
- Runs for 10 minutes (configurable via `--duration-sec`).
- At the end: dumps the egress log count. **Pass criterion: zero
  egress log entries** to anything off the allow-list.

### Step 4.2 — Soak verification (≥24 hours)

```bash
sudo ./scripts/verify-edge-node-air-gap.sh \
  --mode=soak \
  --authority-url=https://dpf-authority.lan \
  --duration-sec=86400 \
  --report=./air-gap-soak-report.md
```

Authority-outage scheduling is operator-driven and external to the
script. While the soak runs on Host B, stop and start the Authority
on Host A on a schedule that exercises buffer-replay:

```bash
# On Host A — run during the Host B soak. Example schedule:
#   T+1h:  docker compose stop portal
#   T+3h:  docker compose start portal
#   T+6h:  docker compose stop portal
#   T+12h: docker compose start portal
```

This exercises **replay correctness** (the in-memory queue drains
into the Authority after each reconnect, idempotency dedupes on
`runKey`), not **drop-oldest** (at the default 5-min sweep × 1000-
envelope buffer cap, you'd need ~83 hours of sustained outage
before drop-oldest fires — unrealistic to exercise live). Drop-
oldest correctness is verified by the unit tests in
`services/edge-node/src/__tests__/sweep.test.ts`; the soak's value
is the live evidence of replay + zero phone-home, not drop policy.

After completion, fill in the [verification report
template](edge-node-air-gapped-verification-report.md) and attach
the soak script's output. The report becomes your air-gap evidence
artifact; archive it alongside the release tag in `DPF_IMAGE_TAG`.

## Known Phase 0 limitations

These are noted in the spec body and in the code — quoted here so
operators can plan around them:

- **Buffer is in-memory only.** Per `services/edge-node/src/sweep.ts`:
  *"Persistent SQLite buffer is a Phase 1+ concern (spec § S6) —
  Phase 0 accepts buffer loss across container restart because the
  collector re-runs immediately and the dropped runs are idempotent
  at the runKey layer anyway."* At default 5-minute sweep with the
  1000-envelope cap, that's ~83 hours / 3.5 days of buffer before
  drop-oldest fires. Sustained Authority outages longer than that
  lose the oldest observations — current observations always win.
- **Plain HTTP works but is sniffable on a shared LAN.** This
  runbook defaults to HTTPS via the internal-CA overlay. Falling
  back to HTTP for a quick test is fine; leaving the install on
  HTTP in production is not.
- **No native binary on macOS / Windows yet.** Phase 0 is Linux
  container only. T3 ships the native binaries.

## Phone-home audit (static grounding)

The runbook's *"zero outbound off the allow-list"* claim is
verifiable from the source without running the binary. Two recipes:

```bash
# 1. Outbound HTTP surface. ONE place uses request():
#    services/edge-node/src/api-client.ts, where the URL is always
#    ${authorityUrl}${path}. There is no other fetch / http / https
#    import in the service.
git grep -nE "\\bfrom \"(undici|node:http|node:https)\"" services/edge-node/src/
# services/edge-node/src/api-client.ts:6:import { request } from "undici";
# (one and only match)

# 2. Dependency surface. Two prod deps: undici (HTTP) + zod
#    (validation). No telemetry SDK, no crash reporter, no update
#    checker.
git show HEAD:services/edge-node/package.json | jq '.dependencies'
# {
#   "undici": "^8.2.0",
#   "zod": "^4.4.3"
# }
```

If a future commit adds a second outbound destination or a telemetry
dep, the air-gap claim breaks. A CI lint that fails the build if
`services/edge-node/src/**/*.ts` imports `node:http`, `node:https`,
or any HTTP-capable package other than `undici` (in `api-client.ts`
specifically) would catch the regression at PR time — worth wiring
as a follow-up but out of scope for this runbook.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Authority returned 503 for /api/v1/edge/discovery-runs` | Authority not yet ready | Wait — Edge Node will buffer + retry. |
| `Authority returned 400 for /api/v1/edge/discovery-runs` with `error=stale_observation` | Clock drift on Host B exceeds `DPF_EDGE_FRESHNESS_PAST_SEC` or `DPF_EDGE_FRESHNESS_FUTURE_SEC` | Confirm both hosts are NTP-synced against the same internal source. Widen the future window only if drift is structural. |
| `unable to verify the first certificate` on enrollment | `DPF_AUTHORITY_CA_CERT` not set, or path doesn't exist | Re-check Step 3.2's `.env`. The TLS overlay refuses to start if `DPF_AUTHORITY_CA_CERT` is missing — if you see this error, you ran without the overlay. |
| `Bootstrap token has expired` | Bootstrap TTL elapsed during hand-carry | Issue a fresh token in Stage 2 § Step 2.5 with a longer TTL. |
| Egress log shows hits to a non-Authority IP | A future change introduced a phone-home path | Investigate the offending image / version. Air-gap claim is invalidated until resolved. |

## References

- [DPF Edge Node spec](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)
- [T2 multi-host LAN runbook](edge-node-multi-host.md)
- [T2 freshness window + NTP](../superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md)
- [`docker-compose.edge-standalone.yml`](../../docker-compose.edge-standalone.yml) — base compose
- [`docker-compose.edge-standalone-tls.yml`](../../docker-compose.edge-standalone-tls.yml) — TLS overlay
- [`scripts/verify-edge-node-air-gap.sh`](../../scripts/verify-edge-node-air-gap.sh) — verification harness
- [`scripts/issue-authority-tls-cert.sh`](../../scripts/issue-authority-tls-cert.sh) — internal CA / leaf cert helper
- [`edge-node-air-gapped-verification-report.md`](edge-node-air-gapped-verification-report.md) — soak report template
