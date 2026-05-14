# Edge Node Air-Gap Verification Report — Template

> Fill in this template after running
> [`scripts/verify-edge-node-air-gap.sh --mode soak`](../../scripts/verify-edge-node-air-gap.sh).
> The completed report is the artifact that closes the *"air-gap
> behavior"* maturity gate (spec §
> [Maturity gates before implementation](../superpowers/specs/2026-05-09-dpf-edge-node-design.md))
> for a specific release tag in a specific environment.
>
> One report per `DPF_IMAGE_TAG` × environment. Archive in
> `docs/install/verification-reports/` (or wherever your org keeps
> release evidence). Replace this banner with the run's metadata
> before committing.

## Environment

| Field | Value |
|---|---|
| Report ID | `air-gap-<env>-<DPF_IMAGE_TAG>-<YYYY-MM-DD>` |
| `DPF_IMAGE_TAG` under test | e.g. `v0.4.0` |
| Edge Node version | output of `docker compose exec edge-node node -e 'console.log(require("./package.json").version)'` |
| Authority host | hostname / IP, OS, kernel |
| Edge Node host | hostname / IP, OS, kernel |
| Network topology | one-line description; e.g. "two VMs on a host-only vSwitch, no NAT, no DNS forwarder" |
| Internal CA in use | `ca-bundle.crt` SHA-256: `<paste output of sha256sum>` |
| Authority freshness windows | `DPF_EDGE_FRESHNESS_PAST_SEC=<value>`, `DPF_EDGE_FRESHNESS_FUTURE_SEC=<value>` |
| NTP source | hostname / IP of the internal NTP server |
| Operator | name / handle |
| Start (ISO 8601) | `YYYY-MM-DDTHH:MM:SS±HH:MM` |
| End (ISO 8601) | `YYYY-MM-DDTHH:MM:SS±HH:MM` |
| Duration | seconds / hours |

## Image manifest under test

Paste the output of `cat images-manifest.txt` from Stage 1 § Step 1.1
of the runbook here:

```
ghcr.io/opendigitalproductfactory/dpf-portal:v0.4.0@sha256:...
ghcr.io/opendigitalproductfactory/dpf-edge-node:v0.4.0@sha256:...
postgres:16-alpine@sha256:...
...
```

Tamper-evidence:
- `dpf-images.tar` SHA-256: `<paste output of sha256sum dpf-images.tar>`
- `dpf-air-gap-bundle.tar.gz` SHA-256: `<paste output>`

## Authority outage schedule executed

| Authority action | T+ | Wall-clock | Notes |
|---|---|---|---|
| Start (Authority online) | 0 | `YYYY-MM-DDTHH:MM` | |
| `docker compose stop portal` | 1 h | `YYYY-MM-DDTHH:MM` | |
| `docker compose start portal` | 3 h | `YYYY-MM-DDTHH:MM` | |
| `docker compose stop portal` | 6 h | `YYYY-MM-DDTHH:MM` | |
| `docker compose start portal` | 12 h | `YYYY-MM-DDTHH:MM` | |
| End (Authority online) | 24 h | `YYYY-MM-DDTHH:MM` | |

Adjust to match the actual schedule executed. If the schedule
deviated from the plan (e.g. an unexpected outage), note that here.

## Verification harness output

Attach the `--report` output from the harness script:

```
<paste contents of the script's report file here, or include as a
linked file alongside this report>
```

Headline:
- Egress hits: `<N>` (PASS at `0`, FAIL otherwise)
- iptables chain installed: `<yes|no>`
- Log source: `<kern.log path or "journalctl -k">`

## Postgres counts (Authority side)

Run on Host A before and after the soak:

```sql
SELECT
  (SELECT count(*) FROM "EdgeNode") AS edge_nodes,
  (SELECT count(*) FROM "EdgeNode" WHERE "trustState" = 'trusted') AS trusted_nodes,
  (SELECT count(*) FROM "DiscoveryRun" WHERE "edgeNodeId" IS NOT NULL) AS edge_node_runs,
  (SELECT count(*) FROM "DiscoveredItem"
    JOIN "DiscoveryRun" ON "DiscoveredItem"."discoveryRunId" = "DiscoveryRun"."id"
    WHERE "DiscoveryRun"."edgeNodeId" IS NOT NULL) AS edge_node_items;
```

| Metric | Before | After | Delta |
|---|---|---|---|
| `EdgeNode` rows | | | |
| `EdgeNode.trustState = 'trusted'` | | | |
| `DiscoveryRun WHERE edgeNodeId IS NOT NULL` | | | |
| `DiscoveredItem` via Edge Node | | | |

Expected: positive deltas on runs / items proportional to the number
of online-window sweep intervals; `EdgeNode` rows unchanged; trusted
count unchanged.

## Edge Node-side replay evidence

Run on Host B after the soak:

```bash
docker compose -f docker-compose.edge-standalone.yml \
               -f docker-compose.edge-standalone-tls.yml \
               logs --no-color edge-node \
  | grep -E "Sweep (transient failure|dropped|buffer full)|Discovery run submitted|node_revoked" \
  | tee edge-node-soak-log.txt
```

Summary counts (run after the grep above):

| Log signal | Count | Meaning |
|---|---|---|
| `Sweep transient failure ... Queueing.` | | Per-failure retry queueing during Authority outages. |
| `Discovery run submitted` | | Successful submissions. |
| `Sweep dropped (HTTP 4xx ...)` | | Client-side rejections (e.g. stale_observation). Expect zero in a healthy run. |
| `Sweep buffer full ... dropped oldest` | | Drop-oldest fires. Expect zero unless your soak exceeded the ~83 h buffer ceiling at default settings. |
| `node_revoked` | | Operator-initiated revocation. Expect zero in a healthy soak. |

## EdgeNode liveness

```sql
-- Run multiple times during the soak (or once at end with a long
-- enough lookback) to confirm lastSeenAt advanced through the
-- online windows.
SELECT "nodeId", "displayName", "trustState",
       "lastSeenAt", "createdAt",
       NOW() - "lastSeenAt" AS staleness
FROM "EdgeNode"
ORDER BY "createdAt" DESC LIMIT 5;
```

Expected: `staleness` < `(heartbeatIntervalSec * 2)` during online
windows; bounded growth equal to the outage length during offline
windows; back to normal after each Authority restart.

## Pass / fail verdict

- [ ] Egress hits = 0 across the entire soak window.
- [ ] `EdgeNode.lastSeenAt` advanced through each online window.
- [ ] `DiscoveryRun` rows increased monotonically through online
      windows; no `DiscoveryRun` rows attributed to the Edge Node
      have `startedAt` outside the soak window.
- [ ] No `Sweep dropped` log entries for `error=stale_observation`
      (would indicate clock drift between hosts).
- [ ] `EdgeNode.trustState` ended the run as `trusted`.
- [ ] Image manifest under test matches Stage 1's pinned digests
      (no drift across the soak).
- [ ] Tamper-evidence SHAs match the staging workstation's outputs.

**Overall verdict:** PASS / FAIL

**If FAIL:** which checks failed, what the operator did to
investigate, what the root cause was, and whether the runbook /
spec / code needs to change. File a backlog item if so.

## Operator sign-off

| | |
|---|---|
| Operator | |
| Date | |
| Signature / org credential | |
