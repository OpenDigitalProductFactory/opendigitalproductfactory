# Scarf build-script policy

Backlog item: `BI-C43B5B50`
Work Capsule: `WC-09EC4DFA`

## Outcome

Make the repository's treatment of `@scarf/scarf@1.4.0` explicit and prevent a
future unresolved `allowBuilds` placeholder from reaching `main`.

## Evidence and decision

- `@scarf/scarf@1.4.0` is transitive through Stoplight Prism 5.16.0 in the
  integration-test harness.
- Its package manifest declares only `postinstall: node ./report.js`.
- `report.js` gathers install/dependency/platform data and posts telemetry to
  `scarf.sh`; Prism has no runtime import of Scarf outside package metadata and
  documentation.
- The install script is therefore not required for Prism behavior. The policy
  decision is `allowBuilds['@scarf/scarf'] = false`, minimizing install-time
  code execution and outbound telemetry.
- pnpm's dependency-status check remains the authoritative detector for a new
  package with an unclassified build script. A source-local policy guard will
  additionally reject any non-boolean value in the committed `allowBuilds`
  block so pnpm's generated placeholder cannot be committed.

## Implementation

1. Add a failing regression test for unresolved and malformed `allowBuilds`
   values, including the live workspace policy.
2. Implement the source-local policy checker and enroll it in the existing
   consolidated supply-chain policy guard.
3. Replace the generated Scarf placeholder with an evidence-commented `false`
   decision.
4. Verify the focused tests, the live checker, frozen install/dependency status,
   repository pregate, and exact merged-code local CI before publication.

No phase is independently shippable: the explicit decision without the guard
can regress, while the guard cannot pass until the current decision is resolved.

## Backlog coverage

- Decision: `atomic`
- Umbrella BI: `BI-C43B5B50`
- Receipt: `cmskztsob07j201o24tr8nz8o`
- Deliverable `scarf-build-policy` maps to `BI-C43B5B50` and has no dependencies.

## Risk and rollback

Risk is limited to dependency installation policy. Denying the telemetry-only
script leaves the installed Prism files unchanged. Roll back by reverting this
PR; if a future Prism release demonstrates a functional install-time need, a
separate evidence-backed policy PR may change the value to `true`.

UX impact: not applicable; no user interface changes.
Migration impact: not applicable; no schema or data changes.
