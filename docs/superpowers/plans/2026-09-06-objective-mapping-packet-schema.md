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

| Step | Objective | Acceptance | Verification |
| --- | --- | --- | --- |
| Red: assert the nested field on both public definitions | `OBJ-OMPS-ADVERTISE` | `AC-OMPS-001` | focused coworker-pack test fails on the current tree |
| Red: dispatch a complete objective-mapping binding through request and summon | `OBJ-OMPS-PRESERVE` | `AC-OMPS-002` | adapter-spy expectations fail if any field is dropped or transformed |
| Green: extend the shared schema fragment once | `OBJ-OMPS-ADVERTISE`, `OBJ-OMPS-PRESERVE` | `AC-OMPS-001`, `AC-OMPS-002` | both definitions and both handlers pass |
| Regression: exercise canonical parser boundaries | `OBJ-OMPS-FAIL-CLOSED` | `AC-OMPS-003`, `AC-OMPS-004` | linked review-contract tests remain green |
| Integration: verify provider normalization separately | `OBJ-OMPS-PROVIDER` | `AC-OMPS-005` | Gemini adapter tests retain server-side validation boundaries |

The atomic coverage contract uses these exact code and flow identifiers:

- Contracts: `request_coworker`, `summon_coworker`,
  `initiativeReviewBinding`, `dispatchExternalCoworkerTask`.
- Flow: `server-issued-readiness-to-public-schema`,
  `public-schema-to-shared-adapter`,
  `shared-adapter-to-canonical-parser`.

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

## Backlog coverage

- Decision: atomic
- Parent: `BI-329AD58D`
- Receipt: blocked-by: live coverage receipt is being recorded against this exact immutable plan after the genuine scope baseline
- Rationale: The public schema, both coworker doors, and canonical parser form one packet contract and cannot ship safely as independent changes.
- Dependencies: none

| Deliverable | Backlog item | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| `objective-mapping-packet-schema` | `BI-329AD58D` | `OBJ-OMPS-ADVERTISE`, `OBJ-OMPS-PRESERVE`, `OBJ-OMPS-FAIL-CLOSED`, `OBJ-OMPS-PROVIDER` | `request_coworker`, `summon_coworker`, `initiativeReviewBinding`, `dispatchExternalCoworkerTask` | `server-issued-readiness-to-public-schema`, `public-schema-to-shared-adapter`, `shared-adapter-to-canonical-parser` | `AC-OMPS-001`, `AC-OMPS-002`, `AC-OMPS-003`, `AC-OMPS-004`, `AC-OMPS-005` |

## Publication constraints

No consumed idempotency key is retried with a changed packet. No receipt is
inferred. Local-gate unavailability never weakens DCO, protected CI, immutable
artifact verification, approval boundaries, or live acceptance.
