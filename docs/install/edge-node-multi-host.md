# DPF Edge Node — Multi-Host LAN Installation

> **Status:** T2 — multi-host real-LAN deployment. Phase 0
> ([2026-05-12-edge-node-phase0-roadmap.md](../superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md))
> covers single-host (Authority + Edge Node on the same machine).
> This document covers the next step: Authority on Host A, Edge Node
> on Host B, separated by at least one real switch.
>
> **What this is not:** macOS / Windows native binary install (T3),
> mTLS hardening (T4), or air-gapped deployment (T5). The bearer
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

## What's deferred

- **HTTPS + CA bundle** — T2.2 will document operator-issued
  self-signed certs and `NODE_EXTRA_CA_CERTS` on the Edge Node.
  Until then, bearer tokens flow over plain HTTP; treat the LAN as
  a trust boundary.
- **Submission freshness tolerance configuration** — T2.3 will add
  an explicit env knob and document NTP as a hard prerequisite.
- **Surfacing IP / hostname in the admin UI list** — T2.4. For now,
  the address shows up in `EdgeNode.metadata`; the admin UI lists
  the row but doesn't render the address field yet. Query the DB
  to confirm enrollment topology, as the SQL in Step 6 shows.
- **mTLS** — T4. The Phase 0 + T2 floor is bearer-over-HTTPS with
  an operator-trusted CA. Mutual auth where the Edge Node holds a
  client cert is a future iteration.
- **Air-gapped** — T5.
- **macOS / Windows native binaries** — T3.

## Cross-references

- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)
- T2 gap list: [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](../superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md)
- Phase 0 single-host runbook: [`docs/install/verification-runbook.md § 7 — DPF Edge Node enrollment`](verification-runbook.md#7-dpf-edge-node-enrollment)
- Single-host overlay compose: [`docker-compose.edge.yml`](../../docker-compose.edge.yml)
- Standalone compose: [`docker-compose.edge-standalone.yml`](../../docker-compose.edge-standalone.yml)
- Env example: [`.env.edge-standalone.example`](../../.env.edge-standalone.example)
