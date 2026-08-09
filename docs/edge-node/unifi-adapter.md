# UniFi Adapter — Operator Setup

The UniFi adapter pulls topology from a local UniFi Network controller and feeds it into the same discovery pipeline the rest of the edge node uses. After setup, the topology view shows your real network — gateway → switches → access points — **plus** every connected client (Amazon Echos, Reolink cameras, phones, IoT devices) with vendor labels, all hanging off the AP or switch they're actually connected through.

The native Go edge node is the production collection owner. It uses UniFi's official local Network API first, with a bounded fallback to the older site API only when the controller explicitly reports that the official route is unsupported. The portal collector exists only for **Save & Test** and operator-triggered one-shot reruns; it is not a second scheduled collector.

## What you need

- An enrolled DPF Edge Node (`docker-compose.edge.yml` overlay running; trustState=trusted in **Admin > Platform Development > Edge Nodes**).
- A UniFi Network controller reachable from the host the edge node runs on — UDM, UDM-Pro, UDR, UCG, or a hosted Network Application instance.
- UniFi Network **9.0+** (or UniFi OS **4.0+**). Earlier versions don't expose the API-key surface this adapter uses.

## Step 1 — Generate an API key in the controller

1. Open the UniFi controller UI.
2. Go to **Settings → Control Plane → Integrations**. On older firmware this is **Settings → System → API**.
3. Click **Create New** under API Keys. Name it something like `dpf-edge-node`.
4. Copy the key once — it isn't shown again. Treat it like a password.

The adapter calls the read-only routes under `/proxy/network/integration/v1`: sites, site devices, device details, and—when enabled—connected clients. The key needs read access to the Network application. Read-only keys are sufficient.

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
   - Sets `active` only when managed devices are returned without warnings. A reachable API that returns zero devices is `degraded`, never a successful green test. Authentication, reachability, and TLS failures retain their specific operator guidance.

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

### UniFi-managed devices (official sites/devices/device-details routes)

| UniFi `type` | DPF `itemType` | OSI layer |
|---|---|---|
| switching feature | `switch` | 2 |
| access-point feature | `access_point` | 2 |
| gateway feature | `gateway` / `router` | 3 |
| anything else | `network_device` | 2 |

For every UniFi device:
- An `ObservationItem` keyed `unifi:<mac>` with model, IP, firmware, state, etc. in `rawData`.
- A `SAME_AS` relationship to `arp:<ip>` so the Authority's normalization can collapse the two records into one canonical Configuration Item.
- A physical uplink relationship from each parent to its child in edge ingestion (`HOSTS`) and the equivalent device-to-parent `CONNECTS_TO` evidence in portal one-shot ingestion. Both render as the observed WAN → gateway → switch → AP chain.

### Connected clients (official site-clients route)

For every authenticated WiFi or wired client (your phones, laptops, Amazon Echos, Reolink cameras, smart switches, etc.):
- An `ObservationItem` keyed `unifi-client:<mac>`. MAC identity is stable across DHCP changes; `SAME_AS` correlation links it to any ARP observation for the current IP.
- Display name preference: operator-set name in the UniFi UI ("Mark's iPhone") → DHCP hostname → `<short-vendor> <ip>` (e.g. "Amazon 192.168.0.49") → generic `LAN Host <ip>`.
- `rawData.vendor` / `vendorOui` / `vendorShort` from the bundled IEEE OUI registry — same enrichment the local ARP collector applies.
- For WiFi clients: `rawData.apMac`, `essid`, `channel`, `radio`, `signal`, `rssi`, `noise`. Higher confidence (`0.9`) than local ARP entries (`0.7`) because UniFi has authenticated the client, not just learned a kernel neighbor entry.
- For wired clients: `rawData.swMac`, `swPort`.
- A physical `CONNECTS_TO` relationship to the access point or switch reported by UniFi. `MEMBER_OF` is reserved for subnet/VLAN inventory and is never used as physical-cabling evidence.

### Failure and fallback handling

An official-route response of 404, 405, or 501 permits the bounded legacy fallback. Authentication failures, TLS failures, unreachable controllers, server errors, and an official response with zero devices do **not** fall back; hiding those states would turn a broken connection into a misleading success. Optional client or device-detail failures preserve device evidence but mark the connection/result partial or degraded.

**Network Topology** renders only physical evidence (`HOSTS`, `CONNECTS_TO`, `PEER_OF`, `UPLINKS_TO`) and displays evidence state, source, freshness, device count, and link count. **Subnet Inventory** renders address/VLAN membership. If no physical links exist, the portal shows an explicit empty/degraded state instead of substituting a subnet starburst.

## Troubleshooting

**Status stuck at `auth_failed` after Save & Test.** The portal couldn't authenticate with the controller using the key you pasted.
- Check the key wasn't truncated when copying — paste it into a plain-text scratch space first and verify the length.
- Re-generate in the UniFi UI; rotate via the **Edit** button.
- Try **Re-test** — sometimes the controller momentarily 401s during an upgrade.

**Status `unreachable`.** The portal container can't reach the controller IP. Check the controller is on the same network the portal can route to, and that no firewall blocks the HTTPS port.

**Status `tls_error`.** Common on UDM-Pro home installs with self-signed certs. Edit the connection, enable **Allow self-signed controller certificate** for the trusted closed LAN, then click **Save & Test** again. Keep it disabled for hosted/public controllers and prefer installing a trusted certificate when available.

**No new items appear after a sweep.** Inspect the edge-node logs. Common causes:
- The edge node's `fetchAdapters` call failed — log line `adapters: fetch failed (...)` tells you why (token mismatch, portal unreachable, etc.).
- The official API route is unavailable and the bounded legacy fallback is unavailable too; upgrade the controller to a supported UniFi Network release.
- `controller response was not JSON` — the controller served the login page. The API key isn't being honored; rotate it.

## What's NOT in this slice

| Feature | Tracked by |
|---|---|
| Per-port `rx/tx` throughput metrics | The full spec at [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) — needs the `metrics.network` capability + the `/api/v1/edge/metrics` endpoint, neither of which exist yet. |
| Additional LLDP detail beyond reported uplinks | Same spec, § 4.2 — separate collector. |
| WebSocket event-driven sweep on client/device join | Same spec, § 4.3 — both slices poll on the regular sweep cadence (5 min). |
| Cookie-auth for pre-9.0 controllers | If you need this, open an issue with your controller version and we'll add the auth fallback. |
| Multi-node routing (`targetEdgeNodeId`) | BI-35de9ce8 follow-up. Today every trusted edge node polls every active UniFi controller. Single-node installs Just Work; multi-node installs see duplicate idempotent work until the column lands. |

## Reference

- Spec: [`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`](../superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md) § 4.3
- Code: [`services/edge-node/src/collectors/unifi.ts`](../../services/edge-node/src/collectors/unifi.ts), [`apps/web/app/api/v1/edge/adapters/route.ts`](../../apps/web/app/api/v1/edge/adapters/route.ts)
