# Workroom review profile read contract

## Operator disclosure

The existing Workroom Details view renders the authorized `reviewProfile` through
one shared `WorkroomReviewRequirements` component. It reads the composed payload;
it does not import the server composer into the client or recompute qualification.
Requirement outcomes, denominators and inherited provenance remain available
behind labelled disclosure. Unsupported, conflicting and missing profiles retain
their explicit state. Organization applicability remains unknown where the
canonical read model has not established it.

`resolved` describes composition, not a passed review. The current read contract
supplies `assessment: not-exercised`; the view therefore states that no independent
assessment is available there. Receipt counts, cycle closure and deployment are
not substitutes. A future assessment presentation must consume its existing
attributable canonical carrier rather than inventing a browser evaluation store.
The owner next-action fallback also respects recorded room accountability while
preserving process, execution, dependency and system-wait precedence.

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

**Installed catalogue continuation.**

This design continuation belongs to the existing profiles deliverable,
BI-11458908, and its `contract:profile-resolution` / `flow:definition-to-review`
mapping in the approved delivery plan. It specifies the unfinished catalogue
integration for AC-01; it does not replace the objective baseline, approve
implementation, or complete the wider profiles deliverable. The earlier
source-contract and operator-disclosure work remains valid within its tested
scope.

The October 25 source audit at `a39d518cbf389363ebab12002d5e4067554e32e7`
found `listRoomReviewDefinitions` called only by its implementation and tests.
The production room read calls `composeRoomReviewProfile(caseRef.sourceType, [])`.
That composer already adds common and source-derived layers; the empty argument
does not remove them. Explicit organization and archetype applicability are
still absent from that production call. These are source observations, not
new live failures or evidence of assessed coverage.

**Existing surface and authority.**

Extend the existing `list_workrooms` MCP contract with an opt-in
`view: "definitions"`; omission retains the existing instance-list behavior.
Do not add a parallel catalogue endpoint, registry, scheduler or policy engine.
The definition branch belongs to `work-capsules/mcp-handlers.ts`, with its
declared input in `mcp/packs/work-capsules-pack.ts`. Keep the shared handler's
legacy alias behavior consistent. Reuse `listRoomReviewDefinitions` and
`composeRoomReviewProfile` from their current owner.

The branch must run after the existing governed capability/grant admission and
must require the native authenticated user context. Keep `view_platform` and
`work_capsule_read`; do not add a grant or infer authority from a source key.
Return declared source/profile metadata only. Instance rows, organization data,
room activity, task state, transcripts and evidence payloads are excluded.
Do not attach a selected organization or representative fixture to imply
installed tenant applicability.

Use a response discriminator and keep definition counts separate from instance
counts. Return the canonical definition/version, aliases, composition status,
profile fingerprint when resolved, and explicit `assessment: "not-exercised"`.
Unsupported or conflicting composition keeps its reason and unusable fingerprint;
it is not omitted from the denominator. Organization applicability remains
unknown. A later assessment may only come from its attributable canonical
carrier. Default operator UI and the separately owned refresh repair are outside
this slice; clients must not translate this catalogue into a green review badge.

**Bounded traversal and compatibility.**

Preserve the existing instance-list cursor and authorization protocol. Definition
requests reject instance-only filters and use a discriminator on their cursor so
the two inventories cannot resume each other. Delegate inventory fingerprint,
canonical alias handling and restart-on-stale behavior to the existing helper.
Validate the requested limit within the list tool's existing 1-100 bound.

Apply the existing MCP response-budget mechanism to the serialized result before
delivering it. Never truncate JSON or claim completion after omitted definitions.
A budget refusal retains the last confirmed cursor and reports the supported
next action; it does not silently advance or switch readers. Enumeration must
retain sparse definitions and count compatibility aliases once. Page-local
composition results are not whole-inventory totals until traversal completes.

**Delivery and verification.**

This is internal sequencing within the existing profiles BI and delivery graph,
not a new independent work item or a new coverage receipt. Before runtime edits,
refresh exact source/readiness, complete the Workroom funding binding, claim the
actual implementation paths, consume their current impact contract and complete
the managed dependency bootstrap. A documentation commit or research receipt
does not supply those prerequisites.

Start with failing tests at the existing tool dispatcher/handler boundary:
default instance reads remain compatible; missing authority returns no catalogue;
unknown views and mixed filter/cursor requests are refused; stale definition
cursors require restart; sparse definitions remain visible; aliases count once;
unsupported composition and response-budget exhaustion never produce false
coverage. Exercise the real registry projection through that boundary. Reuse the
existing composition tests for inherited requirements and deterministic
fingerprints instead of claiming those mechanics need re-proving from scratch.

After red-to-green implementation, run the affected handler/pack and registry
tests, required typechecks, exact-tree gate, independent review and protected CI.
Only after the containing deployment is qualified, traverse the actual native
tool within its declared budget and retain each request, response, frozen
inventory fingerprint and final denominator. AC-01 needs every installed
definition accounted for with resolved/unsupported/not-exercised distinctions;
source tests alone do not close it. Do not repeat the held C56/UI042 raw reads or
infer original-task settlement from this separate catalogue verification.

Reserve the planned 20% refactoring share for shared canonical identity,
normalization and provenance at their existing owners. Rollback removes the
opt-in projection while retaining legacy instance listing and stored evidence.
Tenant profile resolution, native review-cycle integration, four-domain journeys
and later outcome assessment remain explicit obligations of the existing plan.

**Research decisions.**

[W3C PROV-DM](https://www.w3.org/TR/prov-dm/) separates entities, activities and
responsible agents. Retain those distinctions in existing profile/evidence
provenance; a catalogue definition is not an assessment activity.
[OpenTelemetry's Resource SDK contract](https://opentelemetry.io/docs/specs/otel/resource/sdk/)
separates immutable resource identity from exporter behavior. Reuse that
separation for frozen definition identity and rendering, without treating
telemetry attributes as authorization.
[OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs)
associate decisions with their input, result and policy revision. Preserve exact
existing policy/source references when applicability is eventually resolved.
These are design comparisons; no new provenance store, telemetry dependency or
OPA engine is introduced.
