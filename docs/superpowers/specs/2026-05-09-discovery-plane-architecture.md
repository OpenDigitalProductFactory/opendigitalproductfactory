# Discovery Plane Architecture (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs a "Research & Benchmarking" section comparing 2-3 open-source
> leaders and 2-3 commercial products before finalization.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> (the "Discovery plane refactor" subsection under Future direction).
> That plan deliberately leaves this epic unsequenced; the work lands
> after macOS / Linux installer-parity ships.

## Why this exists

The current network sweep at
`packages/db/src/discovery-collectors/network.ts` queries Prometheus for
`windows_net_nic_address_info` (Windows) and `node_network_info` (Linux)
to enumerate real host NICs, and falls back to `os.networkInterfaces()`
inside the portal container if those metrics aren't available. The
container-fallback path only sees Docker bridge interfaces (172.17.0.x);
real-host topology is lost. Confidence drops from 0.95 to 0.70.

This forces the platform to install `windows_exporter` as a Windows
service (`install-dpf.ps1:281-328` — MSI download, firewall hole,
service-poll) just so the sweep has a data path. The same problem
recurs on macOS and Linux at different fragility levels:

- **Linux native Docker:** `node-exporter` runs in compose; works once
  the `linux-monitoring` profile is enabled. Acceptable but couples the
  sweep to the time-series exporter's lifecycle.
- **macOS Docker Desktop:** **no path exists.** Docker Desktop runs the
  container fleet inside a Linux VM; the Mac's physical NICs are not
  exposed to anything inside the VM. macvlan, ipvlan,
  `network_mode: host` — none pierce the VM boundary. This is a Docker
  Desktop architectural limit, not a configuration gap.
- **Windows + Docker Desktop / WSL2:** same VM-boundary problem.
  `windows_exporter` running natively on the Windows host bypasses the
  VM and feeds Prometheus, which is why it exists.

## Problem statement

Provide a network sweep data path that:

1. Produces identical `InventoryEntity` / `InventoryRelationship` /
   `InfraCI` rows on Windows, macOS, and Linux.
2. Does not require an OS-specific exporter MSI / brew package /
   distro package as a separate moving piece.
3. Reuses the platform's existing API and auth surface (MCP bearer
   tokens at `/api/mcp/v1`, see AGENTS.md §8) rather than introducing
   a parallel scrape path.
4. Is the same code path the eventual "Add a managed host" feature
   uses to onboard *other* machines as managed nodes — the DPF host is
   just the first managed node.

## Sketched architecture: three deployment modes, one sweep

### Mode A — Linux container with host-mode networking (default for Linux installs)

A new `discovery-agent` service in `docker-compose.linux.yml` shipping
with `nmap`, `arp-scan`, `lldpd`, and the sweep scan code. Joins the
host network namespace directly. Sees real NICs, walks the real ARP
table, can correlate L2/L3.

**Open question — host mode vs macvlan default:**
- `network_mode: host` — container shares the host's IP. Simpler,
  works on every Linux Docker version. Sufficient for *outbound*
  scans (ARP, ping sweep, nmap -sn, port probes).
- `macvlan` / `ipvlan L2` — container gets its own MAC + DHCP/static
  LAN IP. Appears as a peer device. Necessary if the agent must be
  *reachable* — receiving LLDP/CDP frames from switches, response
  traffic correlation, segregated scanning roles per VLAN.

  Decision criteria to settle in this epic: do we need agents to be
  LAN peers, or only LAN observers?

### Mode B — Native helper binary (for macOS / Windows hosts)

A small statically-linked Go or Rust binary (~5 MB) bundled inside
the GHCR-published portal image; installer extracts and installs it
on first run. Auto-starts via the same LaunchAgent (macOS) /
scheduled task (Windows) mechanism the installer-parity roadmap is
already building.

Runs the same scan logic as Mode A. POSTs results to
`/api/v1/discovery/sweep` (already exists, manual-trigger endpoint;
see `apps/web/app/api/v1/discovery/sweep/route.ts`) using an MCP
bearer token. Downstream consumers — `executeBootstrapDiscovery` →
`persistBootstrapDiscoveryRun` → Postgres + Neo4j projection — are
unchanged.

**This is also the foundation for managed-fleet onboarding.** The
same binary, the same API, the same auth model. The DPF host
becomes the first managed node onboarded by the binary it shipped
with.

### Mode C — In-VM container fallback (macOS / Windows dev installs)

Same `discovery-agent` service running inside Docker Desktop's Linux
VM. Sees the VM's network only. Sweep flags affected `DiscoveredItem`
rows with reduced `confidence`. Acceptable for dev installs that
don't need accurate host-LAN topology.

## Why this beats the current pattern

- One sweep implementation, three deployment modes — no per-OS
  collector branches in TypeScript.
- Mode B is dramatically lighter than `windows_exporter` (~5 MB vs
  ~30 MB MSI) and uses the platform's existing API surface and auth.
- Mode B is reusable verbatim for managed-fleet onboarding — the
  DPF host is just node #1.
- Honest about the Docker Desktop VM boundary on macOS and Windows;
  provides a real escape hatch (Mode B) instead of pretending
  containers can reach the host's NICs.
- `windows_exporter` and the `windows-host` Prometheus scrape job
  retire cleanly once Mode B is shipped, removing the moving piece
  the installer-parity roadmap currently has to keep.

## Open questions

These need answers before this stub becomes a finalized spec:

- **Linux default:** `network_mode: host` (observer) or `macvlan`
  (LAN peer) as the out-of-the-box compose configuration? See the
  decision criteria above.
- **Binary distribution:** ship Mode B's binary inside the
  GHCR-published portal image and have the installer extract it on
  first run, or publish separately as a GitHub Release asset
  (signed, multi-platform manifest)?
- **Auth scope:** re-use existing MCP `dpfmcp_*` tokens (Admin >
  Platform Development), or introduce a narrower `dpfagent_*` scope
  with limited grants (sweep write only, no read of other
  resources)?
- **Update path:** how does Mode B self-update when the platform
  upgrades? Pull on schedule, push from platform, or signal-and-
  download-via-installer?
- **Telemetry parity:** what subset of `windows_exporter` /
  `node_exporter` metrics, if any, must keep flowing for Grafana
  host-resource panels independent of the sweep? Decide before
  retiring those exporters.
- **Capabilities required:** which Linux capabilities does the
  Mode A container need (`CAP_NET_RAW`, `CAP_NET_ADMIN` for raw
  sockets used by nmap / arp-scan)? Document the principle of least
  privilege.
- **macOS entitlements:** does Mode B need any special entitlements
  (e.g. for `vmnet.framework` or `com.apple.developer.networking.*`)?
  If signed and notarized, what's the distribution flow?
- **Windows service vs scheduled task:** Mode B as a Windows service
  (always running) or scheduled task (triggered on schedule)? Auth
  model implications.
- **Discovery-agent → Prometheus:** does Mode A also expose
  `/metrics` for the platform's own observability of the sweep
  (scan duration, hosts seen, errors)? Probably yes.

## Research & Benchmarking (TBD per AGENTS.md §10)

Before finalization, compare:

- **Open source:** Netbox-Agent, Nautobot, glasswall-CIM, Steampipe.
  Read their data models and discovery semantics, not just feature
  lists.
- **Commercial:** Auvik, Lansweeper, ScienceLogic SL1, Datadog
  Network Performance Monitoring.

Document patterns adopted, patterns rejected, anti-patterns
identified, and gaps the design fills.

## Schema impact (TBD)

The existing `DiscoveryRun`, `DiscoveredItem`,
`DiscoveredRelationship`, `InventoryEntity`, `InventoryRelationship`
schema (`packages/db/prisma/schema.prisma`) is the contract Mode A
and Mode B both write to. Verify whether any fields need additions
for:

- `agentMode` enum (`linux-host`, `linux-macvlan`, `native-darwin`,
  `native-win32`, `in-vm`)
- `agentVersion` (Mode B self-update flow)
- `confidenceReason` — explicit enum of why confidence is degraded
  (currently a free-form decimal)

## Sequencing

This epic sits **after** the macOS / Linux installer-parity roadmap
ships its Phase 7 (full installer). Until then, the sweep keeps its
current data path: `windows_exporter` on Windows,
`node-exporter` (`linux-monitoring` profile) on Linux, container-
local fallback on macOS.

The installer-parity roadmap does **not** retire `windows_exporter`
or the `windows-host` Prometheus scrape — those retire when this
epic ships Mode B.

## Source documents

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md` —
  the macOS / Linux installer-parity roadmap that referenced this
  refactor as future work and motivates the constraints captured
  above.
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`
  — the operational-health monitoring spec; documents the Qdrant
  silent-failure incident that motivated the broader observability
  stack.
- `packages/db/src/discovery-collectors/network.ts` — the current
  sweep implementation that this epic replaces.
- `apps/web/app/api/v1/discovery/sweep/route.ts` — the existing
  HTTP entry point that Mode B will POST to.
- `install-dpf.ps1:281-328` — the `windows_exporter` install path
  this epic eventually retires.
