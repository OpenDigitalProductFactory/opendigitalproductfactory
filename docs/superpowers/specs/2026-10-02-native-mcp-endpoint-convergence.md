---
status: active
---

# Recover the persisted MCP endpoint during bootstrap

BI-9F258707 · WC-2552ADE3 · delivery-small@1.0.0

## Existing contract and reproduction

Extend [canonical install address section 12](2026-08-26-mcp-client-self-authentication-design.md#12-canonical-install-address-one-origin-one-connector-every-client) and its S2 implementation BI-2D545A0C. The original BI-9F258707 suggestion to retain insecure per-client endpoints predates machine trust provisioning; this repair follows the existing canonical HTTPS design instead. It does not add trust, credentials or grants.

At source 156d212f363f0433d8a7b60ef4e08dae5d537a12, controlled resolver execution with no checkout PUBLIC_URL and no inherited DPF_MCP_URL returns no endpoint, so bootstrap selects HTTP. Supplying either HTTPS PUBLIC_URL or an explicit HTTPS DPF_MCP_URL succeeds. Native Codex reports the HTTP loopback endpoint despite the saved client environment containing HTTPS. Research receipt: initiative-b9902607-93e6-46e4-bf21-b513b9610393.

## Ordered implementation and acceptance

One atomic repair, owned by BI-9F258707. These steps are not independently shippable.

1. **REQ-ENDPOINT**: add failing resolver regressions for a process without DPF_MCP_URL and a persisted HTTPS endpoint; preserve explicit process overrides and install HTTPS precedence.
2. **CONTRACT-PERSISTED**: extend the existing bash and PowerShell resolver twins. Resolve install HTTPS origin, then explicit process endpoint, then persisted user endpoint. POSIX reads only managed export values as data, never sources or evaluates the file. Windows reads the existing User environment. Recover persisted Node CA bundle only for HTTPS, preserving explicit/install bundle precedence. Missing saved state retains existing fallback behavior.
3. **FLOW-BOOTSTRAP**: the existing bootstrap and installer callers consume this resolver. Preserve OAuth mode and every credential/grant. Document the cross-platform recovery in the support watchlist.
4. **VERIFY-CONVERGENCE**: run resolver tests with missing/stale process context, precedence, quoted paths, malicious shell text, missing saved state and Windows twin coverage where a host exists. Run source guards, independent semantic review, canonical integration and required cloud checks; publish a DCO-signed PR through the merge queue. Apply supported bootstrap on this Mac in OAuth mode and verify the native CLI's actual endpoint and a stable repeated run. Do not claim Windows runtime or authenticated OAuth consent without executing it.

## Risk and rollback

A stale saved endpoint is lower priority than explicit install/process configuration. Read saved exports without executing shell code or reading credentials. The default CA file remains the final candidate. Reverting the source restores earlier resolution; operators can use the existing explicit endpoint override. Do not remove OAuth tokens, alter grants, or weaken certificate validation.

## Backlog coverage

Atomic mapping: REQ-ENDPOINT, CONTRACT-PERSISTED, FLOW-BOOTSTRAP and VERIFY-CONVERGENCE all map to BI-9F258707. The immutable coverage receipt is recorded through DPF MCP before implementation.

## Change impact

The Workroom impact contract has no additional testImpact or guardObligation entries. Required gates are pregate:preflight, exact-tree pregate and pr:health; install changes require a Convergence-Impact-Decision trailer. Documentation index generation is managed by the existing documentation pipeline. No database migration or portal UI change.
