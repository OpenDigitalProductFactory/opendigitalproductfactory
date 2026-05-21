# UniFi Adapter — Operator Setup

The UniFi adapter pulls topology from a local UniFi Network controller and submits it through the same discovery pipeline the rest of the edge node uses. After setup, the topology view shows your real network — gateway → switches → access points — **plus** every connected client (Amazon Echos, Reolink cameras, phones, IoT devices) with vendor labels, all hanging off the AP or switch they're actually connected through.

This page covers Slices A + B: read-only discovery of UniFi-managed devices AND the WiFi/wired clients the controller has authenticated. Per-port throughput, LLDP, and the metrics channel land in a follow-up.

## What you need

- An enrolled DPF Edge Node (`docker-compose.edge.yml` overlay running; trustState=trusted in **Admin > Platform Development > Edge Nodes**).
- A UniFi Network controller reachable from the host the edge node runs on — UDM, UDM-Pro, UDR, UCG, or a hosted Network Application instance.
- UniFi Network **9.0+** (or UniFi OS **4.0+**). Earlier versions don't expose the API-key surface this adapter uses.

## Step 1 — Generate an API key in the controller

1. Open the UniFi controller UI.
2. Go to **Settings → Control Plane → Integrations**. On older firmware this is **Settings → System → API**.
3. Click **Create New** under API Keys. Name it something like `dpf-edge-node`.
4. Copy the key once — it isn't shown again. Treat it like a password.

The adapter calls `GET /proxy/network/api/s/{site}/stat/device`, so the key needs read access to the Network application. Read-only keys are sufficient.

## Step 2 — Place the adapter config on the host

Create `/etc/dpf-edge/adapters.json` on the host running the edge node container, with mode `0600`:

```json
{
  "unifi": {
    "controllerUrl": "https://192.168.1.1",
    "apiKey": "PASTE-YOUR-API-KEY-HERE",
    "site": "default",
    "tlsInsecure": false
  }
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `controllerUrl` | yes | Full URL to the controller. UDM/UDM-Pro: `https://<gateway-ip>`. Hosted Network: `https://unifi.ui.com` won't work for Slice A — local LAN only. |
| `apiKey` | yes | From Step 1. |
| `site` | no | Site slug, default `default`. Multi-site installs: check **Settings → System** for the slug. |
| `tlsInsecure` | no | Default `false`. Set `true` if your controller uses a self-signed cert (common on UDM-Pro), but only if you trust the local network — TLS verification is skipped when this is on. |

The file must be readable by UID `10001` (the edge-node container user) or the same group. Mode `0600` works if you `chown 10001 /etc/dpf-edge/adapters.json` first; or `0640` with a group the container is in. A world-readable file works too but the edge node will log a warning every sweep.

## Step 3 — Bind-mount the file into the container

Add to your local `.env`:

```bash
DPF_EDGE_ADAPTERS_CONFIG=/etc/dpf-edge/adapters.json
```

…or override the path explicitly via env. Either way, the file needs to be inside the edge-node container. The simplest mount is to add a `volumes:` entry to `docker-compose.edge.yml` in a local override:

```yaml
services:
  edge-node:
    volumes:
      - /etc/dpf-edge:/etc/dpf-edge:ro
```

Drop that into a `docker-compose.override.yml` next to the main compose file, or paste it directly into `docker-compose.edge.yml` if you don't mind editing the checked-in file.

## Step 4 — Recreate the container

```bash
docker compose -f docker-compose.yml -f docker-compose.edge.yml \
  up -d --no-deps --force-recreate edge-node
```

The adapter runs on every sweep tick (default 5 minutes). To verify it picked the config up immediately:

```bash
docker compose logs edge-node --tail 50
```

…look for a line like `Discovery run submitted: runKey=<uuid> items=<N>` where `N` is now larger than before. The first sweep after restart submits items but the topology view may take a tick or two to project them into Neo4j.

## What the adapter emits

### UniFi-managed devices (Slice A — `/stat/device`)

| UniFi `type` | DPF `itemType` | OSI layer |
|---|---|---|
| `usw` (switch) | `switch` | 2 |
| `uap` (access point) | `access_point` | 2 |
| `ugw` / `udm` / `udmpro` / `uxg` (gateway) | `gateway` | 3 |
| anything else | `network_device` | 2 |

For every UniFi device:
- An `ObservationItem` keyed `unifi:<mac>` with model, IP, firmware, state, etc. in `rawData`.
- A `SAME_AS` relationship to `arp:<ip>` so the Authority's normalization can collapse the two records into one canonical Configuration Item.
- A `HOSTS` relationship from each device to its uplink parent (gateway → switch → AP).

### Connected clients (Slice B — `/stat/sta`)

For every authenticated WiFi or wired client (your phones, laptops, Amazon Echos, Reolink cameras, smart switches, etc.):
- An `ObservationItem` keyed `arp:<ip>` — same key the local ARP collector uses, so observations dedupe on the Authority side regardless of which collector sees the device first.
- Display name preference: operator-set name in the UniFi UI ("Mark's iPhone") → DHCP hostname → `<short-vendor> <ip>` (e.g. "Amazon 192.168.0.49") → generic `LAN Host <ip>`.
- `rawData.vendor` / `vendorOui` / `vendorShort` from the bundled IEEE OUI registry — same enrichment the local ARP collector applies.
- For WiFi clients: `rawData.apMac`, `essid`, `channel`, `radio`, `signal`, `rssi`, `noise`. Higher confidence (`0.9`) than local ARP entries (`0.7`) because UniFi has authenticated the client, not just learned a kernel neighbor entry.
- For wired clients: `rawData.swMac`, `swPort`.
- A `MEMBER_OF` relationship from each client (`arp:<ip>`) to the UniFi-managed device it connects through (`unifi:<ap-or-switch-mac>`) — this is what makes the topology view draw "this Echo hangs off this AP" edges.

### Independent failure handling

The two endpoints are fetched in parallel and their errors are isolated. If `/stat/sta` returns 503 but `/stat/device` succeeds, the device items still flow and only one warning is emitted. Same the other way. A single endpoint failure never blocks the other.

The topology view treats all of these the same way as any other discovered CI, so they show up in the Subnet View, the Network View, and the impact-blast-radius traversal automatically.

## Troubleshooting

**No new items appear after a sweep.** Run `docker compose logs edge-node --tail 100 | grep -i unifi`. Common causes:
- `network error reaching ...` — the container can't reach the controller. Check `DPF_EDGE_DISCOVERY_SUBNETS` doesn't exclude the controller's subnet, and that the host's network mode permits the call.
- `HTTP 401` — API key is wrong or revoked. Re-generate in Step 1.
- `HTTP 404` — the controller version doesn't expose `/proxy/network/api/...`. You're likely on UniFi OS 3.x; upgrade or wait for the cookie-auth slice.
- `controller response was not JSON` — the controller served the login page. Means the API key isn't being honored; double-check the key wasn't truncated when copying.

**`group/world-readable` warning every sweep.** `chmod 0600 /etc/dpf-edge/adapters.json && chown 10001 /etc/dpf-edge/adapters.json`. The warning is informational only — the adapter still runs.

**TLS warning.** If you intentionally need `tlsInsecure: true`, that's fine for a closed LAN. Don't enable it across the public internet.

## What's NOT in this slice

| Feature | Tracked by |
|---|---|
| Per-port `rx/tx` throughput metrics | The full spec at [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) — needs the `metrics.network` capability + the `/api/v1/edge/metrics` endpoint, neither of which exist yet. |
| LLDP-derived L2 wiring | Same spec, § 4.2 — separate collector. |
| WebSocket event-driven sweep on client/device join | Same spec, § 4.3 — both slices poll on the regular sweep cadence (5 min). |
| Cookie-auth for pre-9.0 controllers | If you need this, open an issue with your controller version and we'll add the auth fallback. |

## Reference

- Spec: [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) § 4.3
- Code: [`services/edge-node/src/collectors/unifi.ts`](../../services/edge-node/src/collectors/unifi.ts), [`services/edge-node/src/collectors/adapters-config.ts`](../../services/edge-node/src/collectors/adapters-config.ts)
