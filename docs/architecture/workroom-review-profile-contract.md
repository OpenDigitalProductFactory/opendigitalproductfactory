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

**Occurrence inheritance continuation (AC-02).**

The installed catalogue satisfies AC-01's registered-definition inventory only.
This continuation stays within BI-11458908 and the existing profile-resolution
delivery mapping. It specifies how an authorized occurrence obtains inherited
requirements; it does not mark AC-02 passed or admit runtime implementation.
The common/source composer, definition catalogue and verified operator disclosure
remain the shared owners. No second registry, policy store or scheduler is needed.

The source audit at the incoming main revision
`b7ee9ec259303456470a62095875d6e37d65f318` found two distinct gaps.
`WorkItem` has source identity but no organization foreign key, and
`WorkspaceRoomAuthContext` carries reader identity and clearance, not the
subject's organization. In `room-posture.server.ts`, `resolveStream` selects
the most recently updated storefront without an occurrence organization.
That advisory posture lookup cannot become review-applicability authority.
Neither an authorized room read nor a funding binding establishes which
organization owns the business occurrence.

**Resolve the subject before its requirements.**

Extend the existing server loader seam used by
`loadAuthorizedWorkspaceCase` / `loadWorkspaceWorkCaseDetail`; keep
`buildWorkroomView` and `composeRoomReviewProfile` pure. After room-content
authorization, resolve the canonical source address through its existing source
adapter and apply that source's organization/content authorization before loading
tenant metadata. Reader organization, installation organization, assigned worker,
accountable human and funding owner are not fallback subject identities.
A denied lookup exposes no tenant identity, layer reference or applicability
detail. Discovery-only authorization must not trigger this resolver.

The first concrete relation is `StorefrontBooking.organizationId` plus its
`storefrontId` relation to `StorefrontConfig`. Resolve the booking using the
existing adapter's identity semantics; do not reinterpret a display reference as
a database id. Require the booking organization and the selected storefront's
organization to agree. Read that exact organization and storefront, never a
global `findFirst`. An absent source, ambiguous address, mismatched organization,
unavailable source authority or unsupported adapter yields an explicit unknown
scope; it cannot be treated as an empty tenant profile or a not-applicable case.
This relation is a source-supported design example, not a live booking test.

Other registered sources must supply equivalent authoritative relation evidence
before their organization scope is supported. Do not infer it from a WorkItem's
free-form evidence, messages, parent item, queue or participants. Workroom-only
and platform-development cases retain unknown organization applicability until
their owning source contract establishes it. Registry coverage and occurrence
scope coverage therefore have separate denominators.

**Canonical archetype selection and governed provenance.**

For an established subject organization, use the exact
`StorefrontConfig.archetypeId -> StorefrontArchetype.id` relation for the primary
archetype; `StorefrontArchetype.archetypeId` is the canonical slug, not that FK.
Read active `StorefrontArchetypeComposition` rows for the same storefront.
Preserve their role, product-line binding, revision and removed state. A secondary
archetype scoped to one product line is not applicable to every occurrence in
the organization. Without an authoritative occurrence-to-product-line relation,
that secondary's applicability remains unknown. No sorted-first or primary-only
shortcut may claim the whole composition was considered.

Use the canonical category, activation profile and typed operating-model facts
from the existing storefront/template owners. A category or facet identity is
a selector, not a review obligation by itself. Extend the current typed layer
catalogue with versioned declarations and explicit applicability predicates;
reuse its canonical alias, normalization, provenance and conflict logic.
Representative pet-rescue/campground fixtures and the Four-Portfolio candidate
catalogue's informative review application are not evidence of tenant adoption.

Each selected extension must retain its controlling source reference and
revision/content digest, owning scope, adoption/approval provenance, predicate
inputs and evaluation, and freshness/review trigger. The declared obligation
must identify outcome, required evidence, denominator/exclusions, critical
failures, assessor eligibility, prohibited actions, retention/access and
inheritance rationale. Reusable facets precede category baselines; leaf deltas
must explain why their rule cannot be promoted to either shared layer.
An unknown predicate input remains unknown, distinct from a proven false
predicate. A complete scoped read with no applicable declaration may report
not-applicable only with that exclusion evidence.

The inspected `Policy` and `PolicyRequirement` models have no explicit
organization binding. Their free-form applicability text, status or approval
fields alone cannot authorize an organization overlay. Similarly,
`DecisionPerspectiveProfile.ownerOrganizationId`, a promoted profile version
or `PerspectiveMaterial.sourceRef` identifies decision material, not an
established Workroom-constraint adoption contract. Reuse an owning governed
contract only when its semantics bind this obligation, organization, revision
and authority. Until that contract and its supported reader are verified,
organization/jurisdiction/contract/deployment constraints stay unknown. Do not
create a permissive JSON interpretation or copy these records into a review store
to fill the gap.

**Composition, history and operator presentation.**

Continue to add common, source, shape, facet, category, leaf and organization
requirements through the existing composer. Repeated references with the same
payload deduplicate; conflicting versions/payloads or incompatible outcomes and
denominators remain visible and unresolved. A lower layer cannot remove inherited
evidence or weaken freshness. A removal request must fail or retain a separately
authorized exception with reason, owner, controlling rule, applicability and
expiry/review trigger; an empty layer is never an exception.

Keep the existing composition fingerprint distinct from the occurrence's
applicability provenance. A requirements hash alone does not prove that the
organization and declarations used to select those requirements were authorized.
The future cycle-admission contract must freeze both the composed requirements
and exact selection provenance into its existing attributable evidence carrier,
using that carrier's governed writer. A read must not write or rewrite a cycle.
Changed inputs create a new revision/cohort; historical observations retain the
old profile and denominator. Unknown, denied or conflicting applicability cannot
earn a qualified cycle or be silently reconstructed from today's storefront.

Extend the shared Workroom requirements disclosure, not a separate dashboard.
Show what is inherited, which source selected it, and why a scope or declaration
is unresolved. Distinguish composition status, applicability coverage and actual
assessment. Preserve the room's usable common/source requirements while marking
the incomplete scope; do not turn a resolved common-only profile into a tenant
coverage badge. Denied readers receive no sensitive reason details. Keep keyboard
disclosure, visible focus, long-label wrapping and light/dark narrow layouts;
reuse the existing refresh-preservation proofs where their scope still applies.

**Implementation admission and acceptance evidence.**

Before runtime edits, publish this exact design, refresh author research and the
normal implementation readiness, claim the actual owning paths and consume their
impact/dependency contract. Current design admission is not implementation
admission, independent architecture approval or settlement of held reviews.
Resolve missing governed constraint adoption through the existing architecture
and owner decision route; do not manufacture that evidence inside this reader.

Add failing boundary tests for two organizations sharing a reader, denied source
access, booking/storefront mismatch, absent/unmapped sources, inactive composition,
product-line uncertainty and unknown versus false predicates. Verify bounded
queries against exact subject keys, overflow/refusal without partial completeness,
and mutation-free reads. Add tests proving facet/category/leaf reuse, conflicting
declarations, attempted inherited-rule removal, source revision changes and
frozen historical cycle identity. Reuse existing composer mechanics tests.

The initial per-occurrence ceiling is 32 composition rows, 256 selected
extension declarations and 512 resulting requirements, within the existing
response budget and at most 128 KiB of serialized profile/provenance. Count
one extra row to detect overflow; report incomplete applicability and a supported
continuation instead of silently taking the first N. These are proposed reader
limits, not measured scale passes. Raising them belongs to the existing parent
initiative's AC-10 budget work, with new measured evidence before rollout.
After affected tests, required gates and independent review, use only a qualified
containing deployment and admitted fixtures for installed inheritance,
conflict/removal and historical-profile checks. AC-02 closes only when those
attributable results demonstrate every required layer; a source-only resolver,
unknown organization constraints or representative fixtures cannot close it.

The relevant refactoring remains shared identity, normalization, provenance and
server-to-pure-reader composition. Existing PROV-DM and decision-log comparisons
above explain the choice: keep the selecting authority and exact inputs with
the outcome, while using existing DPF owners rather than adopting another engine.

**First occurrence-context slice.**

The first runtime slice reads subject facts, not inherited business obligations.
The shared authorized case loader first applies room-content and exact-selection
checks. For a booking or its registered alias, the source reader additionally
requires the existing workforce `view_storefront` capability used by the
storefront activity surface. Customer, partner and agent populations are not
admitted by this first adapter; unsupported surfaces keep explicit unknown scope.
A room participant does not gain this source capability through membership.

One exact `bookingRef` query selects only organization/storefront identity,
primary archetype identity and revisions, and at most 33 composition rows to
detect the 32-row ceiling. The pure projection rejects organization, storefront,
archetype-FK and source-reference conflicts. Removed/inactive entries stay
excluded; active declarations and product-line bindings remain unverified.
The primary slug and category are source facts, not proof that a representative
review layer is adopted. No business context, policy, processing activity, worker,
funding or global storefront fallback enters this projection.

The existing compliance classifier provides a useful three-state applicability
contract, but its installation-wide context loader cannot establish this subject.
Regulation version lineage, confirmed organization-scoped DataProcessingActivity
records and BusinessContext compliance scope may supply future governed inputs.
Their existence alone does not map a booking to an obligation. This slice neither
changes those owners nor treats retention's conservative null-scope fallback as
review qualification.

The subject fingerprint binds source/config/archetype/composition revisions and
selection facts independently of the requirements fingerprint. Reads are
mutation-free and do not create a historical cycle snapshot. The shared identity
disclosure may show these facts with organization applicability still unresolved;
a resolved subject is never a passed review or a complete AC-02 result.
