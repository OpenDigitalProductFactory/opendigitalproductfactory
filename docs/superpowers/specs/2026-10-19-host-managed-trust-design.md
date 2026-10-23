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
