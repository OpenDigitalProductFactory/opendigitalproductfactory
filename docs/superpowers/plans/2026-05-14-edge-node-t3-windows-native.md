# DPF Edge Node — T3: macOS / Windows Native Binary

> **Status:** planning artifact. No code in this PR.
>
> **Thread label:** T3 — the sibling thread to T2 (multi-host LAN
> verification, landed) and T4 (mTLS hardening, planned). T3 covers
> the **native binary modes**: Mode 2 (macOS, LaunchDaemon) and
> Mode 4 (Windows, Windows Service). Both run the same Go binary
> per the runtime-decision ADR
> [`docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md`](../specs/2026-05-16-edge-node-runtime-decision.md)
> landed in PR #651.
>
> **Sequencing within T3:** Mode 4 (Windows) ships first because
> the project lead's test environment is Windows-only. Mode 2
> (macOS) slices land in the same project tree but verification
> waits on Mac hardware availability. Each slice below calls out
> which mode it ships for.
>
> **Parent roadmap:**
> [`2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
> — "macOS / Windows modes are T3's" job per the Phase 0 verification gate.
>
> **Spec:**
> [`2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md).
> Binding as of 2026-05-12; runtime question resolved 2026-05-16.
>
> **Sibling threads:**
> - [`2026-05-12-edge-node-t2-multi-host-lan.md`](2026-05-12-edge-node-t2-multi-host-lan.md) (T2 — landed)
> - [`2026-05-13-edge-node-phase1-mtls-hardening.md`](2026-05-13-edge-node-phase1-mtls-hardening.md) (T4 — planned)
> - T5 (air-gapped) — landed for Mode 1 in #586; T3's air-gap implications captured in W11.
>
> **Backlog items closed by this thread:**
> - `BI-EDGE-WIN-05-BINARY` — Mode 4 Windows-native Go binary
> - `BI-EDGE-WIN-08-WINSERVICE` — Windows Service + Credential Manager + capability.discovery.network on Windows
> - `BI-EDGE-XP-01-MACOS` — Mode 2 macOS native (slices land; verification awaits Mac hardware)
>
> **Backlog items unblocked by this thread:**
> - `BI-EDGE-WIN-09-RETIRE-EXPORTER` — `windows_exporter` retires once Mode 4 ships parity
> - `BI-EDGE-XP-04-MODE1-GO-RETROFIT` — Mode 1 Go retrofit gated on Mode 4 verification passing
>
> **What this doc is:** the slice plan that delivers a signed,
> Windows-Service-registered Go binary for Mode 4 — with `arp` /
> nmap-equivalent / SNMP capability parity to the Phase 0 TypeScript
> Mode 1 service — plus the same binary cross-compiled for Mode 2
> (verification deferred). 11 PRs (W1–W11), one concern each per
> AGENTS.md §4. The decision-shaped slices (W5 nmap-equivalent
> choice, W9 release workflow design) are flagged inline with the
> inputs needed before they can land. Q3 (cert) resolved to **EV**
> 2026-05-16; sub-decision (Azure Trusted Signing vs traditional
> EV+hardware) still open but does not block W1–W7.

## T3 scope (what "done" means)

End-to-end demo, single Windows 11 host, real installer flow:

```powershell
# Operator runs the standard DPF installer; new Edge Node step
# is bundled (per W11). install-dpf.ps1 installs the signed Go
# binary, registers the Windows Service, and auto-approves
# enrollment for the local-host single-installer case.
.\install-dpf.ps1

# After install completes, Edge Node service is running:
Get-Service dpf-edge-node
#   Status   Name               DisplayName
#   ------   ----               -----------
#   Running  dpf-edge-node      DPF Edge Node

# Verify in the portal (Authority Core on same Windows host):
#   Admin > Platform Development > Edge Nodes
#     - EdgeNode row exists, platform=win32, installMode=native
#     - trustState=trusted, lastSeenAt within 60s
#     - DiscoveryRun visible with edgeNodeId populated
#     - DiscoveredItem rows include real Windows host NICs, the
#       host's ARP cache neighbors, the host's subnet (per W5
#       nmap-equivalent decision), and SNMP poll results if any
#       devices are configured in operator allowlist

# Service survives a reboot:
Restart-Computer -Force
# After reboot, service auto-starts; next heartbeat within ~60s
# preserves the same nodeId; existing dpfedge_* token rotates as
# scheduled.
```

Mode 2 (macOS) target shape is identical except `launchctl list | grep dpf-edge-node` replaces the `Get-Service` check and the LaunchDaemon plist at `/Library/LaunchDaemons/com.dpf.edge-node.plist` registers the binary. Mode 2 verification deferred until Mac hardware is available.

## Out of scope for T3

- **mTLS / cert-based machine binding** — T4. T3 continues the
  Phase 0 per-node bearer model (`dpfedge_*` over HTTPS).
- **TPM / Secure Enclave / Windows Platform Crypto attestation** —
  Phase 1.5 (separate thread, post-T4). Requires T3's native-binary
  surface to reach the host's secure element, but the actual
  attestation work is its own slice.
- **MCP gateway / A2A gateway capabilities** — deferred per spec.
  Forward-compatibility preserved by the existing capability
  envelope; no T3 changes needed.
- **Mode 1 (Linux container) Go retrofit** — `BI-EDGE-XP-04-MODE1-GO-RETROFIT`,
  gated on T3 verification.
- **Windows on ARM** — `BI-EDGE-XP-05-WIN-ARM64`, deferred per the
  small user base. T3 ships `windows/amd64` only.
- **Capability slices beyond `discovery.network`** — host-metrics
  parity (`capability.metrics.host`) is the prerequisite for
  retiring `windows_exporter` and is owned by
  `BI-EDGE-WIN-09-RETIRE-EXPORTER`, not T3.

## Project layout

The Go service lives at `services/edge-node-go/` (subdecision —
see "Open questions" below; this is the working default that this
plan executes against). The existing TypeScript Mode 1 service
stays at `services/edge-node/` until `BI-EDGE-XP-04-MODE1-GO-RETROFIT`
replaces it. Side-by-side directories keep the runtime split
unambiguous during the interim period.

```
services/
  edge-node/          # Phase 0 TypeScript (Mode 1) — unchanged
    src/...
    Dockerfile
    package.json
  edge-node-go/       # T3 Go (Modes 2 + 4) — new
    cmd/
      dpf-edge-node/      # main binary
        main.go
      verify-lifecycle/   # e2e verification harness (W10)
        main.go
    internal/
      api/              # /api/v1/edge/* HTTP client
      collectors/
        arp_windows.go      # build-tag windows; iphlpapi GetIpNetTable
        arp_darwin.go       # build-tag darwin; arp -an parser
        arp_linux.go        # build-tag linux; /proc/net/arp reader (for testing)
        host_network_windows.go
        host_network_darwin.go
        nmap_sweep.go       # cross-platform shape, decision below
        snmp_poll.go        # cross-platform via gosnmp
      config/
      service/
        service_windows.go  # build-tag windows; golang.org/x/sys/windows/svc
        service_darwin.go   # build-tag darwin; LaunchDaemon helpers
      state/
        store_windows.go    # build-tag windows; wincred + DPAPI
        store_darwin.go     # build-tag darwin; Keychain via /usr/bin/security
        perms_windows.go    # NTFS owner SID + ACL check
        perms_darwin.go     # POSIX 0600 + uid check (no-op on filesystem stores)
    go.mod
    go.sum
    Makefile            # cross-compile targets
```

Build-tags pattern keeps the cross-compile clean: `GOOS=windows go build` only pulls the `*_windows.go` files; macOS pulls `*_darwin.go`. No `runtime.GOOS` switches inside the call sites.

## Slice plan (W1–W11)

Each slice opens a separate PR per AGENTS.md §4. Slices have explicit dependencies listed. Mode-4-shipping slices are tagged `[M4-ship]`; Mode-2 slices that land but await verification are tagged `[M2-land/verify-blocked]`; cross-cutting slices are tagged `[both]`.

### W1 — Go scaffold + enroll/heartbeat client + wire-contract test suite `[both]`

**Files (Go side):**
- `services/edge-node-go/go.mod` — `module github.com/opendigitalproductfactory/dpf/services/edge-node-go`. Go 1.24 minimum. Dependencies: `golang.org/x/sys`, `github.com/danieljoos/wincred` (build-tag windows), `github.com/gosnmp/gosnmp`, `github.com/google/uuid`. No HTTP client dep — stdlib `net/http`.
- `services/edge-node-go/cmd/dpf-edge-node/main.go` — entry point. Loads config from env (mirrors `services/edge-node/src/config.ts`), tries to load state, runs enroll-or-resume, races heartbeat + sweep loops. Matches the lifecycle in [`services/edge-node/src/index.ts`](../../../services/edge-node/src/index.ts).
- `services/edge-node-go/internal/api/client.go` — typed HTTP client for `/api/v1/edge/*`. Mirrors [`services/edge-node/src/api-client.ts`](../../../services/edge-node/src/api-client.ts) request/response shapes.
- `services/edge-node-go/internal/api/enroll.go`, `heartbeat.go` — endpoint wrappers.
- `services/edge-node-go/internal/api/client_test.go` — round-trip tests against `httptest.Server`.
- `services/edge-node-go/internal/state/state.go` — `EdgeNodeState` struct, `Load` / `Save` / `Clear`. Storage backend pluggable via build-tag (W2 fills in Windows path).
- `services/edge-node-go/Makefile` — `make build-windows-amd64`, `make build-darwin-arm64`, `make test`.
- `services/edge-node-go/README.md` — operator notes, env var reference.

**Files (TS side — wire-contract gate per ADR):**
- `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` — replays captured request fixtures from BOTH the TypeScript Mode 1 service and the Go Mode 4 binary against the route handlers. Fixtures live at `apps/web/app/api/v1/edge/__tests__/fixtures/{ts,go}/{enroll,heartbeat,discovery-runs}/*.json`. Any field-level drift (additional / missing / renamed fields, type changes) becomes a test failure. This is the bounded-impedance-mismatch gate the ADR commits to.
- `apps/web/app/api/v1/edge/__tests__/fixtures/go/enroll/v1.json` — generated by running the W1 Go binary's `--print-enroll-fixture` mode.

**CI:**
- `.github/workflows/ci.yml` — add Go job: `actions/setup-go@v5` with Go 1.24, `go vet ./...`, `go test ./...`, `golangci-lint run`. Path-filtered to `services/edge-node-go/**`.

**Exit:**
- `make build-windows-amd64` produces `dpf-edge-node.exe` (~5–8 MB stripped).
- `make test` passes.
- Go binary on a Windows host: `dpf-edge-node.exe --version` prints version + commit SHA.
- TypeScript wire-contract test runs in CI and passes for both `fixtures/ts/*` and `fixtures/go/*` corpora.
- No actual enrollment yet (need a real Authority Core HTTPS endpoint plus a bootstrap token) — that's W10.

**Depends on:** nothing. PR opens against `main`.

### W2 — Credential Manager + state persistence on Windows `[M4-ship]`

**Files:**
- `services/edge-node-go/internal/state/store_windows.go` — primary path uses `github.com/danieljoos/wincred` to read/write the `dpfedge_*` token as a generic credential named `dpfedge:<nodeId>`. Non-secret state (intervals, accepted capabilities, lastEnrolledAt) goes to `%PROGRAMDATA%\DPF\edge-node\state.json` with ACL restricted to LocalSystem + Administrators (via `golang.org/x/sys/windows/security` or `icacls` shell-out at install time).
- `services/edge-node-go/internal/state/store_windows_dpapi.go` — DPAPI fallback (`CryptProtectData` via `golang.org/x/sys/windows`) for the case where Credential Manager is unavailable. Encrypted state file `%PROGRAMDATA%\DPF\edge-node\state.enc`.
- `services/edge-node-go/internal/state/perms_windows.go` — equivalent of Mode 1's `verifyStatePerms`. Reads the NTFS owner SID + checks ACL membership; refuses to read state if owner doesn't match the current process token or if ACL has unexpected principals.
- `services/edge-node-go/internal/state/store_windows_test.go` — tests against `wincred` in CI (Windows runner). DPAPI tests gated on Windows runner; skip on Linux/macOS CI.

**Exit:**
- Windows binary writes/reads the node token through Credential Manager.
- `Get-StoredCredential -Target "dpfedge:<nodeId>"` (PowerShell PSCredentialManager module, just for verification) shows the credential.
- Restart binary; reads token back; no plaintext token ever lands on disk.
- DPAPI fallback exercised by an integration test that simulates Credential Manager unavailability (mocking the wincred API surface).

**Depends on:** W1 (scaffold).

### W3 — ARP collector via `GetIpNetTable` on Windows `[M4-ship]`

**Files:**
- `services/edge-node-go/internal/collectors/arp_windows.go` — calls `GetIpNetTable` from `iphlpapi.dll` via `golang.org/x/sys/windows`. Parses `MIB_IPNETTABLE` rows; emits `ObservationItem` matching the wire shape that [`services/edge-node/src/collectors/arp.ts`](../../../services/edge-node/src/collectors/arp.ts) produces. Filters: skip `MIB_IPNET_TYPE_INVALID` and broadcast MACs (matches Mode 1's `SKIP_MACS` set).
- `services/edge-node-go/internal/collectors/arp_darwin.go` — shells to `/usr/sbin/arp -an` and parses output. Direct translation of `parseArpDashAn` from [`services/edge-node/src/collectors/arp.ts`](../../../services/edge-node/src/collectors/arp.ts).
- `services/edge-node-go/internal/collectors/arp_linux.go` — reads `/proc/net/arp`. Direct translation of `parseProcNetArp`. Kept primarily for cross-compile sanity / local-dev iteration; production Linux runs the TypeScript Mode 1 service until the retrofit.
- `services/edge-node-go/internal/collectors/arp_windows_test.go` — fixture-based parser tests (`GetIpNetTable` output captured into a struct and replayed).
- `services/edge-node-go/internal/collectors/arp_shared_test.go` — wire-equivalence test: feed identical neighbor data to both the Windows + Darwin + Linux parsers; assert identical `ObservationItem` output.

**Exit:**
- `dpf-edge-node.exe sweep --once --print-fixture` on a real Windows host emits ARP observations that round-trip through the wire-contract test suite against captured TypeScript fixtures.
- No subprocess to `arp.exe` — direct syscall only.

**Depends on:** W1.

### W4 — host-info + host-network collectors `[both]`

**Files:**
- `services/edge-node-go/internal/collectors/host_network_windows.go` — `GetAdaptersAddresses` + `GetIfTable2` via `golang.org/x/sys/windows`. Emits NIC enumeration matching [`services/edge-node/src/collectors/host-network.ts`](../../../services/edge-node/src/collectors/host-network.ts) `collectHostNetworkSummary` shape (T2.4 contract — `metadata.host.{hostname,ipAddresses}` that the admin UI reads).
- `services/edge-node-go/internal/collectors/host_network_darwin.go` — uses `net.Interfaces()` from stdlib (works on macOS without syscalls). MAC + IP enumeration; mirrors macOS-side output of the TypeScript collector.
- `services/edge-node-go/internal/collectors/host_info.go` — cross-platform via `os.Hostname()` + `runtime.GOOS` / `runtime.GOARCH`. Matches [`services/edge-node/src/collectors/host-info.ts`](../../../services/edge-node/src/collectors/host-info.ts).
- Unit tests against captured fixtures.

**Exit:**
- Admin UI's "Hostname + LAN IP" column populates correctly for a Mode 4 Edge Node after enrollment (per T2.4 — this is a wire-equivalence regression test, not a new admin feature).
- Wire-contract test suite passes for `host_info` + `host_network` shapes against both TypeScript and Go fixtures.

**Depends on:** W1.

### W5 — Subnet sweep collector (DECISION SLICE) `[both]`

**Decision required before this slice merges:** which of the three implementations.

**Option A: Bundle signed nmap binary.**
- T3 installer ships nmap as a sibling binary alongside `dpf-edge-node.exe`.
- Pro: capability parity with Mode 1 nmap collector for free; mature tool.
- Con: nmap's Npcap dependency on Windows requires its own installer + license click-through (Nmap Project licensing terms forbid silent bundling without explicit redistribution agreement). This breaks the zero-touch installer story.

**Option B: Pure-Go SYN sweep via `github.com/google/gopacket`.**
- Implement a custom `nmap -sn`-equivalent in Go using `gopacket` for raw-socket packet construction + `pcap` for capture.
- Pro: single binary; no third-party tool to install; no Nmap licensing issue.
- Con: more code (~400 LOC), needs Npcap or WinPcap at runtime anyway (gopacket on Windows shells to a pcap library). Reimplementing only the `-sn` subset of nmap functionality.

**Option C: Make subnet sweep Linux-only; Windows degrades gracefully.**
- Mode 4 advertises `capability.discovery.network` but reports `mode: degraded` for subnet sweep. ARP + SNMP still work fully.
- Pro: zero implementation cost; preserves zero-touch installer.
- Con: Windows operators lose subnet sweep capability; T3 verification gate for Phase 4 cannot include "completes a discovery sweep" without redefinition.

**Recommendation:** **Option B** — pure-Go SYN sweep. Npcap is the standard runtime for any Windows packet-capture tool (nmap itself uses it); the installer step is a one-time prompt, and the alternative (bundling nmap) re-prompts on every Edge Node update. This slice's PR opens with Option B implemented; if review pushes back, revisit.

**Files (assuming Option B):**
- `services/edge-node-go/internal/collectors/nmap_sweep.go` — cross-platform SYN sweep using `gopacket`. Generates SYN probes for an operator-configured allowlist of subnets; captures SYN-ACK / RST responses; emits `ObservationItem` per host matching the wire shape from [`services/edge-node/src/collectors/nmap-sweep.ts`](../../../services/edge-node/src/collectors/nmap-sweep.ts).
- `services/edge-node-go/internal/collectors/subnet_allowlist.go` — translation of [`services/edge-node/src/collectors/subnet-allowlist.ts`](../../../services/edge-node/src/collectors/subnet-allowlist.ts). Operator-configured CIDRs; respects the same env var (`DPF_EDGE_SWEEP_ALLOWLIST`).
- Tests against captured pcap fixtures.
- `services/edge-node-go/README.md` — operator note: Windows requires Npcap (links to npcap.com installer).

**Exit:**
- Mode 4 Edge Node on Windows host, with Npcap installed, runs `dpf-edge-node.exe sweep --once --target 192.168.1.0/24` and emits the same observations Mode 1 would for the same subnet.
- Wire-contract test passes.

**Depends on:** W1.

### W6 — SNMP poll collector `[both]`

**Files:**
- `services/edge-node-go/internal/collectors/snmp_poll.go` — uses `github.com/gosnmp/gosnmp`. Direct translation of [`services/edge-node/src/collectors/snmp-poll.ts`](../../../services/edge-node/src/collectors/snmp-poll.ts). Reads operator-configured device list (`DPF_EDGE_SNMP_TARGETS` env, same as Mode 1).
- `services/edge-node-go/internal/collectors/snmp_config.go` — config parser, mirrors [`services/edge-node/src/collectors/snmp-config.ts`](../../../services/edge-node/src/collectors/snmp-config.ts).
- Tests using `gosnmp`'s `SnmpPacket` fixtures.

**Exit:**
- Mode 4 Edge Node polls a test SNMP target (e.g., snmpsim-running container) and emits wire-equivalent observations to Mode 1.

**Depends on:** W1. No platform-specific code — same source file for Modes 2 / 4.

### W7 — Windows Service registration via `golang.org/x/sys/windows/svc` `[M4-ship]`

**Files:**
- `services/edge-node-go/cmd/dpf-edge-node/main.go` — extend entry point to detect `service install` / `service uninstall` / `service start` / `service stop` / `service status` subcommands. When invoked by SCM (no subcommand, running under LocalSystem), routes through `svc.Run`.
- `services/edge-node-go/internal/service/service_windows.go` — `Execute` implementation: handles `svc.AcceptStop` + `svc.AcceptShutdown`; clean shutdown drains the sweep submission queue (per buffer behavior from [`services/edge-node/src/sweep.ts`](../../../services/edge-node/src/sweep.ts)).
- `services/edge-node-go/internal/service/eventlog_windows.go` — `golang.org/x/sys/windows/svc/eventlog`. Emits to "DPF Edge Node" Application Log source. Matches the LaunchDaemon + syslog decision the spec made for macOS Mode 2.
- `services/edge-node-go/internal/service/install_windows.go` — service registration via SCM API: `SERVICE_AUTO_START`, restart actions (60s delay on first failure, 60s on second, 300s on subsequent).
- Integration tests gated on Windows runner.

**Mode 2 sibling:**
- `services/edge-node-go/internal/service/service_darwin.go` — LaunchDaemon plist generator + `launchctl load` / `launchctl unload` wrappers. Plist registers at `/Library/LaunchDaemons/com.dpf.edge-node.plist`.
- Mode 2 verification deferred per project lead's testing constraint.

**Exit:**
- `dpf-edge-node.exe service install` registers the service (visible in `services.msc`).
- `Start-Service dpf-edge-node` brings it up; service runs as LocalSystem; logs land in Event Viewer > Windows Logs > Application > Source: DPF Edge Node.
- `Stop-Service dpf-edge-node` triggers clean shutdown; sweep submission queue drains.
- Service restarts automatically after a forced kill (`Stop-Process -Force`).

**Depends on:** W1, W2.

### W8 — Code-signing pipeline + cert procurement `[M4-ship]`

**Cert decision (Q3) resolved 2026-05-16: EV** — see Q3 in "Open questions" below for full rationale. Sub-decision (Azure Trusted Signing vs traditional EV+hardware-token) still open; W8a pipeline code is written to support either path.

**Cert procurement status:** no existing code-signing infrastructure in `.github/workflows/` (grep for `cosign` / `sigstore` / `signtool` / `authenticode` / `signing` / `release_key`: zero hits). This is a greenfield implementation.

**W8 PRs split:**
- **W8a — Code-signing pipeline.** Workflow at `.github/workflows/sign-edge-node.yml` invoked by `release-edge-node.yml` (W9). Supports two backends behind a small adapter so the sub-decision (Azure Trusted Signing vs traditional EV) can land late without rewriting the pipeline. Local-dev self-signed fallback for the project lead's W10 verification on their own Windows host (self-signed binaries cannot be distributed to other operators, but they pass `Get-AuthenticodeSignature` for local verification).
- **W8b — Cert procurement (operator action, not a PR).** Project lead picks sub-option, completes organization validation, loads credentials into GitHub Actions secrets. Pipeline switches from self-signed to production EV automatically once secrets are present.

**Files (W8a):**
- `.github/workflows/sign-edge-node.yml` — reusable workflow. Input: artifact path + backend name (`azure-trusted` | `traditional-ev` | `self-signed`). Output: signed binary uploaded back. Routes to either `windows-latest` runner (Azure Trusted via `Microsoft/trusted-signing-action`) or a self-hosted runner (traditional EV via local `signtool.exe` + hardware token) or `windows-latest` with a generated self-signed cert (local-dev).
- `services/edge-node-go/scripts/sign-self-signed.ps1` — local dev helper to create a self-signed cert for testing.
- `docs/install/edge-node-signing.md` — operator guide. Distinguishes "signed by DPF project's EV cert (production)" from "self-signed local-dev artifact." Cert thumbprint pinning notes for the installer's verify-before-install step.

**Required GitHub Actions secrets (W8b populates):**
- *Azure Trusted Signing sub-option:* `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TRUSTED_SIGNING_ACCOUNT_NAME`, `TRUSTED_SIGNING_CERT_PROFILE_NAME`.
- *Traditional EV sub-option:* requires self-hosted runner with hardware token plugged in; no GitHub Actions secrets path (signing happens on the runner that physically holds the token).

**Exit:**
- W8a: pipeline produces an Authenticode-signed binary using the configured backend. `Get-AuthenticodeSignature dpf-edge-node.exe` returns `Status : Valid`. With self-signed backend, the cert chain doesn't validate against Microsoft trust roots (expected for local-dev).
- W8b: production EV credentials live in CI; pipeline produces a SmartScreen-clean binary distributable to any Windows operator.

**Depends on:** W1 (something to sign). Q3 sub-decision (Azure Trusted Signing vs traditional EV) needed before W8b operator-procurement starts; W8a pipeline code can land independently of which sub-option is picked.

### W9 — GitHub Release publishing workflow `[both]`

**Files:**
- `.github/workflows/release-edge-node.yml` — new workflow. Triggers on tag push matching `edge-node-v*` (separate tag namespace from the portal's `v*` tags). Jobs:
  - `build-windows-amd64` — `ubuntu-latest` runner, `GOOS=windows GOARCH=amd64 go build`.
  - `build-darwin-arm64` + `build-darwin-amd64` — `macos-14` runner, native build.
  - `sign-windows` — invokes the reusable workflow from W8a.
  - `sign-darwin` — `codesign --sign "Developer ID Application: ..."` on macOS runner (gated on Apple Developer ID cert availability — separate cert procurement, flagged as Mode 2 blocker).
  - `release` — `gh release create edge-node-v$VERSION` with all signed binaries + `SHA256SUMS` + `SHA256SUMS.sig`. Uses `actions/attest-*` for OIDC-signed SBOM + provenance (matches the pattern from `publish-image.yml`).
- `services/edge-node-go/Makefile` — `make package` target that produces the release artifact set locally for testing.

**Exit:**
- Tag `edge-node-v0.1.0` triggers the workflow.
- Release page at `https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/tag/edge-node-v0.1.0` lists:
  - `dpf-edge-node-windows-amd64.exe` (signed)
  - `dpf-edge-node-darwin-arm64` (signed, gated on Mac cert)
  - `dpf-edge-node-darwin-amd64` (signed, gated on Mac cert)
  - `SHA256SUMS`
  - `SHA256SUMS.sig`
  - SBOM + provenance attestations linked.

**Depends on:** W7 (something installable), W8a (signing pipeline).

### W10 — E2E lifecycle verification harness for Windows `[M4-ship]`

**Files:**
- `services/edge-node-go/cmd/verify-lifecycle/main.go` — Go-native equivalent of [`services/edge-node/scripts/verify-lifecycle.ts`](../../../services/edge-node/scripts/verify-lifecycle.ts). Drives: bootstrap-token issue → enrollment → heartbeat → discovery sweep → revoke → re-enroll. Designed to run on a Windows host against a local Authority Core.
- `services/edge-node-go/scripts/verify-windows.ps1` — operator-facing wrapper that installs the binary, registers the service, runs `verify-lifecycle`, captures output, deregisters the service.
- `docs/install/verification-reports/edge-node-mode4-windows11.md` — verification report template per spec § Verification report template. Captures: platform / version, trust-state lifecycle observed, capability rows the node advertised, representative `DiscoveryRun` JSON sample, anything that didn't work as predicted.

**Exit:**
- `verify-windows.ps1` on a fresh Windows 11 host completes the full lifecycle in < 5 minutes.
- Verification report filed; "Phase 4" row in spec § Test and verification gates flips to green.

**Depends on:** W1–W9.

### W11 — install-dpf.ps1 bundling `[M4-ship]`

**Files:**
- `install-dpf.ps1` — new step after `windows_exporter` install (currently at lines ~281-328 per the install-dpf.ps1 path Mark called out). Step:
  - Detect Windows version + architecture.
  - Download `dpf-edge-node-windows-amd64.exe` from the latest `edge-node-v*` release.
  - Verify Authenticode signature against pinned thumbprint (per W8 + spec § Release and rollback).
  - Install to `%PROGRAMFILES%\DPF\edge-node\`.
  - Generate installer-issued bootstrap token (auto-approve flag set per spec § Approval policy local-host case).
  - Register Windows Service via `dpf-edge-node.exe service install`.
  - `Start-Service dpf-edge-node`.
  - Wait for enrollment to complete (heartbeat received within 60s); abort installer with diagnostic dump if not.
- `dpf-update.ps1` (new) — pull-on-schedule updater per spec § Update path. Checks `edge-node-v*` releases for newer version; verifies signature; atomic replace via `Stop-Service` → rename → `Start-Service`. Keeps previous binary at `%PROGRAMDATA%\DPF\edge-node\previous\` for `dpf-update.ps1 -Rollback`.
- `docs/install/edge-node.md` — operator guide for Mode 4 install / verify / troubleshoot / uninstall flows.
- `scripts/installer/lib/edge-node.ps1` — shared functions used by `install-dpf.ps1` and `dpf-update.ps1`.

**Out of scope (separate BI):**
- `windows_exporter` retirement — BI-EDGE-WIN-09-RETIRE-EXPORTER. Phase 0 `windows_exporter` install step stays in place until host-metrics capability parity ships.

**Exit:**
- Fresh Windows 11 host runs `.\install-dpf.ps1`, completes, and ends with a running `dpf-edge-node` service that has enrolled, completed at least one discovery sweep, and is visible in Admin > Platform Development > Edge Nodes.
- `dpf-update.ps1` upgrades to a newer release and rolls back cleanly.

**Depends on:** W9, W10.

## Dependency graph

```
W1 (Go scaffold + wire-contract test)
  ├── W2 (CredMgr + state)
  │     └── W7 (Windows Service)
  │           └── W10 (verify lifecycle)
  │                 └── W11 (install-dpf.ps1 + dpf-update.ps1)
  ├── W3 (ARP via GetIpNetTable)
  ├── W4 (host-info + host-network)
  ├── W5 (subnet sweep — DECISION)
  ├── W6 (SNMP)
  └── W8a (code-signing pipeline)
        └── W9 (release workflow)
              └── W10
W8b (cert procurement) — operator task, parallel to W1–W7
```

Sequential critical path: **W1 → W2 → W7 → W10 → W11**.
Parallelizable: W3, W4, W5, W6 (all collector slices, depend only on W1).
W8a + W9 are gated on W1 for shape, but otherwise parallel.

## Open questions (decide before relevant slice)

### Q1 — Project directory name

**Working default:** `services/edge-node-go/` side-by-side with the existing `services/edge-node/` TypeScript path.

**Alternatives:**
- `services/dpf-edge-node/` — drops the language suffix; ambiguous during interim period.
- Rename TS to `services/edge-node-ts/` and claim `services/edge-node/` for Go — symmetric, but invasive to existing imports + compose files.

**Recommendation:** Stay with `services/edge-node-go/`. When `BI-EDGE-XP-04-MODE1-GO-RETROFIT` ships, the Go service moves to `services/edge-node/` and the TS code is deleted in one PR; the rename gets one focused diff instead of being spread across the T3 plan.

**Decision needed before:** W1 (sets the directory name).

### Q2 — Subnet sweep implementation (W5)

**Working default:** Option B (pure-Go SYN sweep via `gopacket`), per W5's "Recommendation" subsection.

**Alternatives:** Option A (bundle signed nmap) or Option C (Windows degradation, ARP + SNMP only).

**Decision needed before:** W5 PR opens. If Option C is selected, T3 verification gate text needs adjustment.

### Q3 — Authenticode code-signing cert (W8b) — *resolved 2026-05-16: EV*

**Decision:** **EV (Extended Validation) cert** chosen over OV.

**Rationale (recorded for posterity, since this is load-bearing):**
- **Immediate SmartScreen-clean UX from day 1.** EV-signed binaries never trigger the "Windows protected your PC — Unknown publisher" warning. OV cert reputation accrues over hundreds-to-thousands of installs; until then, every early-access user sees the scary warning. For an open-source platform in adoption-growth phase, that warning is an adoption killer.
- **Faster lead time.** EV procurement is 1–3 business days vs OV's 3 weeks. T3's W8b–W11 finish line is unblocked sooner.
- **The extra ~$300/yr cost is irrelevant** against the adoption-friction cost of OV's warning behavior.

**Sub-decision (open):** within EV, two implementation paths:
1. **Azure Trusted Signing** (preferred). Microsoft's managed signing service (GA 2025). Cert lives in Microsoft's HSM; signing happens via signtool plugin or REST API directly from GitHub Actions runners — no hardware token to manage, no self-hosted runner. ~$10/month base + minimal per-signature fee. Microsoft validates the organization once (1–3 days). Best fit for an open-source project with CI-native release flow.
2. **Traditional EV cert + hardware token.** DigiCert / Sectigo / GlobalSign issue an EV cert provisioned to a YubiKey FIPS or SafeNet eToken (~$50–100 one-time hardware cost). Token must be physically present where signing happens — requires a self-hosted GitHub Actions runner (or a manual signing step). Cheaper recurring cost (~$600/yr) but more operator burden.

**Recommendation:** **Azure Trusted Signing** unless there's a project constraint against a small Azure subscription. Same UX outcome as the YubiKey path with materially less ops overhead.

**Operator action (parallel to W1–W7 implementation work):**
1. Decide Azure Trusted Signing vs traditional EV+hardware-token.
2. Begin organization-validation submission (business registration documents, verifiable phone listing, domain ownership confirmation — all standard EV requirements).
3. Once validated and cert provisioned, load credentials into GitHub Actions secrets:
   - Azure Trusted Signing: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TRUSTED_SIGNING_ACCOUNT_NAME`, `TRUSTED_SIGNING_CERT_PROFILE_NAME`.
   - Traditional EV: requires self-hosted runner with hardware token plugged in; no GitHub Actions secrets path.

**Bring-up sequencing:** W8a opens against `main` with self-signed cert support (so W10 verification can run on the project lead's Windows host). W8a's signtool step becomes a no-op-with-self-sign-fallback when production EV credentials aren't yet in GitHub Actions secrets, and switches to production signing automatically once the secrets land. **W11's installer step that pins the production cert thumbprint cannot ship until production EV credentials are in CI** — that's the gating dependency.

**Decision needed before:** Sub-decision (Azure Trusted Signing vs traditional EV+hardware) must land before W8b operator-procurement step starts. W8a's pipeline code can be written against either path; small adapter difference.

### Q4 — Apple Developer ID cert (Mode 2 W7 + W9)

Mode 2 is verification-blocked on Mac hardware availability, so this is not a near-term blocker. Flagged for future planning.

## Verification gates (before declaring T3 complete)

### Mode 4 (Windows) — gates this PR sequence delivers

| Gate | Source | Action |
|---|---|---|
| Phase 4 verification gate per spec | `2026-05-09-dpf-edge-node-design.md` § Test and verification gates | `verify-windows.ps1` passes on fresh Windows 11 |
| Wire-contract test suite passes for TS Mode 1 + Go Mode 4 fixtures | ADR validation gate | CI green on every PR after W1 |
| `windows_exporter` retirement unblocked | `BI-EDGE-WIN-09-RETIRE-EXPORTER` | Verification report filed; capability parity confirmed |
| Mode 1 Go retrofit unblocked | `BI-EDGE-XP-04-MODE1-GO-RETROFIT` | Verification report filed |

### Mode 2 (macOS) — gates this PR sequence stages but does not close

| Gate | Source | Action |
|---|---|---|
| Phase 2 verification gate per spec | `2026-05-09-dpf-edge-node-design.md` § Test and verification gates | Awaits Mac hardware; verification report deferred |
| Apple Developer ID cert procurement | Q4 | Awaits cert procurement |

## Cross-references

- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md)
- Runtime ADR: [`docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md`](../specs/2026-05-16-edge-node-runtime-decision.md) (PR #651)
- Phase 0 roadmap: [`2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
- T2 multi-host: [`2026-05-12-edge-node-t2-multi-host-lan.md`](2026-05-12-edge-node-t2-multi-host-lan.md)
- T4 mTLS: [`2026-05-13-edge-node-phase1-mtls-hardening.md`](2026-05-13-edge-node-phase1-mtls-hardening.md)
- Phase 0 service (parity target): [`services/edge-node/`](../../../services/edge-node)
- Existing Windows installer surface: [`install-dpf.ps1`](../../../install-dpf.ps1)
- Existing Docker release workflow (template for binary release): [`.github/workflows/publish-image.yml`](../../../.github/workflows/publish-image.yml)
