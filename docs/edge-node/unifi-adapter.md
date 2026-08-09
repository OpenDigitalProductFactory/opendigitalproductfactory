# UniFi Adapter — Operator Setup

The UniFi adapter pulls topology from a local UniFi Network controller and feeds it into the same discovery pipeline the rest of the edge node uses. After setup, the topology view shows your real network — gateway → switches → access points — **plus** every connected client (Amazon Echos, Reolink cameras, phones, IoT devices) with vendor labels, all hanging off the AP or switch they're actually connected through.

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

The adapter calls `GET /proxy/network/api/s/{site}/stat/device` and `GET /proxy/network/api/s/{site}/stat/sta`, so the key needs read access to the Network application. Read-only keys are sufficient.

## Step 2 — Add the connection in the portal

1. Open **Platform → Tools → Estate Discovery** (`/platform/tools/discovery`).
2. Click **Review & Connect** on the identified gateway tile. DPF ranks canonical gateway inventory by its network address, manufacturer, model, discovery source, and confidence. When one usable gateway matches the detected network route, it is selected automatically; when several are plausible, choose the named device deliberately.
3. Review the identified device and fill in:
   - **Discovery Method**: `Ubiquiti UniFi`
   - **Site**: `default` (or the slug from your UniFi UI for multi-site installs)
   - **Gateway**: the device identity and endpoint come from discovery evidence; there is no URL to type in the normal path.
   - **API Key**: paste the value from Step 1.
   - **Allow self-signed controller certificate**: enable only for a trusted closed LAN when the UniFi appliance uses its factory/self-signed certificate.
4. Click **Save & Test**. The portal:
   - Encrypts the key with AES-256-GCM (`CREDENTIAL_ENCRYPTION_KEY`) and stores the ciphertext in the `DiscoveryConnection` table.
   - Calls the controller once to verify the key works.
   - Flips status to `active` on success, or reports `auth_failed` / `unreachable` / `tls_error` with the failure reason.

That's it. No file on disk, no bind mount, no container restart needed.

If discovery cannot identify the correct device, expand **Enter a gateway manually**. Enter a host or IP address; `http://`, `https://`, and an optional port are accepted and normalized to the canonical HTTPS endpoint. Paths, credentials, non-HTTP schemes, control characters, and unsafe targets are rejected with field-specific guidance while preserving the value for correction. Manual entry is recovery, not the primary setup path. Hosted Network (`unifi.ui.com`) is not supported here; this adapter targets the physical network reachable from the portal host.

## Step 3 — The edge node picks it up automatically

Every sweep tick (default 5 minutes) the edge node calls `GET /api/v1/edge/adapters` with its node token. The portal returns every `active` UniFi DiscoveryConnection row with its `apiKey` decrypted server-side. The edge node then polls each controller and submits the results through the existing `/api/v1/edge/discovery-runs` channel.

To verify the next sweep picked the connection up:

```bash
docker compose logs edge-node --tail 50
```

…look for `Discovery run submitted: runKey=<uuid> items=<N>` where `N` jumps up after you saved the connection.

## Editing or rotating the key

The connection row on `/platform/tools/discovery` has per-row **Re-test**, **Edit**, and **Delete** buttons:

- **Re-test** — runs the one-shot probe against the controller and updates `lastTestStatus`.
- **Edit** — opens the form with the linked gateway identity and site pre-filled; leave the API key field blank to keep the existing ciphertext, or paste a new value to rotate. Endpoint changes remain available under manual recovery.
- **Delete** — removes the row (with a confirmation step). The edge node's next sweep will see it's gone and stop polling that controller.

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

**Status stuck at `auth_failed` after Save & Test.** The portal couldn't authenticate with the controller using the key you pasted.
- Check the key wasn't truncated when copying — paste it into a plain-text scratch space first and verify the length.
- Re-generate in the UniFi UI; rotate via the **Edit** button.
- Try **Re-test** — sometimes the controller momentarily 401s during an upgrade.

**Status `unreachable`.** The portal container can't reach the controller IP. Check the controller is on the same network the portal can route to, and that no firewall blocks the HTTPS port.

**Status `tls_error`.** Common on UDM-Pro home installs with self-signed certs. Edit the connection, enable **Allow self-signed controller certificate** for the trusted closed LAN, then click **Save & Test** again. Keep it disabled for hosted/public controllers and prefer installing a trusted certificate when available.

**No new items appear after a sweep.** Run `docker compose logs edge-node --tail 100 | grep -i unifi`. Common causes:
- The edge node's `fetchAdapters` call failed — log line `adapters: fetch failed (...)` tells you why (token mismatch, portal unreachable, etc.).
- HTTP 404 on the UniFi side — the controller version doesn't expose `/proxy/network/api/...`. You're likely on UniFi OS 3.x; upgrade or wait for the cookie-auth slice.
- `controller response was not JSON` — the controller served the login page. The API key isn't being honored; rotate it.

## What's NOT in this slice

| Feature | Tracked by |
|---|---|
| Per-port `rx/tx` throughput metrics | The full spec at [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) — needs the `metrics.network` capability + the `/api/v1/edge/metrics` endpoint, neither of which exist yet. |
| LLDP-derived L2 wiring | Same spec, § 4.2 — separate collector. |
| WebSocket event-driven sweep on client/device join | Same spec, § 4.3 — both slices poll on the regular sweep cadence (5 min). |
| Cookie-auth for pre-9.0 controllers | If you need this, open an issue with your controller version and we'll add the auth fallback. |
| Multi-node routing (`targetEdgeNodeId`) | BI-35de9ce8 follow-up. Today every trusted edge node polls every active UniFi controller. Single-node installs Just Work; multi-node installs see duplicate idempotent work until the column lands. |

## Reference

- Spec: [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) § 4.3
- Code: [`services/edge-node/src/collectors/unifi.ts`](../../services/edge-node/src/collectors/unifi.ts), [`apps/web/app/api/v1/edge/adapters/route.ts`](../../apps/web/app/api/v1/edge/adapters/route.ts)
