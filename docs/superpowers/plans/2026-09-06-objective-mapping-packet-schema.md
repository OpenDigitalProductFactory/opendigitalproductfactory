---
status: active
---

# Objective-mapping packet schema completion plan

- **Backlog item:** `BI-329AD58D`
- **Workroom:** `WC-ACC9F966`
- **Design:** [`2026-09-06-objective-mapping-packet-schema-design.md`](../specs/2026-09-06-objective-mapping-packet-schema-design.md)
- **Scope:** the public coworker tool schema and its colocated tests; no task,
  binding, parser, writer, or persistence redesign

## Outcome

External MCP clients can submit the exact objective-mapping recovery packet
that DPF issued. The packet survives either coworker door unchanged, while the
existing server parser and writer remain the authority for gate-specific
presence, uniqueness, boundedness, and evidence eligibility.

## Traceability

| Step | Acceptance | Verification |
| --- | --- | --- |
| Red: assert the nested field on both public definitions | `AC-OMPS-001` | focused coworker-pack test fails on the current tree |
| Red: dispatch a complete objective-mapping binding through request and summon | `AC-OMPS-002` | adapter-spy expectations fail if any field is dropped or transformed |
| Green: extend the shared schema fragment once | `AC-OMPS-001`, `AC-OMPS-002` | both definitions and both handlers pass |
| Regression: exercise canonical parser boundaries | `AC-OMPS-003`, `AC-OMPS-004` | linked review-contract tests remain green |
| Integration: verify provider normalization separately | `AC-OMPS-005` | Gemini adapter tests retain server-side validation boundaries |

## Ordered implementation

1. Add the exact objective-mapping binding fixture and failing schema assertions
   to `coworker-pack.test.ts` for both collaboration doors.
2. Add failing threadless request and summon assertions proving the ordered
   eligible evidence IDs reach `dispatchExternalCoworkerTask` unchanged.
3. Extend the shared `initiativeReviewProperties` schema once with the
   canonical string-array, uniqueness, and 500-entry cap.
4. Refactor the test fixture factory so research and objective-mapping packets
   share immutable artifact construction without obscuring their gate-specific
   fields.
5. Run the focused pack tests, the canonical review-contract tests, web
   typecheck, doc index/link checks, style/diff guards, and pregate preflight.
   If the shared heavy gate has no slot or underperforms, record it as
   INCONCLUSIVE under the operator's explicit boundary and do not claim PASS.
6. Publish one DCO-signed PR, require every protected check and merge-group
   check, then include it with the compatible key-evolution and provider-schema
   repairs in one canonical release when all are protected-merged.
7. Verify exact served SHA and CAN-TEST before requesting fresh server-issued
   objective-mapping routes for the preserved BI-SIG and BI-2B closeouts.

## Publication constraints

No consumed idempotency key is retried with a changed packet. No receipt is
inferred. Local-gate unavailability never weakens DCO, protected CI, immutable
artifact verification, approval boundaries, or live acceptance.
