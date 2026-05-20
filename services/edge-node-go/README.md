# DPF Edge Node — Native Binary (Mode 4)

This is the Go implementation of the DPF Edge Node, deployed as a native binary on Windows / macOS / Linux hosts. It speaks the same `/api/v1/edge/*` wire contract as the TypeScript container in [`services/edge-node/`](../edge-node/) — wire-contract parity tests on the Authority side keep them aligned.

| | |
|---|---|
| Spec | [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../../docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md) (binding) |
| Plan | [`docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md`](../../docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md) (W1–W11 slice plan) |
| ADR | [`docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md`](../../docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md) (chose Go) |
| Matrix | [`docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md`](../../docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md) (when to use this vs. container) |

## Why a separate Go binary

The container at `services/edge-node/` works perfectly on Linux hosts. On Windows + macOS Docker Desktop, Docker Engine isolates containers from the host's real LAN regardless of `network_mode: host` and `network_mode: host` and WSL mirrored networking — verified on 2026-05-20. This binary runs as a native Windows Service / macOS LaunchDaemon / Linux systemd unit so it sees the host's actual NICs and ARP cache directly.

See the deployment matrix for the per-platform recommendation.

## Build

```bash
make help                 # list common targets
make build                # build for the host platform → bin/dpf-edge-node
make test                 # go test ./...
make build-all            # cross-compile every supported OS/ARCH
make release VERSION=v0.1.0 build-all    # release build with version stamping
```

CGO is disabled across all targets so the resulting binary is statically linked and trivially redistributable.

## Run

The binary is configured entirely via environment variables — the same set the TypeScript Mode 1 service reads, with one default change noted below.

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `DPF_AUTHORITY_URL` | yes | — | Base URL of the Authority Core. Example: `http://localhost:3000`. |
| `DPF_BOOTSTRAP_TOKEN` | first run only | — | Single-use token from the portal's Admin → Platform Development → Edge Nodes page. Consumed at enrollment; subsequent runs read the persisted node token from state.json. |
| `DPF_EDGE_NODE_NAME` | no | host's hostname | Display name shown in the Admin UI. |
| `DPF_EDGE_STATE_DIR` | no | per platform | Where state.json lives. `C:\ProgramData\dpf-edge-node` on Windows, `/Library/Application Support/dpf-edge-node` on macOS, `/var/lib/dpf-edge-node` on Linux. |
| `DPF_INSTALL_MODE` | no | `native` | Classifies how this binary was deployed. Default for the Go runtime is `native` (the TS container defaults to `container-host`). |
| `DPF_EDGE_NODE_VERSION` | no | `-ldflags` value | Agent version reported on enroll. Burned in at build time; env override for dev. |
| `DPF_PLATFORM_OVERRIDE` | no | — | Test-only override of the platform string. Production never sets this. |

State persistence rules (mirrors `services/edge-node/src/state.ts`):

- File path: `$DPF_EDGE_STATE_DIR/state.json`, mode `0600` on POSIX hosts.
- POSIX permission enforcement: refuses to load if the file is not exactly mode 0600 (would expose the node token) or is owned by a different UID (host bind-mount leak).
- Windows: ACL-based equivalents land with the Phase 1 Credential Manager work. Until then the file lives under `C:\ProgramData\dpf-edge-node\` which the installer creates with restricted ACLs.

## Lifecycle

1. Load config from env. Refuse to start on invalid config (reports all problems at once).
2. Try to load `state.json`.
3. If state present → resume. Run heartbeat + sweep loops.
4. If state missing → require `DPF_BOOTSTRAP_TOKEN`, run enrollment, persist state, run loops.

Heartbeat and sweep run concurrently. If heartbeat returns `node_revoked`, the loop clears state and exits — the service-manager restart picks up the fresh state.

## Slice status

This is **W1**: the Go scaffold + the enroll/heartbeat HTTP client + wire-contract parity test fixtures. The sweep loop is a placeholder; W2 adds the host-info collector, W3 the ARP collector via `GetIpNetTable` (Windows) / `/proc/net/arp` (Linux) / `arp -an` (macOS).

The full W1–W11 sequence lives in [`docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md`](../../docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md).
