---
status: active
---

# Saved Build Studio proof without an execution provider

BI-9F057CA8 · WC-9E4DD327 · Small, one atomic revert.

This extends the existing native verification-truth design and preparation
DOC-C9353C77. Saved evidence is information; reading it must not depend on
having an AI runner available. Execution capability, access and readiness still
govern every action that starts or changes work.

## Reproduction and existing substrate

On f56fcf7541479a7706d2d551986543fbc8775ddb, `/build` returns from the
capability check before loading saved builds. The page regression executes all
three unavailable capability reasons: the saved reader is never called despite
an authenticated owner and a retained record. The unauthenticated control passes.
This is a reproduced failure, not a passing implementation or live fixture test.

Reuse `/build`, BuildStudio's saved selection and details drawer, ReviewPanel's
existing verification projection and raw output, and native saved-data readers.
Keep organization-scoped reads and existing mutation-specific authority.
The missing PlatformDevConfig setup case remains unchanged.

## Ordered atomic repair

1. Keep authentication first. Load saved data even when execution capability is
   unavailable; distinguish capability observation failure from empty history.
   Retain the existing provider setup guidance alongside saved records.
2. Carry explicit execution availability through the existing UI. In unavailable
   mode retain saved selection, recorded documents, proof/raw output and reload.
   Do not mount intake, promote, workflow, resume/repair, release, deletion,
   brief-edit, decomposition or formatting actions and effects. Gate nested
   ReviewPanel formatting/decomposition too. UI state never grants server access.
3. Test page loading and real component interactions, including existing server
   authorization and dispatch boundaries. Preserve draft creation versus
   execution approval distinctions; do not claim all server writes share a
   provider check. Keep qualified counts, unknown and conflicting proof truthful.
4. Verify normally admitted disposable saved fixtures with no configured runner,
   exact source and lease. Exercise saved selection/proof/raw output, reload,
   replacement and empty/error states without inference or production fixtures.
5. Run affected tests/typechecks and applicable UX review, independent source
   review and governed delivery through `pnpm land`. Canonical deployment remains
   with its existing owner; served acceptance requires CAN-TEST.

These steps are not independently shippable: exposing history without preserving
its execution boundary is incomplete. No new route, provider, credential,
capability floor, budget, table or role is introduced.

## Acceptance and recovery

Existing authorized saved results remain readable with zero providers,
insufficient local capability or temporary capability unavailability. Empty
history, failed reads and unavailable capability have distinct truthful states.
An inaccessible explicit buildId cannot be presented as another build's result.
Unauthorized visitors receive no saved data. Existing organization-scoped read
and creator-specific mutation rules are retained.

Unavailable mode must not invoke inference, dispatch or mutations, including
hidden child controls. Raw retained reports remain available; missing execution
and conflicting evidence never become success. A2A attribution, standing-history
fixtures and the separately tracked reload cause are outside this repair.

No migration or data rewrite is required. Revert this atomic presentation change
through protected delivery if acceptance fails; preserve existing saved records.

## Design choice

DI-A96411492A3F compared propagating an unavailable-execution flag through the
full studio with an isolated reader composed from native reporting and proof
components. The latter was autonomy-eligible with high confidence; the agent
recorded that choice. This decision is not a rendered UX measurement or critique.
The new reader initializes its own measured prose ceiling; all existing copy
ceilings and route budget limits remain unchanged.
