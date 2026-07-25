# DPF Edge Node — Native Binary (Mode 4)

This is the Go implementation of the DPF Edge Node, deployed as a native binary on Windows / macOS / Linux hosts. It speaks the same `/api/v1/edge/*` wire contract as the TypeScript container in [`services/edge-node/`](../edge-node/) — wire-contract parity tests on the Authority side keep them aligned.

| | |
|---|---|
| Spec | [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../../docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md) (binding) |
| Plan | [`docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md`](../../docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md) (W1–W11 slice plan) |
| ADR | [`docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md`](../../docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md) (chose Go) |
| Matrix | [`docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md`](../../docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md) (when to use this vs. container) |

## Why a separate Go binary

The container at `services/edge-node/` works perfectly on Linux hosts. On Windows + macOS Docker Desktop, Docker Engine isolates containers from the host's real LAN regardless of `network_mode: host` and WSL mirrored networking — verified on 2026-05-20. This binary runs as a native Windows Service / macOS LaunchDaemon / Linux systemd unit so it sees the host's actual NICs, ARP cache, and multicast interfaces directly.

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
| `DPF_AUTHORITY_URL` | yes | — | Base URL of the Authority Core. Example: `http://localhost:3000`. Nearby discovery works over HTTP or HTTPS; automatic invitation exchange requires certificate-valid HTTPS. |
| `DPF_BOOTSTRAP_TOKEN` | first run only | — | Single-use token from the portal's Admin → Platform Development → Edge Nodes page. Consumed at enrollment; subsequent runs read the persisted node token from state.json. |
| `DPF_EDGE_NODE_NAME` | no | host's hostname | Display name shown in the Admin UI. |
| `DPF_EDGE_STATE_DIR` | no | per platform | Where state.json lives. `C:\ProgramData\dpf-edge-node` on Windows, `/Library/Application Support/dpf-edge-node` on macOS, `/var/lib/dpf-edge-node` on Linux. |
| `DPF_INSTALL_MODE` | no | `native` | Classifies how this binary was deployed. Default for the Go runtime is `native` (the TS container defaults to `container-host`). |
| `DPF_EDGE_NODE_VERSION` | no | `-ldflags` value | Agent version reported on enroll. Burned in at build time; env override for dev. |
| `DPF_PLATFORM_OVERRIDE` | no | — | Test-only override of the platform string. Production never sets this. |
| `DPF_EDGE_ACTION_URL` + trust-file variables | no | — | Complete machine-bound mTLS action channel. A partial bundle is rejected. |
| `DPF_INSTALL_ROOT` | for organization join | — | Installer-pinned root containing the fixed PKI bootstrap scripts; never supplied by an action. |
| `DPF_ORGANIZATION_TRUST_ROLE` | for organization join | — | Closed host posture: `authority` may issue; `member` may import. |
| `DPF_PKI_DIR` | for organization join | — | Protected host PKI/rollback owner. |
| `DPF_ORGANIZATION_CA_URL` | authority issue only | — | Private/local HTTPS Step CA origin used by the fixed issue handler. |

State persistence rules (mirrors `services/edge-node/src/state.ts`):

- File path: `$DPF_EDGE_STATE_DIR/state.json`, mode `0600` on POSIX hosts.
- POSIX permission enforcement: refuses to load if the file is not exactly mode 0600 (would expose the node token) or is owned by a different UID (host bind-mount leak).
- Windows: ACL-based equivalents land with the Phase 1 Credential Manager work. Until then the file lives under `C:\ProgramData\dpf-edge-node\` which the installer creates with restricted ACLs.

## Lifecycle

1. Load config from env. Refuse to start on invalid config (reports all problems at once).
2. Try to load `state.json`.
3. If state present → resume. Run heartbeat, sweep, and optional nearby-DPF discovery loops.
4. If state missing → require `DPF_BOOTSTRAP_TOKEN`, run enrollment, persist state, run loops.

The loops run concurrently. If heartbeat returns `node_revoked`, the process clears state and exits — the service-manager restart picks up the fresh state. When the Authority accepts `federation.discovery`, the binary advertises and browses `_dpf-federation._tcp.local.` with rotating privacy-safe service and hostname aliases. Candidate snapshots return over the authenticated Edge channel; discovery never creates trust. HTTP installations can discover each other, but the portal blocks automatic invitation exchange until the candidate has certificate-valid HTTPS.

## Slice status

The native runtime includes enrollment/heartbeat, host and ARP collection,
federated-demand DNS-SD, and the closed organization join issue/import
handlers. The adapters are pure Go and CGO-free;
the build gate cross-compiles it for Windows amd64, macOS arm64, and Linux amd64.
Signed one-click installation/service registration remains owned by the Edge
deployment roadmap rather than this runtime source directory.

The full W1–W11 sequence lives in [`docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md`](../../docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md).
