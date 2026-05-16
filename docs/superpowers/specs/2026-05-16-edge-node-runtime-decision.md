# DPF Edge Node — Runtime Decision (ADR)

> Status: **accepted** (2026-05-16). Closes the open question in
> [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](2026-05-09-dpf-edge-node-design.md)
> §"Language for the binary" *(open — drift documented)*. The binding
> spec is amended in this same PR: the "open" status flips to
> "resolved (Go)" and the maturity-gate row "Mode 1 runtime locked
> (TypeScript, shipped); Mode 2 / 4 native binary runtime open" flips
> to "Mode 1 runtime: TypeScript (Phase 0 shipped, Go retrofit
> tracked as BI-EDGE-XP-04-MODE1-GO-RETROFIT); Modes 2 / 4 native:
> Go."
>
> Date: 2026-05-16.
>
> Decider: Mark Bodman (project lead).
>
> Decision unblocks: T3 plan (`2026-05-14-edge-node-t3-windows-native.md`),
> `BI-EDGE-WIN-05-BINARY`, `BI-EDGE-WIN-08-WINSERVICE`, and by
> extension `BI-EDGE-WIN-09-RETIRE-EXPORTER`.

## Context

The Edge Node spec ([`2026-05-09-dpf-edge-node-design.md`](2026-05-09-dpf-edge-node-design.md))
originally resolved the binary language as **Go** based on
comparator analysis (Tailscale, `cloudflared`, HashiCorp Boundary,
osquery — all native compiled binaries). PR #501 shipped Phase 0 of
the Mode 1 (Linux container) service in **Node.js / TypeScript**
against `node:24-alpine`, a divergence from the spec's stated
resolution that was acknowledged in security-review pass 3 but not
closed. The binding spec currently lists the runtime as:

> **Mode 1 runtime locked (TypeScript, shipped); Mode 2 / 4 native
> binary runtime open.**

Two acceptable paths were enumerated in the spec, both pending a
single decision before Mode 2 ships:

1. **Standardize on TypeScript across Modes 1 / 2 / 3 / 4.** Use
   `bun build --compile` (or `pkg` / `nexe`) to produce
   self-contained binaries for the native modes. Reuses the Phase 0
   investment; preserves a single codebase.
2. **Hold the Go decision and rewrite Mode 1 in Go.** Replace PR
   #501's TypeScript service with a Go service for Mode 1, and use
   the same Go binary for Modes 2 / 4. Discards working code in
   exchange for runtime parity with comparators.

The spec did not enumerate a third option (split runtime —
TypeScript stays on Mode 1, Go ships for native modes), because it
creates the impedance mismatch the spec warned against. This ADR
considers all three but recommends Option B with explicit
sequencing.

## Decision

**Adopt Option B — Go for native binary modes. Sequence as Mode 4
first; treat the Mode 1 Go retrofit as a follow-on epic, not a
blocker for Mode 4 shipping.**

Mode 4 ships in Go. Mode 1 continues to run the Phase-0 TypeScript
service on `main` while the retrofit is tracked separately as
`BI-EDGE-XP-04-MODE1-GO-RETROFIT`. The wire contract between Edge
Node and Authority Core (the `/api/v1/edge/*` REST surface) is the
seam that makes this safe: Authority Core does not care whether a
node's runtime is TypeScript or Go, only that the contract holds.
Verified contract parity tests (see "Validation gate" below) keep
the seam honest during the interim period.

## Trade-off matrix

| Axis | Option A (TypeScript bundled) | Option B (Go) — **recommended** | Option C (split — Mode 1 TS, Mode 4 Go) |
|---|---|---|---|
| **Artifact size** | ~50 MB (Bun runtime + v8) | ~5 MB (static-linked Go) | matches per-mode |
| **Cold start** | 100–500 ms (v8 init) | 5–20 ms (Go init) | matches per-mode |
| **Native syscall access** | FFI required. `ffi-napi` unmaintained; `koffi` works but each platform-specific call multiplies bundling pain. `GetIpNetTable`, `GetAdaptersAddresses`, `wincred`, `svc.Run` all need careful bindings per platform. | First-class via `golang.org/x/sys/windows` and `golang.org/x/sys/unix`. All four Win32 surfaces have community bindings (`danieljoos/wincred`, `gosnmp/gosnmp`, `gopacket/gopacket`). | Mode 4 gets clean syscalls; Mode 1 retains FFI burden if it ever needs them (currently doesn't — `/proc/net/arp` is fs read, `arp -an` is subprocess) |
| **Code reuse from Phase 0** | High — `services/edge-node` ports forward with bundler config | Low — ~1,500 LOC of TypeScript becomes ~1,800 LOC of Go (rewrite, not transpile) | High for Mode 1, none for Mode 4 |
| **Comparator alignment** | None of the named comparators (Tailscale, cloudflared, Boundary, osquery, Wazuh agent, Falco, Netbox-Agent) use a bundled Node runtime. Closest analogue is Datadog's Node helpers — not the agent itself. | Direct alignment. Tailscale, cloudflared, Boundary are Go. osquery is C++ but daemon-shaped. windows_exporter (which this work eventually retires) is Go. | Mode 4 aligned; Mode 1 isolated |
| **Toolchain burden** | Bun (already used in some packages? — verify) + bundler config | Go added to `package.json` peers / Renovate / CI matrix. Mature, low-churn toolchain. | Both |
| **Cross-compile** | Bun cross-compile: `bun build --compile --target=bun-windows-x64`. Works; arm64 support landed in late 2025. | `GOOS=windows GOARCH=amd64 go build` — no cross-compile complexity. arm64 trivial via `GOARCH=arm64`. | Both |
| **Code-signing / Authenticode** | Bun binary is signable but the runtime-embed pattern triggers extra SmartScreen scrutiny — every new release looks like a "new application" until reputation builds. | Static Go binary is the standard shape; SmartScreen behavior is well-understood for Go agents (Tailscale's pattern is documented). | Both can sign; Go has fewer footguns |
| **Windows Service integration** | Requires `node-windows` (third-party) or shell to NSSM. Both work; both add dependency. | `golang.org/x/sys/windows/svc` is native, no NSSM, no third-party. | Mode 4 cleaner |
| **Credential Manager integration** | Requires FFI to `wincred` or a child-process to `cmdkey.exe`. | `github.com/danieljoos/wincred` is the established pattern. | Mode 4 cleaner |
| **TPM / Platform Crypto path (Phase 1+)** | Requires deep FFI work; Bun does not expose CNG natively. | `github.com/google/go-tpm` for TPM 2.0; CNG via `golang.org/x/sys/windows`. Standard. | Mode 4 future-ready |
| **Risk of "snowflake" wrappers per platform** | High — each platform's native bindings drift independently. | Low — Go's `runtime.GOOS` build tags are mature. | High on Mode 1, low on Mode 4 |
| **Interim impedance mismatch** | None — single runtime | Yes, until Mode 1 retrofit ships. Bounded by wire-contract parity tests. | Yes, permanent unless reversed |
| **Throws away PR #501 work** | No | Yes, ~1,500 LOC. PR is not lost — it's referenceable for shape — but the running code is replaced. | No |
| **AGENTS.md §10 "research and use standards"** | No standard for bundled-Node-as-an-agent shape. | The standard *is* Go for this shape. Every comparator agrees. | Half-aligned |

## Consequences

### If accepted (Option B)

**Spec amendments (same PR as this ADR):**
- `2026-05-09-dpf-edge-node-design.md` §"Language for the binary" header changes from `*(open — drift documented)*` to `*(resolved — Go, see 2026-05-16-edge-node-runtime-decision.md)*`. Retains the historical drift narrative for context.
- Deployment-modes table rows for Modes 2 / 4 change from "Same runtime decision as Mode 2 — open pending the drift resolution" to "Go" with a cross-reference to this ADR.
- Maturity-gate row updates as quoted in the frontmatter above.
- Endpoint-vs-MCP-tool resolution updates: "custom HTTP client (currently TypeScript / undici per `services/edge-node`)" stays as the Phase 0 truth but adds "Modes 2 / 4 use Go's `net/http` per [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md); Mode 1 Go retrofit tracked as `BI-EDGE-XP-04-MODE1-GO-RETROFIT`."

**T3 plan (`2026-05-14-edge-node-t3-windows-native.md`, new):**
- Mode 4 sliced into ~10 PRs per the W1–W11 sketch in the planning conversation.
- New Go project at `services/edge-node-go/` (or `services/dpf-edge-node/` — naming subdecision).
- Cross-compile target: `windows/amd64` first slice. `windows/arm64` opens as `BI-EDGE-XP-05-WIN-ARM64` (deferred — small user base).
- Mode 2 (macOS) slices land in same project tree but verification waits on Mac hardware (per Mark's testing constraint).

**Backlog changes:**
- `BI-EDGE-WIN-05-BINARY` body updated: "Mode 4 Windows-native Go binary" stays correct; runtime decision now closed.
- `BI-EDGE-WIN-08-WINSERVICE` body updated: refs `golang.org/x/sys/windows/svc` as the implementation surface (not NSSM, not `sc.exe`).
- `BI-EDGE-WIN-09-RETIRE-EXPORTER` body unchanged — still gated on Mode 4 capability parity.
- **New BI:** `BI-EDGE-XP-04-MODE1-GO-RETROFIT` — open, blocked on Mode 4 verification passing. Body: "Rewrite `services/edge-node` (Phase 0 TypeScript) in Go using the same wire contract. Sequenced after Mode 4 verification so the Go codebase is proven on real Windows hardware before it lands on the Linux container path. Scope: the Mode 1 container service only — Modes 2 / 4 are separately tracked. Acceptance: every contract test under `apps/web/app/api/v1/edge/__tests__/` passes against the Go service; `scripts/verify-lifecycle.ts` passes."

**Toolchain:**
- Go 1.24+ added to CI matrix. Pinned via `go.mod` `go` directive.
- `golangci-lint` configured at sensible defaults.
- `gosec` for security linting (matches the spec's "heavy security review" posture for Edge Node code).
- Renovate config extended to bump Go modules.
- `go vet` + `go test ./...` added to PR CI before merge.

**Interim wire-contract test (gates the impedance mismatch):**
A new test suite at `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` exercises every `/api/v1/edge/*` route against fixtures that both the TypeScript Mode 1 service and the Go Mode 4 binary produce. Any drift between the two implementations becomes a CI failure, not a runtime surprise. This test ships **with W1** (the first Mode 4 PR), not later.

### If rejected (Option A)

Spec amendment goes the other direction: "open" closes as "TypeScript, with bundling for native modes." Mode 4 ships using `bun build --compile`. T3 plan still gets written but with Bun-bundled artifact, FFI-via-koffi for Win32 calls, and a `node-windows` (or NSSM) wrapper for the service. All four trade-offs in the "Option A" column above land in production.

### If a third path (Option C) is preferred despite the impedance-mismatch warning

This ADR rejects Option C. If Mark wants to override, document why — a permanent runtime split is harder to defend than a bounded one. The Mode 4-first / Mode 1-retrofit sequencing in Option B is structurally identical to Option C in the interim period; the difference is that Option B commits to ending the split, and Option C does not.

## Alternatives considered

### Why not Rust?

Mentioned in the spec's original draft as a peer of Go. Rejected by the spec ("Go for cross-platform reach, mature signing/notarization toolchains") and not revisited here. Rust would be a defensible choice on a greenfield project; given that Go aligns with every named comparator and gets us 80% of Rust's safety story with a flatter learning curve, holding to Go is correct.

### Why not C# (.NET / NativeAOT)?

NativeAOT in .NET 8+ produces small, fast Windows-native binaries with excellent Win32 interop and first-class Windows Service support. **Considered and rejected:** none of the named comparators are .NET, the Edge Node must ship on Linux + macOS too (NativeAOT works there but the operator ecosystem is Windows-centric), and adopting .NET tools adds a third major language to the platform alongside TypeScript and Go.

### Why not "wait and see"?

The spec explicitly says the decision must land before Mode 2 ships. Mark only has Windows for testing, so Mode 4 leapfrogs Mode 2 in real-world verification. Delaying the decision blocks both T3 Mode 4 and the future Mode 2 work simultaneously. The cost of deciding now is one ADR; the cost of waiting is two parallel Mode 2 / Mode 4 prototypes or a full code freeze on T3.

### Why not let each mode pick its own runtime?

The spec's option enumeration was deliberately binary because per-mode runtime choice creates four codebases instead of one, and the only thing that makes a four-codebase architecture work is a stable wire contract — which we have, but every additional codebase doubles the surface area for that contract to drift. Two codebases (the bounded Option-B interim period) is defensible because it has a stated end date. Four is not.

## Validation gate

This decision is **revisited** if any of the following becomes true:

1. **The Go Mode 4 binary cannot reach contract parity with the TypeScript Mode 1 service after the W1–W10 slice plan.** Specifically: if the wire-contract test suite identifies more than 3 distinct contract gaps that require schema or route changes (rather than client implementation fixes) over the W1–W10 work, we re-open this ADR.
2. **Authenticode signing for Go binaries proves materially harder than the spec assumed.** If we cannot produce a SmartScreen-clean signed Windows binary inside the existing GitHub Actions release workflow with reasonable effort (< 1 week of investigation), we re-open.
3. **A platform-attested-keys path (Phase 1+) emerges that requires a different runtime.** Unlikely given Go's TPM ecosystem, but flagged.

If none of those triggers fire by the time Mode 4 ships and verification passes on real Windows hardware (verification report at `docs/install/verification-reports/edge-node-mode4-<host>.md`), the decision is **confirmed durable** and `BI-EDGE-XP-04-MODE1-GO-RETROFIT` becomes unblocked.

## Cross-references

- Binding spec (to be amended in same PR): [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](2026-05-09-dpf-edge-node-design.md)
- Phase 0 roadmap (no edits needed): [`docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md`](../plans/2026-05-12-edge-node-phase0-roadmap.md)
- T2 plan (references "T3 macOS/Windows" — no edits): [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](../plans/2026-05-12-edge-node-t2-multi-host-lan.md)
- Phase 1 mTLS plan (refs T3 — no edits): [`docs/superpowers/plans/2026-05-13-edge-node-phase1-mtls-hardening.md`](../plans/2026-05-13-edge-node-phase1-mtls-hardening.md)
- T3 plan (to be created in follow-on PR after this ADR lands): `docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md`
- Phase 0 service (the code Option B eventually retrofits): [`services/edge-node/`](../../../services/edge-node/)
