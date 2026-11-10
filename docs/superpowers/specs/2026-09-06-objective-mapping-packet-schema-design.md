---
status: active
title: Objective-mapping packet schema completion
---

# Objective-mapping packet schema completion

**Backlog item:** `BI-329AD58D`

**Workroom:** `WC-ACC9F966`
**Parent contracts:**
[`2026-08-25-initiative-readiness-reviewer-packet-design.md`](./2026-08-25-initiative-readiness-reviewer-packet-design.md),
[`2026-09-04-objective-mapping-evidence-contract-design.md`](./2026-09-04-objective-mapping-evidence-contract-design.md)

## Problem

The readiness producer and server parser carry
`initiativeReviewBinding.eligibleEvidenceActivityIds`, and objective-mapping
requires a non-empty bounded list. The public `request_coworker` and
`summon_coworker` schemas omit that nested field. A conforming MCP client
therefore cannot submit the exact server-issued packet: omitting the field is
rejected, while adding it outside the advertised schema can be stripped or
refused by the client. Attempts then consume an idempotency key with a
different request digest and cannot be corrected by replay.

This is a schema-projection defect, not a relaxation of evidence authority.
The server remains responsible for parsing the complete binding and the
governed writer remains responsible for revalidating every evidence activity.

## Objectives

**OBJ-OMPS-ADVERTISE:** Every public threadless coworker door advertises the
complete server-issued objective-mapping binding, including the bounded,
deduplicated eligible evidence activity IDs.

**OBJ-OMPS-PRESERVE:** Both doors forward the exact binding unchanged to the
shared external task adapter so request digest and idempotency identity are
stable.

**OBJ-OMPS-FAIL-CLOSED:** Missing or malformed objective-mapping evidence IDs
remain rejected by the canonical server parser; non-mapping review bindings
remain backward compatible.

**OBJ-OMPS-PROVIDER:** Provider-specific schema normalization may remove keys
unsupported by that provider, but it never changes the server-owned packet or
the validation performed when the tool call returns.

## Design

Add optional `eligibleEvidenceActivityIds` to the shared
`initiativeReviewBinding` input-schema fragment used by `request_coworker` and
`summon_coworker`. It is an array of non-empty strings, capped at the canonical
500-entry parser limit and declared unique. It stays optional at the generic
JSON-schema boundary because research and spec-approval bindings do not carry
it. `parseInitiativeReviewBinding` retains the conditional rule that the field
is mandatory and non-empty when `gate` is `objective-mapping`.

No handler-specific copy or transform is added. Both threadless handlers
already pass `params["initiativeReviewBinding"]` to
`dispatchExternalCoworkerTask`; tests assert that a packet containing the new
field arrives byte-for-byte equivalent at that adapter. Portal-thread behavior
is unchanged.

The schema is intentionally canonical even though some inference providers do
not support every JSON Schema keyword. Provider adapters own that translation.
They may strip `uniqueItems` from the provider-facing declaration, while DPF's
server parser and writer transaction continue enforcing uniqueness and
authority.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
| --- | --- | --- |
| AC-OMPS-001 | OBJ-OMPS-ADVERTISE | `request_coworker` and `summon_coworker` both expose `eligibleEvidenceActivityIds` as a unique string array capped at 500. |
| AC-OMPS-002 | OBJ-OMPS-PRESERVE | A threadless request and summon forward an exact objective-mapping packet, including the ordered eligible evidence IDs, to the shared adapter. |
| AC-OMPS-003 | OBJ-OMPS-FAIL-CLOSED | The existing parser rejects objective-mapping bindings with missing, empty, duplicate, oversized, or non-string evidence IDs. |
| AC-OMPS-004 | OBJ-OMPS-FAIL-CLOSED | Existing research/spec-approval packets without evidence IDs continue to parse and dispatch. |
| AC-OMPS-005 | OBJ-OMPS-PROVIDER | Provider-schema sanitization can remove unsupported declaration keywords without weakening the canonical server parser or persisted binding. |

## Ordered fix sequence

1. Freeze the missing public field and dropped-packet behavior as first-failing
   request and summon tests.
2. Extend the one shared public binding schema and reuse the existing adapter
   pass-through without adding a second parser.
3. Re-run the focused public-pack, canonical parser, and provider-normalization
   regressions, then publish through DCO and protected CI.
4. Deploy the protected result before requesting any replacement
   objective-mapping identity for a historically incomplete packet.

## Boundaries and rollback

- No database migration, new tool, identity rule, evidence type, or approval
  bypass is introduced.
- Historical TaskRuns remain immutable. A key already bound to an incomplete
  packet is recovered only through the separately governed request-key
  successor contract; this change does not rewrite it.
- The rollback is the two-file source/test change. The producer, parser, and
  writer contracts stay fail closed if the public field is removed again.
