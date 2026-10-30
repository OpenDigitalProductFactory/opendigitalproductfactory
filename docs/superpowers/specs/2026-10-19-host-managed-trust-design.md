---
status: active
---

# Apply existing host trust before gate admission

BI-F89C7FBD, WC-3C8D20B3. Linked follow-on to BI-2D545A0C and
activity cmvf86k3p39vo01qhpj5yvqcj; original installer AC-1..4 stay unchanged.
Existing design: [canonical install address, section 12](2026-08-26-mcp-client-self-authentication-design.md#12-canonical-install-address-one-origin-one-connector-every-client).
Related delivered callers: BI-B29A586B and BI-9F258707. Independent of
BI-E27F3600: no framework, coworker request, or review replay changes.

## Reproduction and design grounding

At 67f2c72823f3429d3ac2114fcdb06d15e5400b79, Node 24.13.1 reports no
startup extra CA and the native shared MCP request fails with
UNABLE_TO_GET_ISSUER_CERT_LOCALLY against the configured HTTPS endpoint.
The Windows User setting names the existing authorized managed CA. Prior
controlled startup with that CA verifies HTTPS, including authenticated
discovery. Persistence and server availability do not imply process inheritance.

Reuse installer/lib/mcp-client-env.{ps1,sh}, scripts/lib/mcp-client.mjs,
pregate.mjs and gate-worktree.mjs. A Node adapter calls the existing OS resolver
without persistence or credential reads. Resolve install context through the
existing state-path resolver and installPath; explicit configuration wins.
Extend resolver twins to preserve process NODE_EXTRA_CA_CERTS and
DPF_MCP_CA_FILE overrides and to report a selected missing file instead of
silently substituting another trust anchor. Optional absent default trust leaves
public CA validation intact.

Node reads NODE_EXTRA_CA_CERTS only at startup. The shared connection adapter
therefore supplies validated extra roots alongside Node's effective default
roots per request; launcher environment propagation prepares child startup.
The gate launcher restarts itself before network or gate side effects when the
selected bundle differs from the roots actually loaded at startup. Preserve
arguments, execution flags, credentials, attribution, and child exit status.
No global TLS override, server certificate harvesting, HTTP downgrade,
permission change, token rotation, or effectful retry.

A bounded TLS handshake before expensive checks sends no HTTP request or
credential. It validates the chain and hostname and returns transport-specific
diagnostics. Authentication, authorization and quiescence retain their own
existing responses after transport succeeds. Missing/invalid/expired selected
CA files fail explicitly; peer expiry, name mismatch and issuer mismatch name
different remedies. Do not call an anonymous HTTP401 an authentication pass.

## Acceptance

- AC-1: A long-running client missing process NODE_EXTRA_CA_CERTS launches the supported gate using valid saved managed trust without manual intervention, including child processes.
- AC-2: Missing, invalid, expired and mismatched certificates yield accurate actionable diagnostics.
- AC-3: TLS, authentication, authorization and quiescence remain distinguishable; read-only early transport checks precede expensive checks.
- AC-4: Regression coverage includes inheritance, child processes, explicit overrides, public CA endpoints and supported Windows/macOS/Linux behavior.
- AC-5: Exercise actual supported launch path; complete affected local checks, exact-tree gate and normal governed PR/delivery. Coordinate shared files before edits.

## Ordered implementation

One atomic repair: none of these stages is independently shippable.

1. REQ-TRUST: regressions for saved trust, process overrides and child startup;
   reproduce failing behavior on the named base before changing implementation.
2. CONTRACT-RESOLVE: extend existing OS resolver twins and add the Node adapter,
   certificate validation, effective default-root preservation and diagnostics.
3. FLOW-LAUNCH: integrate shared MCP request trust and early gate launch/transport
   admission, preserving current credential identity and quiescence behavior.
4. VERIFY-DELIVERY: TLS fixture regressions, resolver twins, shared MCP and gate
   tests, supported Windows launch against the configured endpoint, source
   guards, exact-tree local-CI, independent review and governed protected PR.

## Verification and convergence

All deliverables map to BI-F89C7FBD. Record immutable plan coverage before
implementation. Claims accepted without overlapping shared-file ownership.
Cross-room posting was denied; no admission or permissions were changed.
Update the platform support watchlist and generated doc index in this branch.
No UI, database, credential, or machine trust-store changes. Source scripts
converge on their next supported invocation after delivery; installed assets
advance through the normal release path. Rollback is a source revert retaining
the saved trust and all credential files. Native macOS/Linux evidence requires
those hosts; simulated adapters do not prove native execution.

References: [Node environment loading](https://nodejs.org/api/cli.html#node_extra_ca_certsfile),
[effective CA roots](https://nodejs.org/api/tls.html#tlsgetcacertificatestype).

## Live verification preflight follow-on (BI-95B102AA)

The existing trust contract also applies to `scripts/dpf-verify-preflight.ts`.
At fbe8c75ca511701a93a89103f7324aea84c4fb75, that normal launcher calls
`fetch` without preparing saved trust and collapses TLS failures into a claim
that the portal is not serving. During DEV verification the unchanged command
returned BLOCKED with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, while launching the
same entry point with the existing resolver's child environment returned
CAN-TEST for served dc1e4b5f66fae06c5c1cfcb8f82ec79b971e5cc7.

This is a small caller-integration repair, not a new trust mechanism or an
amendment to BI-F89C7FBD's original acceptance. Reuse `runWithHostMcpTrust` and
`resolveHostMcpTrust` from `scripts/lib/mcp-host-trust.mjs`, and the existing
preflight verdict core. Resolve the trust against the requested portal origin,
not an unrelated ambient MCP destination. Its HTTPS path uses the existing
validated saved bundle and fresh Node startup; explicit HTTP stays explicit.
No trust store, credential, client configuration or grant is changed.

Order the work in one independently shippable repair:

1. Add behavior regressions around the real CLI with the existing TLS fixture.
   Prove the saved-CA case fails before implementation. Include malformed and
   missing bundles, certificate name mismatch, explicit HTTP, source mismatch
   and non-200 image responses. Confirm only the read-only image endpoint is
   requested; the transport probe sends no HTTP request.
2. Integrate the existing trust launcher before the image fetch, preserve child
   status and all original arguments, and retain structured BLOCKED output with
   a transport-specific remedy for setup failures. Keep the canonical verdict
   core and ancestry logic unchanged. This shared-adapter integration is the
   relevant refactoring allocation; do not duplicate trust parsing.
3. Run the focused launcher/TLS regressions and existing verdict tests, then
   normal exact-tree verification, independent assessment, DCO publication and
   protected merge. Prove the normal source command on the authorized live
   install without a custom per-command trust wrapper; source-local checks do
   not establish canonical runtime deployment.

Acceptance is the four AC-PF criteria in BI-95B102AA: automatically load saved
managed trust, fail closed with accurate transport diagnostics, preserve the
read-only verdict/ancestry contract, and verify the normal supported launcher.
Rollback reverts the caller integration only and retains all saved trust and
credentials. Native Windows proof does not stand in for native macOS/Linux
execution; shared resolver tests retain their own platform limits.
