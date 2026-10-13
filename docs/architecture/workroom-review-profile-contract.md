# Workroom review profile read contract

This is the first source-contract slice of BI-11458908 under the
[approved delivery plan](../superpowers/plans/2026-09-12-cross-workroom-learning-delivery-plan.md).
It does not activate a reviewer, change a grant, assess an occurrence, or claim
operational benefit. Native cycle integration, organization applicability and
qualification remain separate delivery obligations.

The shared Workroom read model now returns source requirements and their
fingerprint inside the existing authorized room read. The loader's access
decision runs before this projection; a denied reader receives no room or
profile. Every returned profile labels organization applicability **unknown**
and assessment **not exercised**. Room messages and evidence cannot supply an
overlay or change these requirements. This projection does not activate review
dispatch or replace the external pilot scheduler.

## Common requirements and extensions

`room-definition-contract.ts` owns the requirement and layer types.
`room-review-profile-catalog.ts` contributes common and source-derived
requirements to the existing source registry. `room-review-profile.ts` composes
them in common, source, shape, facet, category, leaf and organization order.
Within each kind, versioned references sort by code point, independent of host
locale. Requirements accumulate by stable reference. Evidence, critical failures
and provenance are set unions; a freshness limit can only become stricter.
Different outcomes or denominators for one reference produce an unresolved
profile, rather than selecting the last writer.

The composer always includes common and source requirements. A caller cannot
remove them by omitting the common layer or supplying empty evidence. Changing
the payload of a layer reference within the same composition is a conflict.
Resolved output carries a SHA-256 fingerprint of the canonical definition,
requirements and versioned layers. An unsupported source or unresolved conflict
has no usable fingerprint. Consumers must check the status before use.

This contract is additive. It has no grant, deletion, waiver or override action.
An authorized exception belongs to the existing decision and qualification
contracts; it cannot be encoded as an empty list. Profile assembly is not proof
that an organization constraint is authorized or applicable. A future runtime
caller must resolve those constraints from its authenticated organization and
retain the frozen profile alongside its cycle evidence.

## Coverage and representative domains

`listRoomReviewDefinitions` enumerates the existing source registry, capped at
200 definitions per call. Its cursor binds the last canonical source key to the
inventory fingerprint. A stale or invalid cursor requires restarting the
inventory. `storefront-booking` remains a valid compatibility source address but
is counted once under `booking` for review coverage; other occurrence identities
are unchanged. Every result is explicitly **not exercised**. Inventory totals
are never assessed-room counts or zero-defect results.

The representative layers cover development delivery, standing cycles,
bookkeeping periods, pet rescue and campground requirements from the approved
design and operating-model documents. The campground layer is a proposed
scenario fixture: the operating-model document records that it is not yet a
deployed catalog archetype. It must not be reported as catalog activation.
Unknown representative archetype extensions throw an explicit applicability
error; they do not silently fall back to common coverage. Other governed
facet/category/leaf requirements can be composed through the typed contract,
but complete catalog applicability and tenant-scoped runtime resolution remain
unfinished within BI-11458908.

## Verification and recovery

Colocated tests exercise inherited evidence preservation, stricter freshness,
conflicts, deterministic order/fingerprint, alias deduplication, stale cursors,
four domain scenarios, independent returned payloads and 10,000 repeat profile
resolutions. Existing source, action and bookkeeping registry tests protect
compatibility. These are source-local mechanics tests, not live recovery or
domain efficacy evidence.

Shared canonical alias lookup, requirement normalization, provenance union and
fingerprinting are the refactoring work in this slice. Do not duplicate them in
future cycle readers or UI projections. Rollback removes this read projection
without deleting Workrooms, occurrences, source addresses or historical evidence.
