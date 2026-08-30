# DPF Edge Node — Multi-Host LAN Installation

> **New here? Start with the [Edge Node Deployment Topology guide](../edge-node/deployment-topology.md)**
> for the operator-level map (local opt-in vs. remote vs. fleet) and the portal-driven
> "add a node on another machine" flow. This runbook is the manual/developer substrate beneath
> that flow — use it when you want the step-by-step or the portal flow isn't available.

> **Status:** T2 — multi-host real-LAN deployment. Phase 0
> ([2026-05-12-edge-node-phase0-roadmap.md](../superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md))
> covers single-host (Authority + Edge Node on the same machine).
> This document covers the next step: Authority on Host A, Edge Node
> on Host B, separated by at least one real switch.
>
> **What this is not:** macOS / Windows native binary install (T3),
> or mTLS hardening (T4). For air-gapped deployments
> (Authority + Edge Nodes on a disconnected network, no internet
> access, no GHCR pull-through), see
> [edge-node-air-gapped.md](edge-node-air-gapped.md) (T5). The bearer
> token flows over plain HTTP on the LAN for Phase 0; T2.2 ships
> HTTPS with an operator-trusted CA bundle.
>
> **Spec:** [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)
> **Plan:** [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](../superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md)

## What you'll have at the end

- **Host A** runs the full DPF Authority Core (portal, postgres,
  neo4j, etc.) from a normal `bash install-dpf.sh` install.
- **Host B** runs a single Edge Node container against Host A. The
  container reports its hostname, NICs, ARP table, and (in later T
  threads) ARP / nmap / SNMP collector output back to Host A.
- The Authority's admin UI shows the Edge Node enrolled with a
  non-loopback IP. Discovery rows include real LAN-side addresses.

## What you need

| Resource | Notes |
|---|---|
| Two Linux hosts on the same LAN segment | Bare-metal or VMs both fine. Must be reachable to each other (one hop, one switch). Same broadcast domain is simplest. **Not Docker Desktop** — see "Why not Docker Desktop" below. |
| Static-ish IP for Host A | DHCP is fine if Host A's reservation is stable, but a reboot that hands Host A a new IP breaks every enrolled Edge Node until you reconfigure. mDNS `.local` or DNS A record is a clean workaround. |
| NTP running on both hosts | The Authority's freshness-window check on `/api/v1/edge/discovery-runs` rejects submissions whose `observedAt` is too far from server time. Fresh VMs without NTP can drift tens of seconds. |
| `docker` + `docker compose` v2 on Host B | Native Docker Engine, NOT Docker Desktop. Install via the standard distro path (apt/dnf). |
| HR-000 / superuser login on the Authority | You need the Admin > Platform Development page to issue the bootstrap token and approve the node. |

## Why not Docker Desktop

`network_mode: host` in Docker Desktop maps the container into the
Docker Desktop VM, not into the user's machine. The container sees
the VM's interfaces, not the host's real NICs. The Edge Node would
enroll, but its `metadata.host.networkInterfaces` would describe the
VM's virtual interfaces, not the LAN topology you wanted to map.

Use a native Linux Docker Engine install for the Edge Node host.
This is the same constraint that drives `linux-host-network` profile
in the single-host overlay; in multi-host it's binding.

## Step 1 — Authority Core (Host A)

Standard DPF install. Nothing T2-specific.

```bash
# On Host A
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh
```

Wait for `curl http://localhost:3000/api/health` to return 200. Note
the URL the Authority is reachable on FROM THE LAN — not localhost.
Either:

- The host's primary LAN IP — `ip route get 1.1.1.1 | awk '{print $7; exit}'`
- An mDNS `.local` name if `avahi-daemon` is running — `hostnamectl --static`
- A DNS A record if you control DNS on the LAN

Verify from a second machine on the LAN:

```bash
# From Host B (or any LAN-attached machine)
curl -sS http://<Host-A-LAN-URL>:3000/api/health
# Should print {"ok":true,...}
```

If that fails, the firewall on Host A is probably dropping inbound 3000
— `ufw allow 3000/tcp` (Ubuntu/Debian) or `firewall-cmd --add-port=3000/tcp --permanent && firewall-cmd --reload` (Fedora/RHEL).

## Step 2 — Issue a bootstrap token (Host A)

1. Open `http://<Host-A-LAN-URL>:3000/platform/edge-nodes` in your
   browser.
2. Sign in as HR-000 / superuser.
3. Click **Issue bootstrap token**.
4. **Copy the plaintext token immediately** — it's shown exactly
   once. The token has:
   - `dpfboot_` prefix
   - 15 minute TTL by default
   - Single-use semantics — the first successful enrollment consumes
     it; a second attempt with the same token will fail with
     `token_already_consumed`.

If you fumble the copy, just issue another one — they're free.

## Step 3 — Edge Node (Host B)

You can run this from a clone of the repo (for the compose file +
env example) without running the full installer.

```bash
# On Host B
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf

# Copy the env example and fill it in
cp .env.edge-standalone.example .env
$EDITOR .env
# Set:
#   DPF_AUTHORITY_URL=http://<Host-A-LAN-URL>:3000
#   DPF_BOOTSTRAP_TOKEN=dpfboot_<paste-from-step-2>

# Bring up the Edge Node
docker compose -f docker-compose.edge-standalone.yml up -d

# Watch enrollment
docker compose -f docker-compose.edge-standalone.yml logs -f edge-node
```

Within ~10 seconds you should see:

```
... Enrolling Edge Node "<hostname>" against http://<Host-A-LAN-URL>:3000
... Enrolled as nodeId=edge_xxxxxxxx (trustState=pending). Heartbeat every 60s; sweep every 300s.
... State persisted to /var/lib/dpf-edge-node/state.json
```

`trustState=pending` is the correct state at this point. The node
has enrolled but cannot submit observations until you approve it.

## Step 4 — Approve the node (Host A)

1. Refresh `http://<Host-A-LAN-URL>:3000/platform/edge-nodes`.
2. The new node appears with `trustState=pending`.
3. Click **Approve**.
4. The node flips to `trustState=trusted`.

Per spec § Approval policy, paste-provisioned tokens always land in
`pending`. Local-host installer-issued tokens (the single-host demo
path) auto-approve; multi-host paste-provisioned tokens require this
explicit operator click. This is the friction that makes Edge Node
enrollment opt-in, not silent.

## Step 5 — First discovery run (Host B → Host A)

Within one sweep interval (default 5 minutes) the node submits its
first discovery run. Watch the logs:

```bash
docker compose -f docker-compose.edge-standalone.yml logs -f edge-node
```

You'll see something like:

```
... Sweep complete; submitting 1 items
... Discovery run accepted (runKey=...; status=201)
```

## Step 6 — Verify on the Authority (Host A)

The verification gate from
[`2026-05-12-edge-node-t2-multi-host-lan.md`](../superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md)
§ T2 scope:

```bash
# On Host A
docker compose -p dpf exec postgres psql -U dpf -d dpf <<'SQL'
-- The Edge Node row exists, trusted, recently seen
SELECT "nodeId", "displayName", "trustState", "lastSeenAt",
       "metadata"->'host'->>'ipAddresses' AS ip_addresses
FROM "EdgeNode"
ORDER BY "createdAt" DESC LIMIT 5;

-- A discovery run from this node is in
SELECT "id", "runKey", "edgeNodeId", "sourceSlug", "startedAt"
FROM "DiscoveryRun"
WHERE "edgeNodeId" IS NOT NULL
ORDER BY "startedAt" DESC LIMIT 5;

-- The discovery items include real LAN-side addresses,
-- not Docker bridge IPs (172.17.x.x / 172.18.x.x).
SELECT "name", "itemType", "rawData"->>'hostname' AS hostname,
       jsonb_path_query_array("rawData"::jsonb, '$.networkInterfaces[*].addresses[*].address')
       AS addresses
FROM "DiscoveredItem"
WHERE "itemType" = 'host'
ORDER BY "createdAt" DESC LIMIT 5;
SQL
```

**Success looks like:**

- `EdgeNode` row with `trustState=trusted`, `lastSeenAt` within 60s.
- `DiscoveryRun` row with `edgeNodeId` populated and a recent
  `startedAt`.
- `DiscoveredItem` row whose `addresses` array contains the Edge
  Node host's LAN IP (e.g. `192.168.1.42`), NOT just `127.0.0.1` or
  `172.17.0.x`.

**Failure modes and what they mean:**

| Symptom | Likely cause |
|---|---|
| Node never enrolls (logs show `ECONNREFUSED` / `EHOSTUNREACH`) | `DPF_AUTHORITY_URL` not routable from Host B. Test with `curl -sS $DPF_AUTHORITY_URL/api/health` from inside the container: `docker compose -f docker-compose.edge-standalone.yml exec edge-node sh -c 'curl -sS $DPF_AUTHORITY_URL/api/health'` |
| Node enrolls but stays in `pending` | Awaiting your **Approve** click on Host A's admin UI (Step 4). |
| Node enrolls, gets approved, but no `DiscoveryRun` shows up | First sweep is at the sweep interval (default 5 min). Check `services/edge-node/scripts/verify-lifecycle.ts` for a faster smoke test. |
| `400 stale_observation` in logs | Clock skew between hosts. Both must run NTP. `timedatectl status` on each host should show `System clock synchronized: yes`. |
| `DiscoveredItem.addresses` is `["127.0.0.1"]` only | The compose file is not using `network_mode: host`, or the host has no LAN interface up. Confirm `network_mode: host` is set in the standalone compose (it should be) and that `ip -4 addr` on Host B shows a non-loopback address. |

## File a verification report

When you've reached Step 6 with all assertions passing (or failing
with a clear cause), file a report using the
[Install verification report template](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md).

For multi-host runs, include in the report body:

- LAN topology: how many switches between Host A and Host B; same
  VLAN or routed; whether mDNS `.local` resolution worked or you
  used IP/DNS.
- Output of `docker compose -f docker-compose.edge-standalone.yml logs edge-node`
  from the first 5 minutes after `up -d`.
- The SQL output from Step 6.
- For both hosts: `bash install-dpf.sh doctor` from Host A; for
  Host B, `docker compose -f docker-compose.edge-standalone.yml exec edge-node node -e 'console.log(JSON.stringify({uname:require("os").platform(),release:require("os").release(),ifaces:require("os").networkInterfaces()},null,2))'`.

Both happy-path and failure reports are valuable. A failure report
that names the symptom and the LAN topology is more useful than no
report at all.

## Optional — upgrade the LAN path to HTTPS

The Phase 0 floor is plain HTTP with bearer tokens. On a LAN that
isn't physically isolated (any office network, any shared subnet),
the `dpfedge_*` and `dpfboot_*` tokens are sniffable. T2.2 adds an
HTTPS path with an operator-issued self-signed cert + CA bundle. The
Edge Node trusts the CA via `NODE_EXTRA_CA_CERTS`; Caddy on the
Authority host terminates TLS in front of the portal.

This step is optional but strongly recommended for anything past a
private lab.

### A — Issue the cert (Host A)

```bash
# On Host A, in the DPF repo:
bash scripts/issue-authority-tls-cert.sh --hostname dpf-authority.lan
# Add IP SANs if you also use the IP directly:
#   --hostname dpf-authority.lan --hostname 192.168.1.42
```

Output files (under `~/.dpf/tls` by default):

- `authority.crt` — the self-signed certificate (also serves as its
  own CA root)
- `authority.key` — private key (mode 0600)
- `ca-bundle.crt` — the CA cert Edge Nodes mount as `NODE_EXTRA_CA_CERTS`
- `Caddyfile` — drop-in reverse-proxy config for the TLS sidecar

### B — Start the TLS sidecar (Host A)

```bash
# Same shell where you ran issue-authority-tls-cert.sh:
export DPF_TLS_DIR="$HOME/.dpf/tls"
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d

# Verify from the LAN:
curl --cacert ~/.dpf/tls/ca-bundle.crt \
     https://dpf-authority.lan:443/api/health
# Should print {"ok":true,...}
```

If you don't have `dpf-authority.lan` in your DNS, add an
`/etc/hosts` entry on both hosts pointing at Host A's LAN IP, or
re-run the cert helper with `--hostname <IP>` and use the IP in
`DPF_AUTHORITY_URL` instead.

### C — Distribute the CA bundle (Host A → Host B)

```bash
# From Host A:
scp ~/.dpf/tls/ca-bundle.crt operator@host-b:/etc/dpf-edge/ca-bundle.crt

# Or via your config-management of choice; the CA is not secret.
```

### D — Switch Edge Node to HTTPS (Host B)

In Host B's `.env`:

```ini
DPF_AUTHORITY_URL=https://dpf-authority.lan:443
DPF_AUTHORITY_CA_CERT=/etc/dpf-edge/ca-bundle.crt
```

Bring the node up with the TLS overlay:

```bash
docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-standalone-tls.yml \
               up -d
```

Compose refuses to start if `DPF_AUTHORITY_CA_CERT` is unset under
the TLS overlay — loud failure beats silent CA-unknown HTTPS.

### E — Verify TLS is in the path

```bash
# Inside the Edge Node container:
docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-standalone-tls.yml \
               exec edge-node sh -c \
  'node -e "const c=require(\"undici\");c.request(process.env.DPF_AUTHORITY_URL+\"/api/health\").then(r=>r.body.text()).then(b=>console.log(\"ok:\",b)).catch(e=>console.error(\"err:\",e.cause?.code||e.message))"'
# Expect: ok: {"ok":true,...}
# If you see err: UNABLE_TO_VERIFY_LEAF_SIGNATURE the CA bundle isn't
# mounted; re-check DPF_AUTHORITY_CA_CERT and that the host file is
# readable by the container UID.
```

### Cert lifecycle

The default validity is 825 days (the Apple-compatible max). When
the cert nears expiry, re-run `issue-authority-tls-cert.sh --force`
on Host A; you must redistribute the new `ca-bundle.crt` to every
Edge Node host or they'll fail their next handshake. Track this in
your operational calendar — there is no auto-rotation in T2.

## Discovery scope — what gets scanned and how to control it

The Edge Node runs four collectors per sweep:

| Collector | What it does | Traffic | Cost |
|---|---|---|---|
| `host-info` | Reads `os.*` — hostname, NICs, CPU, mem | none | ~0ms |
| `arp` (C1) | Reads kernel ARP cache (`/proc/net/arp` on Linux, `arp -an` on macOS) | none — passive | ~1ms |
| `nmap-sweep` (C2) | Active `nmap -sn` ping scan of operator-allowed subnets | ARP probes (Linux + CAP_NET_RAW) or TCP connect probes | ~5–8s per /24, ~30s per /20 |
| `snmp-poll` (C3) | Per-target SNMP query of `sysName`, `sysDescr`, `sysObjectID`, `sysUpTime`, `ifNumber` | UDP/161 to operator-supplied targets only | ~30ms × target count |

The active sweep needs an operator-allowed list of subnets. By default
it auto-derives from the host's LAN-facing NIC subnets, applying a
**/20 size cap** (≤ 4096 addresses per subnet) so a misconfigured
NIC can never accidentally kick off a 65k-host scan unattended.

**Configure via env vars on the Edge Node host:**

| Env var | Default | Purpose |
|---|---|---|
| `DPF_EDGE_DISCOVERY_SUBNETS` | (auto-detect) | Comma-separated CIDR list. **Replaces** auto-detect when set. Operator-explicit opt-in — the /20 cap below does NOT apply here, so use this to intentionally scan larger networks. |
| `DPF_EDGE_DISCOVERY_MIN_CIDR_BITS` | `20` | Floor on auto-detected subnet size. Tighten (e.g. `24`) to be even safer; loosen (e.g. `16`) to auto-scan bridge nets like `docker0`. Invalid values fall back to the default. |

Examples:

```ini
# Default — auto-detect, /20 cap. Scans your LAN.
# (no env vars needed)

# Explicit operator opt-in for two specific subnets.
DPF_EDGE_DISCOVERY_SUBNETS=10.0.0.0/24,192.168.1.0/24

# Scan a /16 docker bridge net (would normally be filtered).
DPF_EDGE_DISCOVERY_MIN_CIDR_BITS=16

# Disable active sweep entirely — set the env to a bogus value
# that produces no valid CIDRs (passive ARP cache read still runs).
DPF_EDGE_DISCOVERY_SUBNETS=disabled
```

The collector emits one **subnet entity** per scanned CIDR plus one
**host entity** (`arp:<ip>` keyed) per host that responds, with
`MEMBER_OF` relationships from each host to its subnet. Hosts also
discovered via C1's ARP-cache read dedupe automatically against the
nmap results — they share the same observedKey.

Filtered subnets surface on `envelope.warnings` so the operator sees
why a subnet got skipped without grepping container logs.

### Finding nearby DPF installs (federation candidates)

Alongside the sweep, the Edge Node runs a **federation scan** every 90 seconds. It
asks each host on your segment one question — `GET /.well-known/dpf-federation.json`
— and reports back any that answer as a DPF install. That list is what the portal's
**Platform → Federation links** page offers you as a nearby peer to pair with.

It is a separate loop from the sweep on purpose: the Authority forgets a nearby
candidate after two minutes, and the sweep only runs every five.

What a peer answers with is a *setup suggestion*, never a credential. Pairing still
requires the peer's certificate to validate against your organization's root — so a
peer found here is either something you confirm by hand, or, when both installs
chain to the same organization CA, one that enrols on that evidence.

**Configure via env vars on the Edge Node host:**

| Env var | Default | Purpose |
|---|---|---|
| `DPF_FEDERATION_SCAN` | on | Set to `0`, `false`, `no`, or `off` to stop looking for peers. |
| `DPF_FEDERATION_SCAN_HOSTS` | (from the ARP cache) | Comma-separated hosts to probe. **Replaces** the ARP-cache list when set. |
| `DPF_FEDERATION_SCAN_ENDPOINTS` | `https:443,http:3000` | Comma-separated `scheme:port` pairs to try on each host — the TLS sidecar above, and a plain compose install. |
| `DPF_FEDERATION_SCAN_INTERVAL_SEC` | `90` | How often to look. |
| `DPF_FEDERATION_SCAN_MAX_TARGETS` | `256` | Probe ceiling per pass. A pass that hits it logs how many hosts it left out. |

**On Docker Desktop you must set `DPF_FEDERATION_SCAN_HOSTS`.** The container sees
only Docker's own network there (the same reason [Why not Docker
Desktop](#why-not-docker-desktop) exists), so its ARP cache never shows your LAN
and the scan has nothing to probe. Name the peers directly:

```ini
DPF_FEDERATION_SCAN_HOSTS=192.168.1.50,192.168.1.51
```

On the Linux host-network profile the ARP cache *is* your LAN, so leave it empty.

Only private and link-local addresses are probed — `10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `.local` names, and their IPv6 equivalents. A routable
address in `DPF_FEDERATION_SCAN_HOSTS` is skipped and counted in the pass log, not
dialled. The Edge Node also never reports the install it is enrolled against as a
peer.

To be found rather than to find, an install has to answer that request. Every
install does by default; set `DPF_FEDERATION_ADVERTISE=0` **on the portal** to stay
unfindable. What it answers with is a rotating id, a capability digest, the pairing
path, and the estate name — no hostname, no organization id, nothing about the
host it runs on.

### SNMP polling (C3) — discovering switches, routers, APs

C3 is the collector that closes the **T2 success bar**: "at least one
switch / gateway / non-portal-host inventory item with `osiLayer >= 2`
in the discovery results."

Where C1 + C2 find generic hosts, C3 queries specific network devices
for their identity (model, OS, port count, location) via SNMP and
records them as proper `router` / `switch` / `wireless_ap` entities.

**Configuration is opt-in.** The collector is a no-op until you place
a JSON config file on the host. Default path:
`/etc/dpf-edge/snmp.json`. Override via `DPF_EDGE_SNMP_CONFIG`.

#### Quick setup

```bash
# 1. Copy the example config from the repo.
sudo mkdir -p /etc/dpf-edge
sudo cp services/edge-node/snmp.example.json /etc/dpf-edge/snmp.json
sudo chmod 0600 /etc/dpf-edge/snmp.json

# 2. Edit it — replace the example targets with your real devices.
sudo $EDITOR /etc/dpf-edge/snmp.json

# 3. Add to your Edge Node host's .env:
DPF_EDGE_SNMP_CONFIG_HOST_PATH=/etc/dpf-edge/snmp.json

# 4. Bring the Edge Node up with the SNMP overlay layered on top of
#    your existing compose chain.

# Single-host install (Authority + Edge Node on one machine):
docker compose -f docker-compose.yml \
               -f docker-compose.linux.yml \
               -f docker-compose.edge.yml \
               -f docker-compose.edge-snmp.yml \
               up -d --force-recreate edge-node

# Multi-host install (Edge Node on its own host):
docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-snmp.yml \
               up -d edge-node
```

The `docker-compose.edge-snmp.yml` overlay refuses to start when
`DPF_EDGE_SNMP_CONFIG_HOST_PATH` is unset — same loud-failure pattern
as the TLS overlay so a missing config doesn't silently disable
inventory.

#### Config file format

```json
{
  "targets": [
    {
      "host": "192.168.1.1",
      "version": "2c",
      "community": "public",
      "port": 161,
      "timeoutMs": 5000
    },
    {
      "host": "192.168.1.2",
      "version": "3",
      "user": "dpf-readonly",
      "authProtocol": "SHA",
      "authPassword": "...",
      "privProtocol": "AES",
      "privPassword": "...",
      "port": 161,
      "timeoutMs": 5000
    }
  ]
}
```

| Field | v2c | v3 | Notes |
|---|---|---|---|
| `host` | required | required | IP or DNS name reachable from the Edge Node container |
| `version` | `"2c"` | `"3"` | |
| `community` | required | — | Shared community string |
| `user` | — | required | SNMPv3 USM user |
| `authProtocol` | — | `"MD5"` or `"SHA"` | Prefer SHA |
| `authPassword` | — | required | |
| `privProtocol` | — | `"DES"` or `"AES"` | Prefer AES |
| `privPassword` | — | required | |
| `port` | optional, default `161` | optional, default `161` | |
| `timeoutMs` | optional, default `5000` | optional, default `5000` | 100..60000 |

Targets that fail validation are skipped with a warning on the next
sweep's `envelope.warnings`. The collector continues with the
remaining valid targets — one bad config row never disables the rest.

#### Security guidance

- **Read-only SNMP communities / users.** The Edge Node only issues
  `snmpget` (never `snmpset`); configure the device to enforce
  read-only at the protocol level so a compromised Edge Node can't
  reconfigure your network.
- **`chmod 0600`.** SNMPv3 auth and priv passwords live in this file.
  The collector emits a warning on the next sweep if the file is
  group-readable (mode 0640+); fix with `chmod 0600`. The collector
  reads the file regardless — the warning is informational, not a
  refusal, so a too-tight perms enforcement doesn't accidentally take
  inventory off.
- **SNMPv3 over SNMPv2c when possible.** v2c community strings are
  sniffable on the wire. Use v2c only on LANs you control end-to-end
  or behind a VPN; use v3 everywhere else.
- **Limit by source IP at the device.** Most managed switches let you
  ACL SNMP to specific source IPs. Point them at the Edge Node's
  LAN IP only — same defense-in-depth idea as "API key + IP allow-
  list."

#### What gets emitted

Per responding target:

- One `snmp:<ip>` item — `itemType = router | switch | wireless_ap | network_device` (classified from `sysDescr`), `confidence = 0.95`, `rawData` includes `sysName`, `sysDescr`, `sysObjectID`, `sysUpTimeTicks`, `interfaceCount`, `vendorOidPrefix` (e.g. `1.3.6.1.4.1.9` for Cisco).
- One `SAME_AS` relationship from `snmp:<ip>` → `arp:<ip>`. If C1 or C2 also discovered that IP, this edge lets the Authority's normalization treat them as the same physical device.
- Per-OID failure warnings — partial inventory is still useful, so a target that responds to `sysName` but blocks `sysObjectID` still produces an entity.

## What's deferred

- **Freshness tolerance configuration** — T2.3 will add an explicit
  env knob and document NTP as a hard prerequisite.
- **Surfacing IP / hostname in the admin UI list** — T2.4. For now,
  the address shows up in `EdgeNode.metadata`; the admin UI lists
  the row but doesn't render the address field yet. Query the DB
  to confirm enrollment topology, as the SQL in Step 6 shows.
- **mTLS** — T4. T2.2's floor is bearer-over-HTTPS with an
  operator-trusted CA. Mutual auth where the Edge Node holds a
  client cert and the Authority verifies it is a future iteration.
- **Auto-rotation** — T4 area. The current cert helper is a one-shot
  generator; rotation is a manual re-run + redistribute.
- **Air-gapped** — T5.
- **macOS / Windows native binaries** — T3.

## Cross-references

- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)
- T2 gap list: [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](../superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md)
- Phase 0 single-host runbook: [`docs/install/verification-runbook.md § 7 — DPF Edge Node enrollment`](verification-runbook.md#7-dpf-edge-node-enrollment)
- Single-host overlay compose: [`docker-compose.edge.yml`](../../docker-compose.edge.yml)
- Standalone compose: [`docker-compose.edge-standalone.yml`](../../docker-compose.edge-standalone.yml)
- TLS overlay for standalone: [`docker-compose.edge-standalone-tls.yml`](../../docker-compose.edge-standalone-tls.yml)
- Authority TLS sidecar overlay: [`docker-compose.tls.yml`](../../docker-compose.tls.yml)
- Cert helper: [`scripts/issue-authority-tls-cert.sh`](../../scripts/issue-authority-tls-cert.sh)
- Env example: [`.env.edge-standalone.example`](../../.env.edge-standalone.example)
