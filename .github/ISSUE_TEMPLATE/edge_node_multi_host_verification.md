---
name: Edge Node multi-host LAN verification report
about: Ran a DPF Edge Node on a second host across a real LAN? Tell us how it went.
title: "Edge Node multi-host verification — "
labels: ["install-verification", "edge-node", "community-report"]
assignees: []
---

<!-- Thank you for verifying the DPF Edge Node across a real LAN!
     This template is for the T2 multi-host scenario specifically —
     Authority Core on Host A, Edge Node on a different physical or
     virtual Host B, separated by at least one switch.

     If you ran the single-host demo (Authority + Edge Node on the
     same machine) please use the install_verification.md template
     instead — that's a different verification ledger row.

     Both happy-path and failure reports are valuable. Fill in what
     you can; leave the rest. -->

## LAN topology

**Authority host (Host A):**
- Hardware / VM: <!-- e.g. NUC i7, Debian 12; or AWS t3.medium, Ubuntu 22.04 -->
- LAN reachability: <!-- e.g. dpf-authority.lan via mDNS / 192.168.1.42 static / 10.0.0.5 DHCP reservation -->

**Edge Node host (Host B):**
- Hardware / VM: <!-- e.g. Raspberry Pi 5, Debian 12; or Hyper-V guest, Ubuntu 22.04 -->
- LAN reachability: <!-- e.g. edge-warehouse-2.lan via DHCP -->

**Between them:**
- Number of switches: <!-- 1 / 2 / "same broadcast domain" -->
- Cross-segment / VLAN: <!-- yes / no -->
- Firewall between hosts: <!-- yes / no -->
- Authority port reachable from Host B: `curl -sS http://<host-a>:3000/api/health` → <!-- 200 / connection refused / timeout -->

## Versions

```
# On Host A
bash install-dpf.sh doctor 2>&1 | grep -E "Installer version|Portal version|Docker version" | head -3

# On Host B
docker --version
docker compose version
docker compose -f docker-compose.edge-standalone.yml exec edge-node node -v
```

<details>
<summary>Version output</summary>

```
<paste here>
```

</details>

## Path taken

- [ ] **HTTP path** (Phase 0 floor): `DPF_AUTHORITY_URL=http://...:3000`
- [ ] **HTTPS path** (T2.2): `DPF_AUTHORITY_URL=https://...:443` with CA bundle from `scripts/issue-authority-tls-cert.sh`

## T2 verification checklist

The full runbook lives at
[`docs/install/edge-node-multi-host.md`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/install/edge-node-multi-host.md).
Tick what you observed working.

**Step 1 — Authority Core preflight (Host A):**
- [ ] `curl http://<host-a-lan-url>:3000/api/health` returns 200 **from Host B** (not just from Host A)
- [ ] Firewall on Host A allows the inbound port

**Step 2 — Bootstrap token (Host A):**
- [ ] Issued a bootstrap token via `/platform/edge-nodes` → "Issue bootstrap token"
- [ ] Copied the plaintext within the 15min TTL

**Step 3 — Edge Node bring-up (Host B):**
- [ ] Cloned the repo / copied `docker-compose.edge-standalone.yml` and `.env.edge-standalone.example`
- [ ] Set `DPF_AUTHORITY_URL` to the routable URL (NOT `localhost`, NOT `host.docker.internal`)
- [ ] `docker compose -f docker-compose.edge-standalone.yml up -d` succeeded
- [ ] Logs show `Enrolling Edge Node "<hostname>" against http(s)://...`
- [ ] Logs show `Enrolled as nodeId=edge_xxxxxxxx (trustState=pending)` within ~10s

**Step 4 — Operator approval (Host A):**
- [ ] New node appears in `/platform/edge-nodes` with `trustState=pending`
- [ ] Clicked **Approve** — node flipped to `trustState=trusted`

**Step 5 — First discovery run:**
- [ ] Within one sweep interval (default 5 min), logs show `Discovery run accepted`
- [ ] No `stale_observation` 400s in logs (if there are, your hosts need NTP — see runbook § Clock sync prerequisite)

**Step 6 — Verify on Authority (Host A) SQL:**

The verification gate from `2026-05-12-edge-node-t2-multi-host-lan.md` § T2 scope:

```sql
-- Run on Host A:
--   docker compose -p dpf exec postgres psql -U dpf -d dpf

-- T2.4 admin UI surface — IP / hostname in metadata.host
SELECT
  e."nodeId",
  p."displayName",
  e."trustState",
  e."lastSeenAt",
  e."metadata"->'host'->>'hostname' AS host_hostname,
  jsonb_path_query_array(e."metadata"::jsonb, '$.host.ipAddresses[*]') AS host_ips
FROM "EdgeNode" e
JOIN "Principal" p ON p.id = e."principalId"
ORDER BY e."createdAt" DESC LIMIT 5;

-- Attribution check — DiscoveryRun has edgeNodeId
SELECT id, "runKey", "edgeNodeId", "sourceSlug", "startedAt"
FROM "DiscoveryRun"
WHERE "edgeNodeId" IS NOT NULL
ORDER BY "startedAt" DESC LIMIT 5;

-- Real LAN address landed (not bridge IP)
SELECT
  "name",
  "rawData"->>'hostname' AS hostname,
  jsonb_path_query_array("rawData"::jsonb, '$.networkInterfaces[*].addresses[*].address')
    AS addresses
FROM "DiscoveredItem"
WHERE "itemType" = 'host'
ORDER BY "createdAt" DESC LIMIT 5;
```

Tick what you saw:

- [ ] `EdgeNode` row with `trustState=trusted`, `lastSeenAt` within 60s
- [ ] `host_hostname` is the actual Host B hostname (not the container name)
- [ ] `host_ips` includes Host B's real LAN IP (e.g. `192.168.1.42`), NOT `127.0.0.1` and NOT a Docker bridge IP like `172.17.x.x`
- [ ] `DiscoveryRun` row has `edgeNodeId` populated, `sourceSlug` matches `edge-node:<nodeId>`
- [ ] `DiscoveredItem` of `itemType='host'` includes the LAN IP in its `rawData.networkInterfaces[*].addresses[*].address` list
- [ ] **At least one switch / gateway / non-portal-host item with `osiLayer >= 2`** appears in the discovery results — the T2 success bar from the gap-list doc

**Audit chain spot check:**

```sql
-- Every edge route invocation should produce a ToolExecution row.
SELECT "toolName", "executionMode",
       "parameters"->>'nodeId' AS nodeId,
       "result"->>'status' AS status,
       success
FROM "ToolExecution"
WHERE "executionMode" = 'edge-rest'
ORDER BY "createdAt" DESC LIMIT 10;
```

- [ ] At least one `success=true` row per route exercised
- [ ] If you exercised failure paths (bad token, oversized body, stale clock): the corresponding 401 / 413 / 400 / 429 rows are present

## Surprises and papercuts

<!-- Anything unexpected. The runbook said X; what happened was Y.
     "I had to do Z which wasn't in the docs." Failure reports are
     valuable — name the symptom and the LAN topology. -->

## Doctor bundle

Run on **Host A**:

```bash
bash install-dpf.sh doctor
# → ~/.dpf/doctor-<timestamp>.tar.gz
```

Drag-and-drop the tarball into this issue. Secrets are auto-redacted.

For **Host B** (no full installer; capture an Edge-Node-only fingerprint):

```bash
docker compose -f docker-compose.edge-standalone.yml exec edge-node \
  node -e 'console.log(JSON.stringify({
    uname: require("os").platform(),
    release: require("os").release(),
    hostname: require("os").hostname(),
    ifaces: require("os").networkInterfaces(),
  }, null, 2))' > /tmp/edge-host-fingerprint.json
docker compose -f docker-compose.edge-standalone.yml logs --tail=200 edge-node \
  > /tmp/edge-node.log
tar -czf /tmp/edge-host-bundle.tar.gz \
  /tmp/edge-host-fingerprint.json /tmp/edge-node.log
```

Attach `/tmp/edge-host-bundle.tar.gz` from Host B as well.

## What would have made this easier

<!-- Free-text for the kind of small wins that aren't bug reports
     but would have saved you 20 minutes. Example: "The runbook
     could have noted that ufw blocks 3000/tcp by default on Debian."
     -->
