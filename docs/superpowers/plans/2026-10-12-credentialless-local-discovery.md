---
status: active
---

# Credentialless local discovery — BI-22F198D0

## Design grounding

Extends the existing local model management design and provider-account discovery. Read `apps/web/lib/inference/provider-account-discovery.ts`, its tests, `provider-locality.ts`, and `provider-auth-test.ts`. Native DMR answers inventory without authentication; a canonical local account is not an OAuth account. Preserve management permission, inactive status, stale-update protection and all cloud authentication.

## Atomic scope

One source repair: `REQ-LOCAL-NO-CREDENTIAL`, `CONTRACT-CANONICAL-LOCALITY`, `FLOW-ACCOUNT-DISCOVERY`, `VERIFY-LOCAL-AUTH-BOUNDARIES`.

1. Add failing tests for both canonical local provider IDs with account auth `local`, including an inactive account. Assert no credential/bearer lookup, no Authorization header, exact configured model-list URL and an account update that does not set status.
2. Prove a cloud account claiming local auth still uses the existing bearer path and returns its existing credential failure; disabled and stale-account tests retain their protections.
3. Use the existing `isLocalProviderId` primitive to exempt only canonical local-runtime accounts from bearer lookup. No new auth helper, provider, endpoint or capability is added.
4. Run account-discovery tests, provider-account tests, affected typechecks and the canonical shared gate. Deploy through the canonical release path and call governed discovery on DEV; verify recorded model IDs and unchanged inactive status. A model-list pass is not a tool-use or inference pass.

## Coverage

Atomic deliverable and parent: BI-22F198D0. Immutable plan coverage must be recorded before source implementation. This repair is independently shippable from BI-A50B677E and will have its own source/evidence boundary.

## Risks and rollback

The guard must not trust an arbitrary account's `local` label. Both its auth method and canonical provider locality must match. Cloud and unknown provider IDs retain existing authentication. Revert the source commit to roll back; discovery cannot enable a provider. Do not probe inference or resume queued work as an incidental effect.

## Documentation and verification limits

Existing operator documentation says local providers need no credentials; this repair restores that documented behavior. No new user workflow is introduced. Live evidence: governed DEV discovery returns `No credential configured`, while the native DMR list endpoints return the installed Qwen3.8 27B and Nomic models. PROD remains read-only; ChatGPT transport is owned by another chat.
