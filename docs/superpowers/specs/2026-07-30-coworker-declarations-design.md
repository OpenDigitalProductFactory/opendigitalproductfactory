# AI Coworker Declaration Integrity Design

Status: revised design under independent review; source implementation remains
blocked on `BI-C1943813` live acceptance

- Umbrella backlog item: `BI-97CD9E4B`
- Epic: `EP-UX-SYSTEM`
- Compatibility reader: `BI-3FB40CCA`
- Aggregate remediation and contract: `BI-2E7972A7`
- Versioned writer and CAS: `BI-33A623D0`
- Readiness normalization: `BI-1FDEF342`
- Customers and sales declarations: `BI-A00EAD43`
- Your team declarations: `BI-A02A060E`
- Operations and delivery declarations: `BI-3BDB5C04`
- Platform and back office declarations: `BI-F798996C`
- Roster and record consumption: `BI-57F76D61`
- Plan: `docs/superpowers/plans/2026-07-30-coworker-declarations.md`
- Visual prototype:
  `docs/superpowers/specs/assets/2026-07-30-coworker-declarations-prototype.html`
- Prior IA:
  `docs/superpowers/specs/2026-07-25-ai-workforce-ia-design.md`
- Applicability WWMD: `DI-17EC37A4F121`
- Catalog ownership WWMD: `DI-8F0D4C46402A`
- Primary placement WWMD: `DI-D27A79E99964`
- State/action WWMD: `DI-B17F4DE8FD51`

## Purpose

The AI Workforce directory must let an owner answer four questions quickly:

1. Who can help with the work I have in mind?
2. Is that work offered for this business?
3. Can this coworker do it now?
4. What is the safest next action?

The live directory cannot answer those questions for most coworkers. Seventy
of 77 coworkers are grouped under Other, two intended business areas are empty,
and no coworker has evidence-backed Available status. This is a declaration,
read-model, and interaction-design problem. It is not permission to infer work
from names, agent kinds, or technical capability fragments.

## User Outcome

The owner starts with one existing directory, organized into four business
areas:

- Customers and sales
- Your team
- Operations and delivery
- Platform and back office

Search and Business area are immediately visible. Availability and Interaction
are secondary filters and collapse behind `Filters (n)` on narrow screens.
Each result shows the plain job and primary business area of its deterministic
default action service, one truthful derived state, one short reason, and a
direct route to the coworker record. All service portfolios remain filter
memberships. A ready and permitted result may additionally expose `Ask <full
display name>`. Opening Ask identifies the exact coworker and selected service,
explains the work context and expected next step, and sends nothing until the
owner submits.

Technical evidence, sibling services, provider details, grants, raw rule
resolution, and blocker references stay in the existing coworker record under
progressive disclosure.

## Research And Benchmarking

This design uses external standards as constraints, not decoration:

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) says JSON object member
  ordering is not significant and duplicate member names are not
  interoperable. The parser rejects unknown/duplicate semantic scopes, and
  resolution is independent of authored array order.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) defines a repeatable JSON
  canonicalization scheme for hashing. Declaration ownership hashes use JCS
  bytes followed by SHA-256, never ordinary property-order-sensitive
  `JSON.stringify`.
- [Kubernetes API deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/)
  requires a release to support old and new API versions before storage moves
  forward, so an upgrade can be rolled back. DPF therefore ships a dual reader
  before any v1 writer.
- [Kubernetes storage versions](https://kubernetes.io/docs/concepts/overview/working-with-objects/storage-version/)
  distinguishes the accepted API shape from the persisted storage version.
  DPF mirrors that separation with one parsed contract and an explicitly gated
  writer mode.
- [JSON Schema 2020-12](https://json-schema.org/specification) informs the
  closed, versioned, tagged-union grammar. Runtime validation remains a
  dependency-light TypeScript parser shared by DB and web packages.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) governs keyboard access, focus
  visibility/order, status announcements, target size, reflow, labels, and
  error recovery.
- [W3C native dialog technique H102](https://www.w3.org/WAI/WCAG22/Techniques/html/H102)
  informs the Ask preview: modal semantics, focus placement, Escape behavior,
  and focus restoration are provided by the existing shared dialog primitive.

Project evidence adds stricter constraints: current catalog consumers collapse
an object-valued `archetypes` field to an empty array, `metadata.aggregate`
currently controls aggregate selection, and seeded values can coexist with
operator changes. Those facts require reader-before-writer rollout, typed
catalog ownership, and compare-and-swap seed convergence.

## Existing Ownership

The implementation extends current sources of truth:

- `StorefrontConfig.archetypeId` is the install's canonical business type.
- `CoworkerService` owns work, portfolio, personas, applicability, backing,
  authority, inputs, outputs, and service identity.
- `CoworkerService.archetypes` remains the applicability storage field.
- `CoworkerService.portfolioId` remains the service work-area and filter
  membership source. Primary roster placement is derived from the default
  action service, not stored independently.
- `resolveCanonicalAgentId` and
  `COWORKER_SLUG_TO_CANONICAL_AGENT_ID` remain the canonical identity map.
  Executable `providerAgentId` stays separate because slug and `AGT-*` rows can
  represent one displayed coworker.
- The canonical Agent row owns the exceptional statement that the catalog
  deliberately offers no work for that identity.
- `availability-projection.ts` remains the owner-facing projection boundary.
- The Marketing `service-readiness.ts` and `route-readiness.ts` implementation
  become the first input to the shared readiness contract after it lands.
- The existing roster, coworker record, shared panel, status, filter, and
  disclosure primitives remain the presentation surface.

This design does not add an availability table, a duplicate roster, another AI
launcher, a second portfolio registry, or component-local inference.

## Governed Decisions

### Applicability Storage

WWMD `DI-17EC37A4F121` selected a versioned object in the existing
`CoworkerService.archetypes` field with a legacy adapter. It scored `9.821`
with a `3.239` margin.

| Option | Result |
| --- | --- |
| Versioned object in the existing field | Selected |
| Normalized applicability table | Rejected: unnecessary new substrate |
| Sentinel strings in the array | Rejected: ambiguous and weakly validated |
| Split between archetypes and metadata | Rejected: duplicate ownership |

### Catalog Ownership

WWMD `DI-8F0D4C46402A` selected typed fields on existing owners. It scored
`9.323` with a `2.793` margin.

- `CoworkerService.catalogRole` owns `aggregate | specific`.
- `Agent.coworkerCatalogExceptionReason` owns the exceptional, deliberate
  reason that no active aggregate service is offered.
- Offered work remains derived from active aggregate service existence.

Fake not-offered services, metadata conventions, and a new catalog-status table
were rejected. A service applicability declaration therefore never has a
`not-offered` state.

### Primary Placement

WWMD `DI-D27A79E99964` selected `action-service-primary` with a composite score
of `9.894`, a `3.915` margin, and high confidence. For the current viewer, the
deterministic default service that is applicable, ready, and Ask-eligible owns
the coworker's primary business-area placement. Ask targets that same service.
Every active service portfolio remains a filter membership and stays visible on
the coworker record.

The aggregate service still owns the canonical catalog summary and integrity
contract. It does not override a genuinely executable specific service's
placement. If no service is Ask-eligible, the deterministic recovery service
owns placement so the next useful action and its business context stay
together. No component may infer a primary area from the Agent name, kind,
description, or workforce identity portfolio.

### Orthogonal Facts And Derived State

WWMD `DI-B17F4DE8FD51` selected `orthogonal-facts-derived-state` with a
composite score of `10.548`, a `3.501` margin, and high confidence.
Applicability, readiness, and viewer permission remain separately governed
facts. One canonical projector combines them into the owner-facing state/action
record consumed by the directory, coworker record, Setup lens, and contextual
launchers.

Only `supported + ready + permitted` exposes Ask. Permission cannot turn
unsupported or unready work into Available, and lack of permission cannot
rewrite applicability or readiness evidence. The projection carries the exact
label, reason, primary/recovery action, recovery owner, selected service,
business-area placement, and Ask eligibility so consumers cannot recompute
those decisions locally.

## Persistence Changes

Reader R adds the expand-only fields:

```prisma
model CoworkerService {
  catalogRole                String @default("specific")
  catalogOwnerAgentId        String?
  catalogIntegrityStatus     String @default("valid")
  catalogIntegrityEvidence   Json   @default("{}")
  declarationOwner           String @default("operator")
  declarationSourceRevision Int   @default(0)
  declarationSourceHash      String?
}

model Agent {
  coworkerCatalogExceptionReason String?
}
```

Contract C owns the tightening:

```prisma
model CoworkerService {
  catalogOwnerAgentId      String
  catalogOwner             Agent  @relation("CoworkerServiceCatalogOwner", fields: [catalogOwnerAgentId], references: [agentId])
}

model Agent {
  catalogOwnedCoworkerServices CoworkerService[] @relation("CoworkerServiceCatalogOwner")
}
```

Closed registries live in `packages/db`:

```ts
const COWORKER_SERVICE_CATALOG_ROLES = ["aggregate", "specific"] as const;
const COWORKER_CATALOG_INTEGRITY_STATUSES = ["valid", "quarantined"] as const;
const COWORKER_DECLARATION_OWNERS = ["platform-seed", "operator"] as const;
const COWORKER_CATALOG_EXCEPTION_REASONS = [
  "service-not-established",
  "retired",
  "replaced",
  "operator-decision",
] as const;
```

Reader R is an expand migration:

1. adds loose/defaulted fields;
2. embeds an immutable migration-local `VALUES (provider_id,
   canonical_agent_id)` alias map copied from the reviewed identity registry;
3. verifies every mapped canonical Agent exists before assigning it, otherwise
   retains the provider Agent and writes a typed integrity finding;
4. backfills `catalogOwnerAgentId` idempotently from that SQL map while keeping
   executable `providerAgentId` unchanged;
5. backfills only unambiguous `metadata.aggregate === true` services;
6. writes duplicate/missing-canonical evidence into
   `catalogIntegrityStatus/evidence`, never an ad hoc log-only table;
7. does not add a tightening unique index and therefore cannot wedge an install
   because duplicates already exist.

The migration does not call TypeScript. A source test compares its immutable
alias tuples with `resolveCanonicalAgentId` so registry drift fails CI. The SQL
is repeat-applicable on clean, dirty, aliased, missing-canonical, and partially
backfilled fixtures and carries an in-file migration-safety annotation.

Contract release C follows governed remediation. Before it groups or mutates
duplicates, its migration recomputes `catalogOwnerAgentId` for **every**
`CoworkerService` from the immutable migration-local identity map; it never
trusts a pre-existing null, stale, alias, or incorrectly populated owner. Only
after that complete recomputation does it group active aggregates by canonical
owner. If duplicates still exist for one recomputed owner, the fleet-safe
backstop demotes every conflicting aggregate to `specific`, retains each active
service, and writes `catalogIntegrityStatus = "quarantined"` plus typed
evidence owned by each affected `CoworkerService`:

```ts
type CoworkerCatalogIntegrityEvidenceV1 = {
  schemaVersion: "coworker-catalog-integrity.v1";
  reasonCode: "duplicate-aggregate";
  quarantinedAt: string;
  conflictingServiceIds: string[];
  priorCatalogRole: "aggregate";
  remediationKey: string;
};
```

It chooses no arbitrary primary. An unmapped provider is its own canonical
owner because the existing provider foreign key proves that Agent row exists; a
known alias whose canonical target is absent stays on its provider row and emits
an integrity finding until the target exists. The migration then recomputes the
duplicate sets from those final owner values, quarantines them, makes
`catalogOwnerAgentId` non-null, adds the named Agent foreign key, and adds:

```sql
CREATE UNIQUE INDEX "CoworkerService_one_active_aggregate_per_catalog_owner"
ON "CoworkerService" ("catalogOwnerAgentId")
WHERE "status" = 'active' AND "catalogRole" = 'aggregate';
```

An Agent exception is valid only on the canonical Agent row and only when its
canonical owner has no active aggregate service. Alias rows cannot carry it.
Every aggregate promotion, demotion, exception write, and repair transaction
locks the canonical Agent row `FOR UPDATE`, re-reads active aggregate and
exception state in the same transaction, then writes or rejects. Creating an
active aggregate clears the canonical exception atomically. Setting an
exception while an aggregate exists is rejected. The partial unique index
remains the database backstop for aggregate/aggregate races; the canonical-row
lock serializes the cross-table aggregate/exception invariant.

A quarantined canonical owner has active specific services but no presentation
or action service. It projects Coverage needs repair in Other, never exposes
Ask, and offers `Resolve catalog conflict` only to an authorized platform
operator. The repair transaction promotes exactly one selected service to
aggregate or records a canonical Agent exception, then clears quarantine status
and evidence from every affected service atomically.

## Applicability Contract

### Canonical Owner

`packages/db/src/coworker-applicability-contract.ts` is a dependency-light
module exported by `@dpf/db`. Web code imports this module. There is no second
parser in `apps/web`. The contract has three explicit stages:

1. `parseCoworkerApplicability(raw)` performs only closed grammar and scalar
   validation;
2. `validateCoworkerApplicability(parsed, registries)` validates category,
   archetype, owner, active-parent, and other injected catalog facts;
3. `resolveCoworkerApplicabilityGraph(validated, catalogEvidence)` resolves
   inheritance, cycle/depth/tie behavior, and the install-specific outcome.

Each stage preserves typed findings and raw evidence. The parser never queries
or silently assumes registry/catalog state.

Catalog loaders retain both:

```ts
type ParsedCoworkerApplicability = {
  raw: unknown;
  contract:
    | { validity: "valid"; value: CoworkerApplicabilityV1 | LegacyApplicability }
    | { validity: "invalid"; findings: ApplicabilityFinding[] };
};
```

Keeping raw and parsed values preserves evidence and prevents a failed parse
from being normalized into an empty declaration.

### Version 1

```ts
type CoworkerApplicabilityV1 =
  | {
      schemaVersion: "coworker-applicability.v1";
      state: "undeclared";
    }
  | {
      schemaVersion: "coworker-applicability.v1";
      state: "declared";
      inheritsFromServiceId?: string;
      rules: CoworkerApplicabilityRuleV1[];
    };

type CoworkerApplicabilityRuleV1 = {
  scope:
    | { kind: "universal" }
    | { kind: "category"; id: string }
    | { kind: "archetype"; id: string };
  disposition: "supported" | "future" | "not-applicable";
};
```

Example:

```json
{
  "schemaVersion": "coworker-applicability.v1",
  "state": "declared",
  "rules": [
    {
      "scope": { "kind": "universal" },
      "disposition": "supported"
    },
    {
      "scope": { "kind": "archetype", "id": "medical-clinic" },
      "disposition": "not-applicable"
    },
    {
      "scope": { "kind": "archetype", "id": "law-firm" },
      "disposition": "future"
    }
  ]
}
```

### Strict Validation

Parsing fails closed when `schemaVersion` is missing/unsupported, an unknown
member is present, a state carries foreign fields, a semantic scope is
duplicated, or a string is empty/untrimmed/malformed. Contextual validation
fails closed when a category/archetype is absent from its injected registry or
an inheritance reference is missing, inactive, or cross-owner. Graph resolution
fails closed on cycles, depth overflow, and unresolved ties.

The parser returns typed findings. It does not throw raw JSON into the roster
and never converts invalid data to Not offered.

### Legacy Compatibility

Legacy arrays retain exact current meaning:

- a valid leaf string becomes one local supported leaf rule;
- a valid category string becomes one local supported category rule;
- leaf/category identifier collisions keep current leaf-first behavior;
- an empty array becomes undeclared;
- `*`, unknown strings, mixed types, and malformed values become invalid.

Arrays never mean universal, future, inherited, or excluded.

### Deterministic Resolution

For one service:

1. Validate the install leaf/category pair.
2. Parse the local declaration.
3. Validate the inheritance chain.
4. Gather matching rules.
5. Sort by specificity (`archetype = 3`, `category = 2`, `universal = 1`)
   descending.
6. Sort equal specificity by inheritance depth ascending (`local = 0`).
7. Reject an unresolved tie at the same scope and depth.
8. Return disposition, source service, source scope, and inheritance path.
9. A valid declared contract with no matching rule is undeclared. Intentional
   exclusion requires an explicit matching `not-applicable` rule, including an
   explicit universal rule when the exclusion truly applies everywhere.
10. Undeclared and invalid remain distinct remediation outcomes.

Rule array order never participates.

Across services, the projection keeps three explicit roles:

- **catalog summary service:** the one active aggregate service, used for the
  canonical owner summary and catalog-integrity checks;
- **default action service:** among supported services, stable tuple of derived
  action (`ask`, `recover-blocked`, `recover-setup`, `review-readiness`,
  `view-only`), readiness freshness, catalog role, then `serviceId` ascending;
- **remediation service:** only when no supported service exists, stable tuple
  of applicability (`invalid`, `undeclared`, `future`, `not-applicable`),
  catalog role, then `serviceId` ascending.

Canonical-owner integrity is evaluated first. `quarantined` suppresses action
selection and projects Coverage needs repair in Other with no Ask. This gives
the temporary no-aggregate state a total, fail-closed outcome.

The default action service supplies the roster job, primary business area,
interaction, reason, and optional Ask target. Ready and permitted work
intentionally wins because readiness and authority are service-specific: a
blocked sibling remains prominent on the record but cannot suppress valid work
the viewer can start. When no service is Ask-eligible, blocked outranks
setup-needed so safety recovery is not hidden. The remediation service supplies
the directory state and placement only when no supported service exists. Agent
catalog exception supplies No work offered only when there are no active
services eligible for either action or remediation. This prevents a broad
aggregate description from hiding a genuinely executable specific service
while keeping placement, action, and selected work context deterministic.

## Readiness Contract

Applicability answers whether the work belongs. Readiness answers whether the
advertised backing can execute now. Checks are canonical; state, findings, and
time boundaries are projections.

```ts
type CoworkerServiceReadinessEvidenceV1 = {
  schemaVersion: "coworker-service-readiness-evidence.v1";
  evaluatedAt: string;
  validForSeconds: number;
  checks: CoworkerReadinessCheckV1[];
};

type CoworkerReadinessCheckV1 = {
  checkRef: string;
  kind:
    | "skill"
    | "tool"
    | "grant"
    | "route"
    | "provider"
    | "capability-need"
    | "input"
    | "output"
    | "authority";
  outcome: "pass" | "fail" | "unknown";
  failureCode?: string;
  sourceRef: string;
};

type CoworkerServiceReadinessProjection = {
  status: "ready" | "setup-needed" | "blocked" | "not-evaluated";
  evaluatedAt: string | null;
  staleAfter: string | null;
  findings: CoworkerReadinessFinding[];
};
```

The expected check manifest is derived before evidence is evaluated:

```ts
type CoworkerReadinessManifest = {
  serviceId: string;
  checks: Array<{
    checkRef: string;
    kind: CoworkerReadinessCheckV1["kind"];
    sourceRef: string;
  }>;
};
```

It contains one stable `checkRef` for every declared backing skill, tool,
grant, required input, produced output, authority boundary, executable route,
selected provider, and unresolved capability need. The route source initially
comes from the Marketing implementation delivered by `BI-C1943813`; the shared
contract does not assume `route-readiness.ts` exists on main before that merge.

An executable service/offer always creates required `route:binding` and
`provider:binding` slots before lookup. If no route or provider is selected,
the evaluator still emits those checks as fail with `missing-route-binding` or
`missing-provider-binding`; absence can never remove the prerequisite.

Failure class has one owner:

```ts
const READINESS_FAILURE_CLASS_BY_KIND = {
  route: "blocked",
  provider: "blocked",
  "capability-need": "blocked",
  authority: "blocked",
  skill: "setup-needed",
  tool: "setup-needed",
  grant: "setup-needed",
  input: "setup-needed",
  output: "setup-needed",
} as const;
```

Rules:

- `evaluatedAt` must be canonical RFC 3339 UTC.
- `validForSeconds` is positive and bounded.
- `staleAfter = evaluatedAt + validForSeconds`.
- with an injected clock, `now >= staleAfter` is stale exactly at the boundary;
- invalid, absent, stale, missing-manifest, duplicate, extra, or unknown check
  evidence projects to not-evaluated;
- failed route, provider, capability-need, or authority checks project blocked;
- failed skill, tool, grant, input, or output checks project setup-needed;
- every expected `checkRef` appears exactly once and no undeclared check is
  accepted;
- `failureCode` is required for fail/unknown and forbidden for pass;
- total status precedence is not-evaluated for invalid/stale/unknown evidence,
  then blocked when any blocked-class failure exists, then setup-needed when
  any setup-class failure exists, otherwise ready;
- ready requires the complete expected manifest to pass;
- readiness is service-specific.

Findings are derived from failed/unknown checks through closed `failureCode`
and `recoveryKind` registries. Owner copy and safe destinations are projection
metadata, not stored prose or arbitrary URLs. A permission-aware recovery
resolver maps recovery kind to one allowed action, such as:

- Review approval rules
- Connect provider
- Review AI readiness
- Review coworker setup
- Complete declaration (platform operators only)

Unauthorized owners see explanatory state and `View coworker`, not a control
they cannot complete.

## Catalog Completeness

Every selectable, non-archived production coworker must have exactly one of:

- one active aggregate `CoworkerService`; or
- one non-null `Agent.coworkerCatalogExceptionReason`.

Contract migration may temporarily leave a third, explicitly invalid state:
active specific services with `catalogIntegrityStatus = "quarantined"` and no
aggregate. This is detectable remediation work, not catalog completeness.

Specific services remain additional work, never fake aggregate placeholders.
An exception is not executable, never renders under Work offered, and never
exposes Ask. It projects to No work offered with an owner-readable reason.

Every active service resolves one canonical `portfolioId`. The default action
service controls primary roster placement; when there is no executable action,
the deterministic recovery service controls placement. All active service
memberships remain visible and filterable in the directory and on the record.

Interaction is service-scoped:

- external/customer persona -> Talks to customers
- partner persona -> Works with partners
- internal -> Internal only

The roster displays interaction from the action service. The record shows each
service's scope.

## Owner State/Action Registry

The projector accepts three closed facts:

- applicability: `supported | future | not-applicable | undeclared | invalid |
  catalog-exception`;
- readiness: `ready | setup-needed | blocked | not-evaluated | stale |
  not-required`;
- viewer permission: `permitted | denied | unknown | not-required`.

One registry owns the exact label, reason template, selected service, primary
business area, primary/recovery action, recovery owner, recovery kind, tone,
and Ask eligibility:

| Applicability | Readiness | Permission | Label | Derived action |
| --- | --- | --- | --- | --- |
| supported | ready | permitted | Available | `Ask <full name>`; `View coworker` |
| supported | ready | denied/unknown | Available | Permission-aware explanation; `View coworker` |
| supported | setup-needed | any | Setup needed | Permission-aware setup action |
| supported | blocked | any | Needs attention | Permission-aware blocker action |
| supported | not-evaluated/stale | any | Readiness not checked | Review AI readiness |
| future | not-required | not-required | Coming later | View coworker |
| not-applicable | not-required | not-required | Not offered for this business | View coworker |
| undeclared | not-required | any | Coverage not defined | Complete declaration when authorized |
| invalid | not-required | any | Coverage needs repair | Repair declaration when authorized |
| catalog-exception | not-required | not-required | No work offered | View coworker |

Only `supported + ready + permitted` exposes Ask. Every unlisted combination is
invalid input and fails closed to Coverage needs repair; no consumer supplies a
fallback label or action.

## Experience Design

### Directory

Default-visible controls:

- `Find a coworker` search;
- `Business area`;
- result count announced politely when it changes.

Desktop also shows Availability and Interaction. Mobile places those secondary
controls behind `Filters (n)` so the first result remains near the initial
viewport. A no-result state explains the active constraints and provides
Reset filters.

Each result has:

- full coworker display name;
- one plain job;
- primary business area from the default action/recovery service;
- all additional service portfolio memberships as filterable facts;
- one exact availability label and short owner outcome;
- action-service interaction;
- exactly one state-specific primary command: Ask for ready and permitted work,
  the typed recovery action for setup/blocked/remediation states, or View when
  no work action exists;
- consistent secondary `View coworker` when the primary command is not View.

### Coworker Record

The existing record is the detail destination. It shows the default action
service first, the aggregate catalog summary second when different, and sibling
services after that. `OwnerFirstDisclosure` contains applicability path,
readiness checks, permission outcome, source revision/hash, provider, grants,
tools, and raw references. The directory does not duplicate this record in a
Details modal.

The visual prototype includes both directory and Marketing record states. The
record first viewport shows identity, derived availability/action, selected
service, and its primary business area. Aggregate summary and sibling services
follow as owner-readable sections. Raw applicability, provider, grant, and
source evidence stays collapsed in `OwnerFirstDisclosure`.

### Named Work Target And Ask Preview

Named work uses one versioned launch envelope:

```ts
type CoworkerNamedWorkTargetV1 = {
  schemaVersion: "coworker-named-work-target.v1";
  canonicalAgentId: string;
  providerAgentId: string;
  serviceId: string;
  offerId: string;
  routeContext: string;
  returnTo: string;
  projectionRevision: string;
};

type CoworkerRecoveryTargetV1 = {
  schemaVersion: "coworker-recovery-target.v1";
  canonicalAgentId: string;
  serviceId: string;
  recoveryKind: "setup" | "readiness" | "authority" | "declaration" | "declaration-conflict";
  blockerRef?: string;
  routeContext: string;
  returnTo: string;
};
```

The projector creates the target from the selected default action service.
`Ask` is ineligible unless that service has one active offer, so a named-service
target always has a durable `offerId`; a service without one routes to Setup or
Backlog and cannot silently fall through to a generic prompt. Opening the shared
panel validates identity, service/offer applicability, readiness freshness, and
viewer invocation permission against that revision.

Submission re-resolves all four server-side and rejects stale or changed
targets with a typed recovery response. In one transaction, every accepted
named-service submission creates or replays a `CoworkerEngagement` carrying the
exact `serviceId`, `offerId`, `providerAgentId`, requester, requested outcome,
route context, projection revision, invocation decision digest, and one
one-to-one `CoworkerEngagementDispatch` command **before** dispatch. Later work
capsule, tool execution, and audit references attach to that engagement. If
either receipt fails to persist, dispatch does not begin. There is no optional
unreceipted named-service path. Generic route-aware launchers remain a separate
envelope and cannot claim a named service.

The shared coworker panel/dialog shows:

- exact `Agent.displayName` from the selected canonical
  `catalogOwnerAgentId`, not the executable alias/provider row;
- selected work/service context;
- what happens after Send;
- editable request;
- explicit Send and Cancel.

Opening, filtering, navigating, or previewing never sends. Close/Escape restores
focus to the invoking action.
Submission uses the shared async-action contract: pending feedback disables
duplicate submit, success settles explicitly, and failure preserves the request
with a retry action.

`apps/web/lib/coworker-service-catalog/invocation-decision.ts` owns the sole
server-side `resolveCoworkerServiceInvocationDecision` resolver. It takes the
authenticated principal and organization, canonical Agent, provider Agent,
service/offer, route context, requested authority action, funding context, and
contract context. The resolver performs the active-offer lookup itself and
returns one closed decision:

```ts
type CoworkerServiceInvocationDecision =
  | {
      state: "permitted";
      action: "request" | "execute";
      activeOffer: { offerId: string; serviceId: string; providerAgentId: string };
      approval: { required: boolean; reasons: string[] };
      evidenceRefs: string[];
      decisionDigest: string;
    }
  | { state: "denied"; reasonCode: string; recovery: CoworkerRecoveryTargetV1 }
  | { state: "unknown"; reasonCode: string; recovery: CoworkerRecoveryTargetV1 };
```

The resolver derives typed evidence from existing RBAC roles, memberships, TAK
authority bindings, active-offer state, and action-specific funding, contract,
and approval policy. It is separate from service readiness and from the
coworker's own tool grants. Unknown fails closed. Directory projection, panel
open, `/api/agent/send`, MCP `request_coworker_engagement`, and A2A task creation
call the same resolver with the same serialized named-work target. The existing
`createCoworkerEngagement` is refactored to require a permitted decision and
must not look up the offer or derive approval independently. Only `permitted`
may create the engagement; `approval.required` persists as `needs-approval` and
does not dispatch early. Client labels or hidden controls never decide
permission.

### Durable Engagement Dispatch

The substrate sweep found no implemented general durable-execution contract.
`BI-PSC-004` owns that platform convergence. `DataControlOperationStep` already
proves DPF's lease/CAS recovery pattern, but its schema is owned by
consequential cross-store data mutation and is not reused for AI messages.
`TaskRun` remains execution history, not the delivery command.

`BI-PSC-004` is a hard implementation prerequisite for durable named Ask. It
must first publish and review the canonical vendor-neutral publish, claim,
lease, retry, receipt, reconciliation, cancellation, and quiescence interface,
plus its ownership and conformance tests. The declaration work then adds one
narrow `CoworkerEngagementDispatch` adapter row with a
unique `engagementId` relation and fields for `idempotencyKey`, `payloadDigest`,
`state`, `attempt`, `leaseOwner`, `leaseExpiresAt`, `nextRetryAt`,
`providerReceipt`, `reconciliationReceipt`, `errorClass`, and timestamps. It
implements the same repository/runner boundary and compare-and-set lease
semantics as `DataControlOperationStep` through that canonical interface.
Declaration releases may ship read models, directory states, and non-dispatch
UI beforehand, but named Ask cannot activate on an install until the
`BI-PSC-004` conformance gate passes. This design does not create a scheduler,
worker lifecycle, or parallel durable-execution interface.

The state machine is
`awaiting-approval | pending -> leased -> succeeded | failed | ambiguous`.
Approval-free decisions create `pending`; approval-required decisions create
`awaiting-approval`. A transactional approval CAS requires matching engagement,
decision digest, approver authority, and approval evidence before moving both
engagement and dispatch to their executable states. The worker claim predicate
requires `dispatch.state = pending`, an executable engagement status, and no
active cancellation/quiescence marker; `awaiting-approval` is never leaseable.
An expired `leased` row is reclaimable. A retryable failure returns to pending
with `nextRetryAt`.
`ambiguous` means the provider call may have completed without a persisted
receipt: the worker must reconcile by engagement/idempotency key before any
retry and may never blindly send again. The API transaction returns the
engagement and dispatch status immediately; it does not own a long-lived
in-process `sendMessage` promise.

Required recovery tests cover:

- crash after transaction commit and before lease acquisition;
- crash after lease acquisition and before provider call;
- lease expiry and one-worker takeover;
- provider completion followed by receipt-write failure;
- ambiguous reconciliation finding completed/not-completed/unknown;
- concurrent and response-loss retries returning the same engagement;
- a reused idempotency key with a different payload digest failing closed;
- approval-required creation remaining unleaseable before approval;
- unauthorized/stale/double approval CAS rejection and one authorized
  transition to pending;
- cancellation and quiescence preventing a new lease.

Component tests assert the card heading, View label, Ask label, dialog title,
Send label, and selected canonical Agent identity all carry the same
`displayName`. This catches the current Marketing dual-row case, where the
canonical roster row and executable slug row have different seeded names.

### Responsive And Accessible Behavior

- Use the real responsive portal shell; the prototype is a content-region
  study and intentionally does not invent navigation.
- Provide a real skip link, semantic fieldsets/labels, polite live counts,
  unique action names, visible focus, and deterministic focus restoration.
- At 390x844, cards remain one column, actions wrap without overflow, and the
  first result is not displaced by fully expanded secondary filters.
- Integrated-shell acceptance must keep the first result identity and state in
  the initial mobile viewport; the content-only prototype cannot prove shell
  headroom by itself.
- Use current DPF tokens and roster/status/record primitives in light, dark,
  and branded themes.
- Recovery links carry canonical Agent id, selected service id, recovery kind,
  blocker references where present, route context, and return destination.
- Governed fixtures cover permitted, denied, and unknown viewer permission for
  setup, blocker, readiness, undeclared, and invalid recovery families.

## Source Ownership And Fleet Convergence

The authored declaration registry is the sole source, moved out of
`COWORKER_SERVICE_CATALOG_SERVICE_SEEDS` into
`coworker-service-declarations.ts`; the existing seed module imports and maps
that registry. No parallel seed list remains. Every existing
`CoworkerService` upsert/update path is inventoried: governed-field writes must
use the CAS writer or explicitly remain operator-owned.

Seed convergence is compare-and-swap, not overwrite:

- source declarations carry a monotonically increasing
  `declarationSourceRevision` and canonical `declarationSourceHash`;
- the hash is SHA-256 over RFC 8785 JCS bytes for the governed field set:
  catalog role/owner, portfolio, personas/interaction, applicability, backing
  skills/tools/grants, required inputs, produced outputs, and authority;
- adoption to `platform-seed` ownership is allowed only when the recomputed
  semantic hash matches a known legacy source snapshot;
- a row remains `platform-seed` owned only while the recomputed current hash
  matches the last applied source hash;
- an operator edit transitions ownership to `operator`;
- an atomic update requires owner, expected prior revision, stored prior hash,
  recomputed current hash, and `updatedAt` to match;
- unknown, invalid, or operator-owned values are reported, not rewritten;
- repeated reseed at the same source revision is idempotent;
- lost updates and interrupted batches preserve the current row and emit
  conflict evidence.

### Release R: Reader

`BI-3FB40CCA`:

1. Add expand-only schema fields, canonical owner backfill, and typed
   registries without a unique index.
2. Add shared legacy+v1 parser.
3. Move every DB/web consumer to the parser.
4. Preserve raw plus parsed values.
5. Continue writing legacy arrays only.
6. Deploy and prove no-regression plus rollback to the prior binary.

### Release C: Aggregate Contract

`BI-2E7972A7`:

1. Read runtime duplicate reports keyed by canonical catalog owner.
2. Apply source/operator-approved remediation where ownership is known.
3. In the contract migration, quarantine any residual duplicate set by
   demoting all members to specific while retaining active services.
4. Add canonical-owner partial uniqueness.
5. Enforce canonical-row Agent exception and aggregate/exception exclusion.

### Install-Local Compatibility Gate

The existing `PlatformConfig` model owns key
`coworker-applicability-storage`, parsed as:

```ts
type CoworkerApplicabilityStorageStateV1 = {
  schemaVersion: "coworker-applicability-storage.v1";
  readerVersion: 0 | 1;
  writerVersion: 0 | 1;
  readerActivatedAt: string | null;
  readerSourceSha: string | null;
  writerActivatedAt: string | null;
  writerSourceSha: string | null;
  writerActivatedForRunId: string | null;
};
```

Reader activation is written only after the served portal passes post-deploy
health. Self-upgrade recovery evidence records the pre-swap
`recoveryReaderVersion` and `recoverySourceSha`. Writer enablement has two
separate predicates so activation never depends on fields it is responsible
for writing.

`canActivateWriter(runId)` requires:

1. running binary compile-time reader and writer versions are both at least 1;
2. install-local `readerVersion >= 1`;
3. `runId` resolves one successful `SelfUpgradeRun`; both `deployedSha` and
   `targetSha` match `EXACT_GIT_SHA_RE = /^[0-9a-f]{40}$/i`, are normalized to
   lowercase, and current served SHA equals that run's `deployedSha`;
4. readiness/completion evidence persists `promoterSourceSha` extracted from
   the validated OCI `org.opencontainers.image.revision` label, and it equals
   `deployedSha` (`builtStamp`), not the upstream lineage marker;
5. only after exact-SHA validation, `shaContains(deployedSha, targetSha)` proves
   the deployed build contains the upstream lineage. The existing helper's
   prefix matching cannot independently satisfy this gate. The SHAs may be
   equal for direct/fast-forward installs and are expected to differ for
   merge-mode installs;
6. the run's recovery point is complete, its `recoverySourceSha` equals the
   same run's `currentSha`, and `recoveryReaderVersion >= 1`;
7. the target promoter manifest digest in readiness/completion evidence is the
   digest launched by that run and declares writer version 1;
8. the recovery source SHA resolves to a manifest declaring reader version 1;
9. no storage-integrity blocker is active.

The post-health activation transaction evaluates `canActivateWriter`, locks the
`PlatformConfig` row, rechecks the served/run bindings, then atomically writes
`writerVersion = 1`, `writerSourceSha = deployedSha`, and
`writerActivatedForRunId = runId`. Repeating activation for the exact same
marker is idempotent; a conflicting marker is rejected.

`canWriteV1` then requires:

1. the compile-time reader/writer floor;
2. install-local reader/writer version 1;
3. current served SHA equals `writerSourceSha`;
4. `writerActivatedForRunId` resolves the same successful run; and
5. `canActivateWriter(writerActivatedForRunId)` still passes.

The target promoter contract manifest carries minimum reader/storage versions,
and readiness fails closed on unknown versions. A direct pre-Reader -> Writer
upgrade runs in legacy-array mode because its recovery target is pre-Reader.
The release channel normally stages Reader R first; direct upgrade remains
safe but cannot activate v1 writes until a later governed recovery point has a
Reader-capable target.

The ancestry check uses the existing self-upgrade completion contract only
after both values pass the full-SHA guard. Abbreviated or colliding prefixes,
malformed/non-Git values, and missing or mismatched `promoterSourceSha` fail
closed. An unrelated, stale, failed, or superseded recovery run cannot satisfy
either predicate.

### Release W: Writer

`BI-33A623D0`:

1. Enable v1 writes behind the install-local compatibility predicate.
2. Adopt only known semantic-equivalent legacy source snapshots.
3. Apply RFC 8785/SHA-256 source revision/hash CAS.
4. Preserve/report concurrent and operator-owned values.
5. Keep the Reader R binary as the supported rollback target.

### Release E: Readiness Evidence

`BI-1FDEF342` derives the expected check manifest, normalizes Marketing
evidence, and establishes total status/recovery semantics before fleet
declarations depend on readiness.

### Release D: Portfolio Declarations

Four independently reviewable batches can proceed after C, W, and E:

1. Customers and sales: `BI-A00EAD43`
2. Your team: `BI-A02A060E`
3. Operations and delivery: `BI-3BDB5C04`
4. Platform and back office: `BI-F798996C`

Each batch owns its source declarations, cross-archetype fixtures, and
portfolio-local integrity evidence. Customer-facing work remains first in
priority, but one batch does not need one oversized writer PR to land.

After W writes v1, rollback to a pre-Reader binary is prohibited because it
cannot interpret v1. Rollback to Reader R is safe and required to remain
tested.

## Integrity Detection

Source guards fail CI for:

- a seeded production coworker with neither aggregate service nor Agent
  exception;
- missing or inconsistent canonical catalog owner;
- duplicate active aggregate services after contract release C;
- contradictory aggregate-plus-exception state;
- catalog exception authored on an alias Agent row;
- an active service without canonical portfolio;
- a route or launcher absent from the canonical AI Workforce disposition
  registry;
- unknown applicability identifiers, members, or versions;
- inheritance cycle, missing/inactive/cross-provider parent, or tie;
- unsupported backing skills, tools, grants, inputs/outputs, or authority;
- readiness evidence that does not exactly cover its derived manifest;
- source revision/hash regressions;
- writer enablement without install and recovery reader evidence.

Runtime integrity reports:

- selectable coworkers missing catalog declarations;
- missing/orphan portfolios;
- invalid applicability;
- unavailable backing;
- stale/invalid readiness;
- operator/source ownership divergence;
- Other rows and their exact remediation cause.

Detection does not mutate live records.

## Verification Matrix

Contract tests cover:

- legacy arrays and strict v1 tagged unions;
- key and rule array permutation;
- unknown keys and duplicate semantic scopes;
- universal/category/leaf support and exclusions;
- future and not-applicable at each scope;
- one/multi-level inheritance and local override;
- specific inherited rule versus broader local rule;
- cycles, inactive/missing/cross-provider parent, depth overflow, and ties;
- parser parity from DB and web imports;
- old reader behavior before v1 writes;
- Reader R old-binary compatibility after v1 writes;
- expand migration on dirty/contradictory slug and `AGT-*` fixtures;
- contract migration quarantine plus canonical-owner unique enforcement;
- aggregate/exception ownership transitions;
- RFC 8785 hash order independence;
- legacy adoption, lost-update, interrupted/repeat reseed, and ownership
  transition;
- direct pre-Reader -> Writer upgrade staying in array mode;
- recovery point reader-version predicate;
- activation-before-marker and write-after-marker predicate separation;
- abbreviated/colliding SHA-prefix rejection plus exact fast-forward and exact
  merge-ancestry acceptance;
- missing/mismatched OCI-derived `promoterSourceSha` rejection;
- merge-mode promoter source bound to `deployedSha` while `targetSha` remains
  the contained upstream lineage;
- readiness manifest missing/duplicate/extra checks;
- readiness derivation with an injected clock immediately before, at, and
  after the stale boundary;
- every state/recovery action and permitted/denied/unknown fallback;
- named-work target validation at open and submit, including stale projection,
  changed permission, and service/offer mismatch;
- named-service Ask ineligibility without an active offer, mandatory
  pre-dispatch `CoworkerEngagement` persistence, and no dispatch after receipt
  failure;
- invocation-decision parity across projection, panel, HTTP, MCP, and A2A,
  including active-offer and approval ownership;
- crash-before-call, lease-expiry takeover, ambiguous provider completion,
  reconciliation-before-retry, cancellation, and quiescence dispatch fixtures;
- catalog-owner recomputation for every null, stale, alias, and incorrectly
  populated row before duplicate grouping/quarantine;
- fast-forward and merge-mode writer activation, including distinct
  target/deployed SHA acceptance only when ancestry and promoter evidence bind;
- exhaustive generated service-by-registered-archetype resolution.

The HTML prototype is visual and interaction evidence only. It may assert that
one versioned target shape is carried from the illustrated button to its
preview, but it cannot prove server permission revalidation,
`CoworkerEngagement` persistence, idempotent dispatch, or receipt durability.
Those require integrated route/component/DB tests and live runtime evidence.

Live acceptance covers:

- active Restaurant / food-hospitality install;
- at least one coworker in each business area;
- Marketing as the first positive Available slice;
- every canonical state through governed fixtures;
- every registered archetype crossed with every selectable coworker; each cell
  resolves supported, future, or not-applicable, while undeclared/invalid cells
  produce backlog evidence;
- desktop and 390x844 mobile;
- search, business-area filter, secondary mobile filters, no-result/reset;
- directory -> record -> exact named Ask preview;
- no auto-send;
- keyboard, focus restoration, Axe, console, and horizontal overflow.
- context-preserving recovery links for every recovery family and viewer
  permission outcome.

## Independent Review

Earlier architecture reviews found rollback-unsafe object writes, duplicate
not-offered ownership, fleet-unsafe tightening, alias uniqueness gaps, an
unowned writer gate, non-atomic source adoption, incomplete readiness manifests,
and an over-broad writer release. Evidence is recorded on `BI-97CD9E4B`.

Earlier UX review required immediate search and Business area filtering, mobile
secondary-filter disclosure, exact Ask identity, record reuse, canonical
states, permission-aware recovery, real-shell compatibility, and explicit
accessibility behavior. A later cross-design critique
`cms89aasd02zh01qobapm3tok` found the remaining P0 placement and state/action
conflicts. WWMD evidence `cms89hv2a038101qoy22jq12a` resolved them through
`action-service-primary` and `orthogonal-facts-derived-state`.

Review candidate `306b529c5bb60a60f0637fb70cb34c184d374dbd` was not
approved. Architecture reviewer `019fb701-377b-72e3-8c27-b480fced5aa4`
deferred it for missing named-service launch identity, unowned invocation
permission, non-executable fleet migration mechanics, incomplete surface
classification, duplicate seed ownership, representative-only archetype
coverage, and conflated parse/graph validation. UX reviewer
`019fb701-5ba5-7f63-bb40-83f0a09a8e4b` deferred it for incomplete surface
disposition, result-count/action hierarchy defects, contextless recovery,
missing record visuals, incomplete permission/archetype fixtures, and
accessibility/success-state defects.

Review candidate `234100a800f82f291b357a3c9238fe515664e9ff` was also
deferred. Architecture reviewer `019fb716-4b61-7ff3-a468-938aef7f6f97`
required merge-mode-aware self-upgrade activation, complete catalog-owner
recomputation before duplicate quarantine, and mandatory durable service/offer
binding for every named-service submission. UX reviewer
`019fb716-7566-7ee0-8575-16e408fbdaa2` required the omitted owner-first Finance
launcher, context-preserving recovery for non-operators, semantic primary
styling for view-only states, and owner-language Finance copy. The next
candidate incorporates those findings and remains subject to fresh independent
review.

Review candidate `3720ae1c4f8cd94acaaec02717a14cb05d2d736d` was
deferred by architecture reviewer `019fb722-8144-7fe1-b0f8-ac4c709f5f12`
for a circular writer marker predicate, incorrect merge-mode promoter binding,
implicit exclusion on an unmatched archetype, an under-specified real submit
boundary/idempotency contract, and lifecycle fields that did not distinguish
current from target routes. UX reviewer
`019fb722-8205-7943-8e14-0da53c9ce8b4` returned
`fits-with-guardrails` after verifying all 41 current routes, five planned
lenses, and current launcher mounts; its guardrails were plural search, a real
full-viewport mobile dialog with Escape/scroll lock, complete authorized
recovery context, owner-language prerequisites, and a record-specific skip
label. Those findings are folded into the next exact candidate.

Review candidate `34ff4a33ae5a05dcb67dc285d22214eb6930bb4e` received
terminal UX fit from reviewer `019fb733-4bf8-7eb1-8c6d-503ff548c410`, with no
P0, P1, or P2 findings after measured desktop and 390x844 browser acceptance.
Architecture reviewer `019fb733-4b1b-7363-ba35-9a29064e8003` deferred it for
prefix-permissive writer ancestry, route lifecycle rows without a machine
destination, at-most-once rather than crash-recoverable dispatch, split
permission/approval ownership, and an imprecise promoter-source evidence name.
This candidate closes those findings. Substrate verification found
`DataControlOperationStep` as the reusable lease/CAS pattern and `BI-PSC-004`
as the future vendor-neutral contract, while confirming neither
`CoworkerEngagement` nor `TaskRun` currently owns durable dispatch. WWMD
interaction `DI-4EA59A3AE69C` selected a one-to-one engagement dispatch record
with high confidence (margin 4.017), led by Ship Real Functionality and Research
and Use Standards, with no commandment conflict.

Review candidate `9ca40eef7a2eb645b5cd16d18d12b6908d8e6677` retained
terminal UX fit from reviewer `019fb733-4bf8-7eb1-8c6d-503ff548c410`, again
with no P0, P1, or P2 findings after independent browser measurement.
Architecture reviewer `019fb733-4b1b-7363-ba35-9a29064e8003` confirmed the
strict SHA, promoter evidence, machine destination, crash recovery, and unified
invocation-decision corrections, then deferred three follow-ons: approval state
was not in the worker claim predicate, `BI-PSC-004` alignment lacked a hard
dependency, and route context transforms lacked a structured registry field.
This revision adds the unleaseable approval state and approval CAS, makes the
canonical durable-execution interface a prerequisite, and defines the
versioned machine context mapping.

The correction defines the versioned named-work target and server permission
resolver, migration-local SQL alias map and canonical-row locking, sole seed
registry, staged parser/validator/graph resolver, exhaustive archetype matrix,
canonical 41-route plus launcher disposition registry, directory and record
visual states, contextual recovery, and measured prototype fixes. This revision
is still not self-approved: fresh architecture and UX reviewers must return
terminal findings against its exact SHA before the design PR opens. Both review
again against implementation plus measured real-shell browser evidence.

## Refactoring Allowance

Roughly 20 percent of implementation effort is reserved for direct convergence:

- one shared applicability parser;
- one raw+parsed catalog read model;
- one readiness evidence projector;
- one canonical owner-state/action registry;
- removal of metadata.aggregate and duplicated display-state logic.

This allowance excludes unrelated route, schema, or visual cleanup.

## Rollback Summary

| Stage | Safe rollback |
| --- | --- |
| Before Reader R | Current binary and legacy arrays |
| Reader R deployed, arrays still written | Prior binary or Reader R |
| Contract C deployed, arrays still written | Reader R or Contract C |
| Direct pre-Reader -> Writer deployment | Pre-Reader recovery remains safe; writer stays disabled |
| Writer W enabled and v1 persisted | Reader R or later only |
| Writer/declaration defect | Disable writer, retain Reader R, restore source registry revision |
| UI consumer defect | Revert UI while retaining conservative projections |

No rollback silently converts invalid/unknown state to Available.
