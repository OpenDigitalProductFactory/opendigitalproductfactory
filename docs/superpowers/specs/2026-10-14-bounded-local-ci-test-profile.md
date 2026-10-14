---
status: planned
backlog: BI-0ACB97B5
---

# Bounded local-CI test profile

This is a delivery dependency for owner-scoped investment balance, tracked by BI-0ACB97B5 / WC-B5D4B788. It extends the existing local-CI plan and immutable gate identity; it adds no verification exemption or runtime.

## Evidence and boundary

At source commit 7f9e18cf59d453dc027d6f36e22dd830ab022806, canonical evidence cmv7t6ww401un01r4v08zjk74 recorded 38,363 passing tests and 41 failures. The investment ledger, PostgreSQL concurrency, scale and ranking checks passed. Promotion and real-Git tests exceeded their existing deadlines under parallel host load; missing Windows shell utilities explained two more failures. A controlled fake-Docker promotion on the installed Git shell completed with status zero in 23.90 seconds, with 0.88 seconds of fixture setup. This does not establish a whole-gate pass or prove every timeout has the same cause.

The existing runner hardcodes four initial workers and two recovery workers. The Vitest wrapper already supports explicit worker counts, but canonical planning cannot select them. The operator needs a smaller per-run profile that retains every required test and the same deadlines, lease ownership, fences, source/base binding and protected publication process.

## Ordered delivery

1. Add one bounded profile resolver to the existing local-integration helper. Read `DPF_LOCAL_CI_TEST_WORKERS`; absent means four, explicit input must be an integer from one to four. Invalid input refuses before admission or execution. Recovery workers remain at most two and never exceed initial workers.
2. Use that same resolved profile in plan construction and toolchain fingerprint collection, including pre-admission collection in the documentation evidence lane and final runtime metadata. Validate at entry to the pre-admission lane so an unavailable planner cannot turn invalid input into a legacy claim. Worker choices change gate identity; they cannot reuse evidence from another profile. Normalize explicit `4` to the same four/two profile and fingerprint as an absent override.
3. Exercise default behavior, bounds, plan arguments, recovery clamping and fingerprint separation with the existing helper tests. Verify invalid-input rejection before admission and preservation across the detached resumer and canonical child invocation. No global Vitest configuration, test assertion, timeout or coverage changes.
4. Run the normal canonical gate with a two-worker profile, the configured HTTPS MCP endpoint and installed Git utilities on the process PATH. Retain failed or inconclusive receipts and the exact execution profile. A lower count is not a passing verdict.

## Acceptance

- The default four/two execution remains unchanged.
- Explicit one and two-worker profiles reach the existing Vitest wrapper; recovery cannot increase their concurrency.
- Zero, negatives, fractions, non-numeric and values above four are rejected.
- Different explicit profiles produce different immutable toolchain identities.
- All required migration, guard, typecheck, test and publication checks remain required. Full gate success must be executed, never inferred from this repair.

No schema, installation assets, credentials, peer records, global pool policy or build strategy changes are involved. Compatibility retains the absent-override path. Removing the override restores the existing default; historical receipts remain immutable.
