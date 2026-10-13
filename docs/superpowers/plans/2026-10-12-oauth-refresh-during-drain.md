---
status: active
---

# Keep existing OAuth connections readable during a drain

Existing scope: BI-B986A18B and BI-06AE6833. The OAuth owner handed off only
the proxy/token-route classification and their tests. Its frozen endpoint
candidate e1d0a410 and queued admission remain unchanged.

## Observed failure and authority

An ordinary canonical DEV upgrade is draining normally. Two existing OAuth connections
cannot call permitted read tools because refresh fails with portal_quiescing
before tool dispatch. The proxy classifies every token POST as a mutation.
The token route already authenticates clients, validates the resource and
rotates existing consent-bound refresh families without widening scopes.

The operator explicitly authorized routine DEV actions and bounded source
repair. Native claims/evidence are currently UNRUN because this refresh
dependency blocks coordination. Recovery routing permits source-only work;
reconcile its exact scope and evidence when normal service returns. This is
not a grant denial, a credential fallback or permission to edit runtime files.

## Design grounding

Extend the activity quiescence spec section6.4 and the existing external OAuth
authority design. Keep PlatformConfig portal.quiescence and its cached Node
reader authoritative. Keep existing token rotation, consent, identity,
revocation, resource and scope checks unchanged. No new table, grant, token
issuer, lease or runtime is needed.

The exact POST /api/oauth/token may reach the existing route during a known
drain. The route admits only refresh_token through its ordinary authentication;
new code exchanges and client credentials remain refused. Swapping, unknown
proxy state and failed Node reads remain closed. The canonical Node parser's
existing normal default for missing/malformed configuration is preserved and
tested through the actual reader, rather than an impossible typed mock.
Token refusals use the existing OAuth error shape and
Retry-After. Other proxy and application mutation policy remains unchanged.

## Implementation and verification

1. Add first-failing proxy and real token-handler regressions for the observed
   dependency. Include exact-path, swap, unknown-state and new-grant refusals.
2. Reuse the existing response builder and Node state reader to classify this
   one route, without changing the rotation/authorization implementation.
3. Run related token security, identity, MCP authentication and quiescence tests,
   both web TypeScript programs, affected guards and the normal governed gate.
   Record unavailable native checks as UNRUN, never PASS.
4. Obtain independent exact-source review, publish a DCO PR through protected
   CI/queue, and use the sole coordinated canonical release owner.
5. Verify an existing connection refreshes during a later normal drain and can
   read status while application writes stay refused. Do not manufacture a
   drain, new credential or token lifetime to obtain live evidence.

Closure requires source and live evidence. This repair does not settle an
original uncertain review or complete the parent initiatives.
