# Edge Node Deployment Matrix

| Field | Value |
|-------|-------|
| **Epic** | EP-EDGE-DEPLOY-001 |
| **IT4IT Alignment** | §5.4 Deploy (Software Distribution FC, Service Activation FC) |
| **Depends On** | 2026-05-09-dpf-edge-node-design.md (binding), 2026-05-16-edge-node-runtime-decision.md (Mode 4 Go runtime), 2026-05-09-deployment-contracts.md (substrate doctrine) |
| **Status** | Approved |
| **Created** | 2026-05-20 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |
| **Revised** | 2026-05-20 — after live verification on Win 11 + Docker Desktop 4.34+ proved that WSL2 mirrored networking does NOT cross the Docker Engine boundary into containers. Spec rewritten to reflect actual mechanism. |

---

## 1. Problem Statement

Phase 0 ships the Edge Node as a single Docker container. The compose overlay's only Docker Desktop guidance was a single comment block warning Mac/Windows users about a degraded experience — and then no actionable path forward. In practice every Docker Desktop install (Windows, macOS) gets the same broken view: the container sees Docker's internal subnets instead of the host's LAN, and discovery returns ~2 items per sweep (host info + the bridge MAC).

This spec **decides what to recommend per host substrate and commits to a testing surface we can actually cover**. It's grounded in live verification on an actual Windows 11 + Docker Desktop install (not theoretical capability statements from upstream docs).

The headline finding from that verification: **WSL2 mirrored networking, despite Microsoft's and Docker's documentation suggesting otherwise, does NOT expose the Windows host LAN to Docker containers.** The mechanism is real for WSL distributions themselves (the `docker-desktop` WSL distro inside the Docker Desktop backend does see the host's NICs at `eth1`), but Docker Engine inserts its own services network (`192.168.65.0/24`) between the container's `network_mode: host` namespace and the underlying distro. Mirrored mode doesn't cross that layer.

Therefore the architectural answer for Windows + macOS edge node deployments is **the Mode 4 native binary** (per the 2026-05-16 ADR), not a clever Docker Desktop configuration. ServiceNow MID, NinjaOne, and every other comparable discovery agent reaches the same conclusion in their docs — on non-Linux hosts, ship a native binary.

---

## 2. Deployment scenarios — the matrix

| # | Host environment | Recommended runtime | Networking visibility | Notes |
|---|---|---|---|---|
| 1 | **Linux bare-metal / VM** (server, headless box) | Mode 1 container | `network_mode: host` → real LAN | Already works. Existing `linux-host-network` compose profile. Default for any Authority + Edge single-host install on Linux. |
| 2 | **Linux container-host with isolation requirement** | Mode 1 container | macvlan / ipvlan → own IP on LAN | Operator opt-in. Documented as `docker-compose.edge.macvlan.yml` overlay. |
| 3 | **Windows + Docker Desktop** (any version, including Win 11 + WSL mirrored) | **Mode 4 native (.exe)** | n/a — not containerized | Docker Engine isolates containers from the host LAN regardless of WSL config (verified on 2026-05-20). The Beta "Enable host networking" option in Docker Desktop Settings doesn't change this for community-tier users and even on paid tiers gives the docker-desktop distro's view rather than guaranteed host-LAN reach. Container path is a permanent dead end here. |
| 4 | **macOS Docker Desktop** | **Mode 4 native (universal binary)** | n/a — not containerized | Same constraint as #3 plus no WSL story at all. The container is permanently inside the LinuxKit VM. |
| 5 | **macOS bare-metal (no Docker)** | Mode 4 native | n/a | Direct install. Same binary as #4. |
| 6 | **Windows native (no Docker)** | Mode 4 native (.exe) | n/a | Direct install. Same binary as #3. |
| 7 | **Linux native (no Docker)** | Mode 4 native (static binary) | n/a | For appliances, NAS, hardened hosts where Docker isn't acceptable. |
| 8 | **Linux Docker host with WSL2 (rare)** | Mode 1 container | `network_mode: host` → real LAN | Native Docker Engine inside a regular WSL2 distro, NOT Docker Desktop. Works because the Docker Engine layer is collapsed away. Documented as advanced. |
| 9 | **Cloud / serverless / hosted Authority** | n/a — Authority only | n/a | Edge Nodes run elsewhere (on customer premises). Cloud-Single-VM substrate runbook covers this. |

### Decision flow

```
host = detect_platform()

if host.os == linux:
    runtime = Mode 1 container
    networking = host.isolation_requested ? macvlan : network_mode=host

elif host.os == windows:
    # The container ALWAYS sees Docker's internal services network on Windows,
    # not the real LAN. Native binary is the only path to real discovery.
    runtime = Mode 4 native (.exe)

elif host.os == darwin:
    runtime = Mode 4 native (.pkg / brew)

elif host.os == "embedded" or runtime_preference == "native":
    runtime = Mode 4 native (static binary)
```

The installer (`install-dpf.ps1`, `install-dpf.sh`) implements this flow. The operator can override the recommendation via `--mode=native|container|macvlan`, but the default is the matrix above.

---

## 3. Network-visibility comparison (corrected)

Verified on 2026-05-20 against a Win 11 22H2 + WSL 2.6.3 + Docker Desktop 4.34+ install. What the edge node actually sees per choice:

| Choice | Sees host NICs? | Sees real LAN (ARP, broadcast, mDNS)? | Wi-Fi support |
|---|---|---|---|
| Container + `network_mode: host` (Linux) | ✅ | ✅ | ✅ |
| Container + `network_mode: host` (Win 11 + Docker Desktop + WSL mirrored) | ❌ — sees `192.168.65.x` Docker services network only | ❌ | ❌ |
| Container + `network_mode: host` (macOS Docker Desktop) | ❌ — LinuxKit VM only | ❌ | ❌ |
| Container + macvlan (Linux + wired) | ✅ (own IP on LAN) | ✅ | ❌ (most APs filter MACs) |
| Container + ipvlan L2 (Linux + Wi-Fi) | ✅ (shared MAC, own IP) | ✅ | ✅ |
| Container + bridge (Docker default) | ❌ | ❌ | ❌ |
| Native binary (Linux/Win/Mac) | ✅ | ✅ | ✅ |

The native binary is unconditionally the most capable. The container is competitive on Linux only.

---

## 4. Why WSL2 mirrored networking doesn't help (corrected)

Microsoft shipped mirrored networking in WSL 2.0 (Sept 2023). Docker Desktop added DNS-resolution support for it in 4.34 (Aug 2024). On a host where it's enabled, the `docker-desktop` WSL distro that holds the Docker Engine **does** see the Windows host's interfaces — `wsl -d docker-desktop -- ip addr` shows the host's real LAN address on `eth1`. WSL mirrored mode works as documented for WSL distros.

What it **doesn't** do: cross the Docker Engine boundary into containers. When a container declares `network_mode: host`, Docker Engine places the container in **its own host namespace**, which on Docker Desktop is the internal `192.168.65.0/24` services network (vpnkit-managed). The container never enters the underlying WSL distro's namespace.

Live evidence from a verified install:

```text
host (Windows):    eth0 = 192.168.0.200/24    (the real LAN)
docker-desktop WSL distro:    eth1 = 192.168.0.200/24    (mirrored ✓)
edge-node container (network_mode: host):    eth0 = 192.168.65.3/24    (Docker services only)
```

The container never sees `192.168.0.x`. ARP scans, mDNS broadcasts, link-local probes — none of them reach the real LAN from inside the container.

**Docker Desktop's Beta "Enable host networking" option** (Settings → Features in development → Beta) doesn't change this for community-tier users — it's gated to paid Pro/Team/Business subscriptions. Even when available, it gives the docker-desktop distro's view, which is closer to but not identical to the Windows host. We don't rely on it.

**Conclusion**: WSL2 mirrored networking is independently useful for WSL workflows (better DNS, mDNS within WSL, host-port reach from WSL distros) and operators are welcome to enable it for those reasons. It is NOT a path to LAN visibility for the Edge Node container. The DPF installer therefore does not auto-configure mirrored networking — that would create the wrong impression about what the installer is providing.

---

## 5. macvlan on Linux — when it's the right call

macvlan/ipvlan is the canonical pattern for "container is a first-class LAN citizen" deployments. Pi-hole, Home Assistant containers, media servers — large open-source ecosystems use it daily.

For the DPF Edge Node specifically, `network_mode: host` is the simpler default because:
- Edge node needs to read host facts (hostname, NIC list, OS version) — easier in host networking.
- Container needs to reach the Authority Core at the host's `localhost:3000` — host networking makes this trivial; macvlan needs the second-interface workaround.

We ship `docker-compose.edge.macvlan.yml` as a supported overlay because some operators legitimately want the LAN-isolation properties (the edge node looks like a separate device, not "the same MAC as the server") or are running multiple edge nodes on the same host. The doc explains the trade-off and the host-talk workaround.

**Wi-Fi limitation note in the doc:** most consumer APs filter by authenticated MAC and drop frames with new MACs. macvlan over Wi-Fi usually fails for that reason. ipvlan L2 mode is the Wi-Fi-compatible variant (single MAC, multiple IPs). The compose overlay defaults to `ipvlan_mode: l2`.

**Linux-only**: as with `network_mode: host`, macvlan/ipvlan on Docker Desktop attach to the Docker Desktop VM's virtual NIC rather than the host's physical NIC. Don't enable on Docker Desktop.

---

## 6. Mode 4 native binary — the critical path for Windows + macOS

The 2026-05-16 ADR chose Go. This spec **promotes Mode 4 from "follow-up after Phase 0" to "critical path for any Windows / macOS deployment"**. Reason: the container path has been verified to be permanently degraded on those hosts.

Commitments inherited from the ADR + made concrete here:

- **Single source of truth for the wire contract**: Mode 4 implements the same `/api/v1/edge/discovery-runs` payload schema as Mode 1, byte-for-byte. The Authority Core can't tell which runtime submitted; it only sees a `runtimeMode` field in `EdgeNode.metadata`.
- **Capability parity for Slice 0**: host info + ARP discovery. Full feature parity (nmap, SNMP, UniFi, OUI enrichment, etc.) follows in subsequent slices.
- **Installer responsibility**: when the deployment matrix selects Mode 4, the installer downloads the right pre-built binary (Win .exe code-signed, macOS universal .pkg, Linux per-arch static), installs as a Windows Service / macOS LaunchDaemon / Linux systemd unit, seeds the bootstrap token via the existing in-container helper (same code path as Mode 1).
- **Update path**: the binary self-checks for updates against the Authority's `/api/v1/edge/update-channel` endpoint. The Authority decides whether to push the new version.

Slices land in subsequent PRs and are tracked as the immediate next priority.

---

## 7. Testing surface — what we commit to covering

The deployment matrix expands the test surface meaningfully. We commit to the following levels:

| Level | Scope | Owner | Frequency |
|---|---|---|---|
| **Per-PR unit** | Detection logic, config writers, mode selection — all the deterministic parts | PR author | Per PR (CI) |
| **Per-PR integration** | One representative host per supported scenario (#1, #3, #4) brought up in a CI runner or hosted VM | PR author | Per PR touching install/edge code |
| **Release matrix** | Full matrix (rows #1–#8) verified on representative hosts before each release tag | Release captain | Per release |
| **In-the-wild monitoring** | Anonymous install-state telemetry (`installMode`, `runtimeMode`, `discoveryItemCount`) flowing back from operator installs that opt in. Identifies scenarios where discovery silently returns low item counts. | Hive | Continuous |

What we **don't** commit to:
- Every Docker Desktop version × every Windows build × every WSL minor. Microsoft and Docker change their substrates faster than we can chase.
- Wi-Fi adapter quirks per vendor. macvlan over Wi-Fi is documented as best-effort.
- VPN client interference (Cisco AnyConnect, Tailscale, ZeroTier, etc.). Documented as "may break LAN-visibility assumptions; disable VPN for verification."

Telemetry from row #3 and #4 (where many operators will land pre-Mode-4) gives us the regression signal in practice. A spike in "≤ 2 items per sweep" submissions is the canary for "operator landed on Docker Desktop without Mode 4."

---

## 8. Open questions resolved

| Q | Decision |
|---|---|
| Should we auto-write `.wslconfig` on Windows installs? | **No.** Verified that WSL mirrored mode doesn't reach Docker containers; writing it from the installer would mislead operators into thinking they got LAN visibility. Documented as an optional manual step in `docs/edge-node/wsl-mirrored-note.md` for operators who want it for OTHER reasons (WSL distro DNS, mDNS within WSL). |
| Should we deprecate the container on macOS/Windows? | No, but recommend Mode 4 instead. Container still works for dev-loop use cases that don't need LAN discovery; it just doesn't discover the real LAN. |
| Single binary vs. per-OS installer for Mode 4? | Per-OS installer that bundles the right binary, code-signed. The 2026-05-16 ADR's binary is the payload; the installer is the delivery wrapper. |
| `discoveryItemCount = 0` — fail open or fail closed? | Fail open (current behavior). The edge node should still enroll + heartbeat even if discovery is degraded; ops surface gets a "discovery yielding ≤ 2 items for N sweeps" warning instead of refusing to start. |

---

## 9. Implementation slices

| Slice | Scope | Status |
|---|---|---|
| **S1 — Spec + this doc** | Architectural decision recorded with honest findings | This PR |
| **S2 — Linux macvlan overlay** | `docker-compose.edge.macvlan.yml` overlay + Linux operator doc (when to use, host-talk workaround, Wi-Fi caveat) | This PR |
| **S3 — Mode 4 Go binary Slice 0** | Per the 2026-05-16 ADR. Host info + ARP. Same wire contract. **Promoted to immediate next priority for Windows + macOS coverage.** | Follow-up PR |
| **S4 — Mode 4 installer wrappers** | Windows MSI, macOS PKG / Homebrew tap, Linux .deb/.rpm | Follow-up |
| **S5 — Telemetry for matrix coverage** | `EdgeNode.metadata.runtimeMode` + heartbeat-side aggregation for "scenarios in the wild" | Follow-up |
| **S6 — Optional WSL mirrored documentation** | Standalone operator note explaining what mirrored mode helps with and why it does NOT help our edge node — purely educational, prevents confusion | This PR (small note) |

---

## 10. Out of scope

- Auto-detection of "should I use macvlan or host networking" on Linux. The default is host networking; macvlan is operator opt-in via the documented overlay.
- Mesh-network overlay for cross-segment discovery (Tailscale-style). The Multi-Host Edge Node spec already covers running additional Edge Nodes on other segments — that's the recommended pattern, not overlay tunneling.
- Pursuing Docker Desktop's Beta "Enable host networking" option as a primary path. Subscription-gated, doesn't reach the same fidelity as a native binary, and would still require operators to opt in via the GUI. Native binary is simpler and more reliable.
