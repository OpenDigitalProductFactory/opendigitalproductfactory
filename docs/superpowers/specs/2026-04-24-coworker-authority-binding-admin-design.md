# Coworker Authority Binding And Admin UX Design

**Date:** 2026-04-24  
**Status:** Draft  
**Scope:** Define the canonical authority-binding model and human admin UX for configuring AI coworker access, route/workspace application, and principal access in a way that extends DPF's existing identity, directory, governance, `TAK`, `GAID`, and A2A-aligned work.

---

## Problem Statement

DPF already has real coworker governance and real identity foundations:

- directory-oriented principal modeling
- LDAP/AD-style federation framing
- coworker identity and governance records
- delegation grants
- proposal-gated actions
- tool-grant enforcement
- audit and authority inspection surfaces

What DPF does not yet have is a canonical configuration model and admin UX for applying those controls where they matter operationally:

- which human groups or roles can access a route or workspace
- which coworker is applied to that route or workspace
- what in-context authority posture that coworker has there
- which humans, groups, or teams can access a coworker outside one route
- how those bindings are edited from both the identity side and the AI side without drift

Right now, the platform can inspect much of this posture across four separate surfaces ([authorization bundle](../../../apps/web/app/(shell)/platform/identity/authorization/page.tsx), [authority matrix and delegation chain](../../../apps/web/app/(shell)/platform/audit/authority/page.tsx), [route decision log](../../../apps/web/app/(shell)/platform/audit/routes/page.tsx), [coworker agent detail](../../../apps/web/app/(shell)/platform/ai/agent/%5BagentId%5D/page.tsx)), but it cannot manage any of it — every one of those surfaces is read-only. That leaves a gap between the standards story (`TAK`, `GAID`, A2A-shaped runtime) and the actual human-operable control plane, and it means the answers to "who can access route X" and "what can coworker Y do on route X" require stitching together four tabs.

This design closes that gap by introducing a single shared authority-binding layer with dual-entry admin UX:

- **Human-first** entry under `/platform/identity/authorization` for the "who has access" mental model
- **Coworker-first** entry under `/platform/ai/assignments` for the "where is this coworker applied" mental model

Both surfaces list and filter the same underlying `AuthorityBinding` records and open the same shared detail drawer, so editing one propagates to the other by construction — not by convention.

The existing audit cluster (`/platform/audit/*`) stays the evidence plane: it observes decisions, it does not edit policy. That config-vs-audit split is already a convention in the codebase and this design reinforces it rather than rearranging it.

---

## Goals

1. Reuse DPF's existing identity, coworker, delegation, and audit models rather than creating a parallel authorization stack.
2. Keep humans and AI coworkers as separate principal classes while evaluating them through one shared authority vocabulary.
3. Make route/workspace application of coworkers and access policy explicit, reviewable, and editable in central admin areas.
4. Support both route-scoped authority and principal-scoped coworker access.
5. Preserve `TAK` controls: intersection-based authorization, human approval, delegation, and audit trail.
6. Make the model compatible with the A2A-shaped runtime direction by giving tasks, routes, and coworkers a canonical applied authority context.
7. Align with `GAID` by making coworker identity posture, declared limitations, and applied authority bindings inspectable and governable.
8. Keep runtime/domain pages as consumers of applied policy, not the primary editing surface.

## Non-Goals

- Replacing the existing local workforce, directory, or coworker tables in one cutover
- Modeling AI coworkers as human identities just because LDAP can represent both in one directory
- Moving configuration onto runtime pages such as `/finance` or `/storefront`
- Replacing `AgentToolGrant`, `DelegationGrant`, or `AgentGovernanceProfile`
- Defining external federation protocols in this slice
- Delivering the full implementation in this design document

---

## Current-State Anchors

The design extends current repo truth, and must preserve already-landed navigation conventions.

### Data models already in place

- Principal and directory foundation in [schema.prisma](../../../packages/db/prisma/schema.prisma) on `Principal` and `PrincipalAlias`
- Human role and team layers on `PlatformRole`, `UserGroup`, `Team`, `TeamMembership`
- Coworker identity and posture on `Agent`, `AgentOwnership`, `AgentGovernanceProfile`, `AgentCapabilityClass`, `DirectivePolicyClass`, `AgentToolGrant`, `DelegationGrant`
- Decision evidence on `AuthorizationDecisionLog` (note: already carries `routeContext`, `sensitivityLevel`, `mode`, and `delegationGrantId`)

### URL inventory (do not collide with these)

The AI cluster has already been tidied once; several URLs the reader might assume are free are in fact permanent redirects:

| Current URL | Status | What lives there today |
| --- | --- | --- |
| `/platform/ai` | active | AI Workforce landing (tiered coworker list, provider pinning) |
| `/platform/ai/agent/[agentId]` | active | Coworker detail (governance, grants, delegation) |
| `/platform/ai/assignments` | active | Coworker ↔ model/tier/budget assignment table |
| `/platform/ai/model-assignment` | redirect → `/platform/ai/assignments` | legacy |
| `/platform/ai/authority` | redirect → `/platform/audit/authority` | legacy |
| `/platform/ai/routing` | redirect → `/platform/audit/routes` | legacy — **the name "routing" means "routing decisions"; do not reintroduce it for a config editor** |
| `/platform/ai/skills`, `/platform/ai/providers`, `/platform/ai/operations`, `/platform/ai/build-studio`, `/platform/ai/history` | active | peer AI config and activity surfaces |
| `/platform/identity` | active | Identity & Access landing (six summary cards) |
| `/platform/identity/authorization` | active | Role/team/coworker coverage bundle (read-only today) |
| `/platform/identity/{directory,federation,groups,principals,applications,agents}` | active | peer identity surfaces |
| `/platform/audit/authority` | active | Authority matrix + delegation chain + effective permissions inspector |
| `/platform/audit/routes` | active | Route decision log |

### Reusable components already shipped

These should be extended, not reinvented:

- `AuthorizationBundlePanel` — role + route + capability listings at [identity/authorization](../../../apps/web/app/(shell)/platform/identity/authorization/page.tsx)
- `AuthorityMatrixPanel`, `DelegationChainPanel`, `EffectivePermissionsPanel` — at [audit/authority](../../../apps/web/app/(shell)/platform/audit/authority/page.tsx)
- `RouteDecisionLogClient` — at [audit/routes](../../../apps/web/app/(shell)/platform/audit/routes/page.tsx)
- `AgentGovernanceCard`, `AgentProviderSelect` — coworker summary rendering

### Important current truth

- DPF already distinguishes directory principal kinds including `human`, `agent`, and `service`.
- DPF already treats LDAP/AD-style systems as upstream/read-first identity sources, not the sole authorization engine.
- DPF already computes effective coworker tool access as an intersection of human authority and agent grants.
- DPF already separates **config** surfaces (`/platform/identity/*`, `/platform/ai/*`) from **evidence** surfaces (`/platform/audit/*`). This spec preserves that split.
- DPF does not yet have a canonical editable binding model for route/workspace authority application.
- `/platform/identity/authorization` and `/platform/audit/authority` together already render four out of the five views this spec needs — the missing primitive is the editable binding, not new read surfaces.

---

## Research And Benchmarking

This design intentionally follows best-of-breed identity patterns instead of inventing a one-off AI grant model.

### Systems compared

#### 1. Microsoft Entra workload identities

Relevant docs:

- [Microsoft Entra Workload Identities overview](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-overview)
- [Conditional Access for workload identities](https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/workload-identity)

What matters:

- Microsoft explicitly separates human identities from non-human workload identities.
- Workload identities still participate in the same enterprise authorization fabric.
- Security posture is stronger when non-human identities are first-class service principals rather than pseudo-users.

What we adopt:

- AI coworkers should be first-class non-human principals.
- They should live in the same authority plane as humans, but not share the same lifecycle semantics.

#### 2. Google workforce and workload identity federation

Relevant docs:

- [Google Workforce Identity Federation overview](https://cloud.google.com/iam/docs/workforce-identity-federation)
- [Google Workload Identity Federation overview](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
- [Google identities for workloads](https://cloud.google.com/iam/docs/workload-identities)

What matters:

- Google separates workforce access from workload access while keeping both inside one IAM model.
- Attribute mapping and conditional access are central.
- Resource access is expressed through identity-plus-policy, not by embedding authorization rules into each application route ad hoc.

What we adopt:

- DPF should use one shared binding model with explicit scope.
- Route/workspace resources should be first-class protected resources with attached policy.
- Human and coworker access should be represented through attributes and bindings, not bespoke page-local logic.

#### 3. NIST Zero Trust Architecture

Relevant doc:

- [NIST SP 800-207 Zero Trust Architecture](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf)

What matters:

- Access decisions are made against subjects, resources, and policy.
- Subjects are not limited to human users.
- Authorization is contextual and policy-mediated rather than inferred from network location or UI placement.

What we adopt:

- Route/workspace access should be treated as protected resource access.
- DPF should evaluate effective authority from subject + resource + policy context.

#### 4. A2A protocol discovery model

Relevant docs:

- [A2A specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
- [A2A proto](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto)
- [A2A extensions guide](https://a2aprotocol.ai/docs/guide/a2a-extensions)

What matters:

- `AgentCard` supports capabilities, skills, security schemes, and security requirements.
- A2A supports extensions when stricter requirements or additional structure are needed.
- A2A is strong for declaring interaction requirements, but weak as a full enterprise authority model.

What we adopt:

- DPF should keep its richer route, approval, delegation, and limitation semantics in platform-specific bindings and `GAID` / `TAK` artifacts.
- Applied authority posture should be projectable into A2A-friendly declarations later, not forced into the A2A core model prematurely.

### Patterns adopted

- Shared enterprise authorization plane with separate human and non-human principal classes
- Resource-centric policy binding
- Central administration with multiple mental-model entry points
- Attribute- and context-aware effective access evaluation
- Extension/profile layering where generic protocol fields are insufficient

### Patterns rejected

- Treating AI coworkers as fake humans
- Keeping route access and coworker access as unrelated configuration systems
- Putting the authoritative edit UI on runtime pages
- Forcing all authority nuance into A2A core fields

### Differentiator

DPF needs to prove how coworker identity, runtime governance, route application, and human directory policy work together at platform scale. That requires a stronger shared binding model than mainstream IAM products expose natively for AI coworkers.

---

## Design Principles

1. One authority plane, multiple principal types.
2. One source of truth for a binding, multiple admin entry points.
3. Intrinsic coworker posture and applied coworker posture must remain distinct.
4. Route/workspace resources are first-class governable objects.
5. Runtime access is computed, not implied.
6. Human approval, delegation, and audit remain kernel-enforced controls, not UX conventions.

---

## Recommended Target Model

The best-practice model for DPF is:

- humans as workforce principals
- AI coworkers as workload principals
- routes/workspaces as protected resources
- one shared authority-binding framework describing how principals and coworkers may interact with those resources

This yields two different but connected kinds of authority:

1. **Resource-scoped authority**
   Defines who can access a route/workspace and which coworker and in-context posture apply there.

2. **Principal-scoped coworker access**
   Defines who can access or invoke a coworker outside one specific route/workspace.

This is the same broad architecture used by stronger enterprise IAM systems: one policy plane, distinct identity classes, contextual evaluation, and resource-bound enforcement.

---

## Object Model

### Existing models to keep

These stay canonical for their existing purposes:

- `Principal` and `PrincipalAlias`
- `PlatformRole`
- `UserGroup`
- `Team`
- `TeamMembership`
- `Agent`
- `AgentOwnership`
- `AgentGovernanceProfile`
- `AgentToolGrant`
- `DelegationGrant`
- `AuthorizationDecisionLog`

### New canonical models

#### `AuthorityBinding`

The primary shared policy object.

Proposed shape:

- `bindingId`
- `name`
- `scopeType`
  - `route`
  - `workspace`
  - `coworker-access`
  - `team-scope`
- `status`
  - `draft`
  - `active`
  - `disabled`
  - `retired`
- `resourceType`
  - `route`
  - `workspace`
  - `agent`
  - `domain`
- `resourceRef`
  - route key, workspace key, agent ref, or domain key
- `appliedAgentId`
  - nullable
- `policyJson`
  - normalized applied policy envelope
- `authorityScope`
  - normalized action/data scope limits for this binding
- `approvalMode`
  - `none`
  - `proposal-required`
  - `human-required`
- `sensitivityCeiling`
- `createdAt`
- `updatedAt`

Purpose:

- provides a single editable and auditable object representing applied authority in a context
- becomes the detail page edited from both admin entry points

#### `AuthorityBindingSubject`

Attaches allowed or governing subjects to a binding.

Proposed shape:

- `authorityBindingId`
- `subjectType`
  - `platform-role`
  - `team`
  - `principal`
  - `agent`
- `subjectRef`
- `relation`
  - `allowed`
  - `required`
  - `owner`
  - `observer`

Purpose:

- supports group/role/team/principal association without duplicating columns on the binding

#### `AuthorityBindingGrant`

Represents in-context grant constraints and overrides that narrow, never widen, intrinsic coworker posture.

Proposed shape:

- `authorityBindingId`
- `grantKey`
- `mode`
  - `allow`
  - `deny`
  - `require-approval`
- `rationale`

Purpose:

- captures route/workspace-specific narrowing of a coworker's intrinsic tool or action posture

#### `RouteResource`

Optional but recommended explicit route registry record.

Proposed shape:

- `routeKey`
- `pathPattern`
- `workspaceKey`
- `domain`
- `status`
- `defaultAuthorityBindingId`

Purpose:

- makes route authority configuration explicit and queryable rather than inferred from scattered route strings
- supports the user's requirement that route definition itself carries configuration posture

### Relationship to current models

The new binding layer never replaces intrinsic posture; it only narrows it. The existing models keep their current meaning:

- **`AgentToolGrant`** — coworker's intrinsic capability posture. What a coworker can *ever* be allowed to do in principle. Seeded per coworker; edited on the coworker detail page.
- **`DelegationGrant`** — time- and scope-bounded delegation from a human to a coworker. Already carries `scopeJson`, `riskBand`, `validFrom`, `expiresAt`, `maxUses`, `workflowKey`. Keeps its role as the per-act authorization envelope.
- **`AgentGovernanceProfile`** — `capabilityClass`, `directivePolicyClass`, `autonomyLevel`, `hitlPolicy`. Intrinsic to the coworker identity.
- **`AuthorityBinding`** (new) — *applied* policy on a resource. Says "on this route/workspace, these subjects are governed by this coworker under this approval mode."
- **`AuthorityBindingGrant`** (new) — *in-context narrowing* of intrinsic posture for the duration of this binding. Can downgrade `AgentToolGrant` (e.g. `ledger_write` → `require-approval`), never upgrade it.
- **`AuthorizationDecisionLog`** — already carries `routeContext`; extend with a nullable `authorityBindingId` FK so evidence traces to the governing binding.

### Effective authority rule

For any `(humanPrincipal, coworker, resource, actionKey)` decision:

```text
effective = humanPolicy(humanPrincipal, actionKey)
          ∩ intrinsicAgent(coworker, actionKey)           // AgentToolGrant + AgentGovernanceProfile
          ∩ delegationEnvelope(humanPrincipal, coworker)  // DelegationGrant (if present)
          ∩ binding(resource, coworker, actionKey)        // AuthorityBinding + AuthorityBindingGrant
          ∩ runtimeTAKControls(…)                         // sensitivity, HITL, approval gating
```

Monotonicity rule: each term can only narrow the result, never widen. If a binding is absent for a `(resource, coworker)` pair, the term is "unconstrained" (effectively `⊤`) and the intersection falls through to the other terms. This is the same rule the platform evaluates today — the `AuthorityBinding` layer simply makes the fourth term explicit and editable rather than implicit in route handlers.

The `EffectivePermissionsPanel` at `/platform/audit/authority` should be extended to show each term's contribution to the final decision, including which `AuthorityBinding` (if any) narrowed it.

---

## Admin UX Structure

### Clustering rule

The cohesion problem solved here is simple: **one binding record, one detail editor, two list surfaces framed to match the mental model of the admin who opens it.** Every other list/filter/pivot in this spec reduces to a view over the same table.

Before laying out routes, resolve three questions up front:

1. **Config vs evidence.** Binding authoring lives in `/platform/identity/*` and `/platform/ai/*`. Decision logs, matrices, and inspectors stay under `/platform/audit/*` and gain read-only deep-links into the binding editor. No editing ever moves into the audit cluster.
2. **One detail, two lists.** Two parallel binding editors would drift. Instead: **one shared `BindingDetailDrawer`** reused from both list surfaces, from every runtime summary panel, and from the audit inspector's "edit this binding" link.
3. **Lists are pivots, not parallel surfaces.** A single `BindingList` component supports the pivots — by subject, by coworker, by resource, by scope, by status — via query params. We do not ship one page per pivot.

### Primary admin surfaces

#### 1. `/platform/identity/authorization` — human-first

Existing page. Today it renders `AuthorizationBundlePanel` read-only. Extend it to include the new bindings list and filters, keyed to the "who has access" mental model.

Default view: bindings grouped by `subjectType` (platform-role → team → principal), with "resource → coworker → approvalMode" on the right side of each row.

Top-level filters:

- subject (role, team, principal)
- resource (route, workspace, coworker, domain)
- coworker applied
- status (`active`, `draft`, `disabled`, `retired`)

Best answers: "which groups can reach route X?", "which humans can invoke coworker Y?", "why does principal P have or not have access?". The existing `AuthorizationBundlePanel` stays as a secondary view underneath the list for the role×capability matrix — it is not replaced.

#### 2. `/platform/ai/assignments` — coworker-first

Existing page. Today it renders the coworker ↔ model/tier/budget assignment table. Extend it by adding an "Applied to" column and a new tab `Resource Bindings` keyed to the "where is this coworker used" mental model. Do **not** create `/platform/ai/routing` — that slug is a permanent redirect to the route decision log and reusing it would overload the term.

Default view: bindings grouped by coworker, with "resource → subjects allowed → approvalMode" per row.

Top-level filters (same set, re-ordered):

- coworker
- resource
- domain
- subject
- status

Best answers: "where is coworker Y applied?", "what can coworker Y do in finance vs storefront?", "which subjects can reach coworker Y through this route?"

#### 3. `BindingDetailDrawer` — the only editor

One component, opened as a drawer over the list it was launched from, deep-linkable at `?binding=<bindingId>` on either list page and at `/platform/identity/authorization/bindings/<bindingId>` as a full-page fallback for direct links. Breadcrumbs reflect the entry point.

Panels, in order:

1. **Summary** — name, scope, resource, status, applied coworker, sensitivity ceiling, approval mode. Inline edit.
2. **Subjects** — rows of `AuthorityBindingSubject` (role / team / principal / agent with `relation`). Add, remove, change relation. Chips show effective membership counts.
3. **Coworker application** — which coworker is applied, a summary of intrinsic governance posture from `AgentGovernanceProfile` + `AgentToolGrant` (read-only, with a link to the coworker detail page), and the list of in-context `AuthorityBindingGrant` rows that narrow it. Grants here can only narrow.
4. **Resource context** — resource type, ref, and for routes the `RouteResource` record (when Phase 2 lands) with `pathPattern`, `domain`, and links to sibling bindings on the same resource.
5. **Evidence** — last N rows from `AuthorizationDecisionLog` filtered by this binding's resource/coworker, last N `DelegationGrant` rows, and any outstanding proposal-required actions. Every row deep-links to `/platform/audit/authority` or `/platform/audit/routes`. This panel is read-only.
6. **Danger zone** — disable, retire, change scope. Each action is proposal-gated when `approvalMode ≠ none` for the editor's own principal.

### Runtime/domain pages

Runtime pages (`/finance`, `/storefront`, provider pages, workspace shells, build studio) get a small `AppliedPolicySummary` component that:

- reads the resolved `AuthorityBinding` for the current route context
- shows the applied coworker, the subjects allowed, the approval mode, and a "configured at" timestamp
- deep-links to the binding in the drawer (`/platform/identity/authorization?binding=<id>` or the fallback page) with the correct entry-point breadcrumb

Runtime pages never host the editor. This is the "central administration" rule — a single runtime change has exactly one place it is configured and exactly one shared UI that configures it.

### Audit surfaces keep their job

`/platform/audit/authority` and `/platform/audit/routes` remain the evidence plane. Update them to:

- reference `authorityBindingId` on each decision log row when the decision was mediated by a binding
- surface an "Open binding" affordance that opens the shared drawer on the appropriate list page
- keep `EffectivePermissionsPanel` as the canonical inspector, but extend its traversal to include `AuthorityBinding` + `AuthorityBindingGrant` in the intersection

No audit surface gains edit affordances.

---

## Navigation And Information Architecture

Concrete URL map for the binding layer:

| Path | Purpose | Entry point breadcrumb |
| --- | --- | --- |
| `/platform/identity/authorization` | Human-first list + filters | Platform › Identity & Access › Authorization |
| `/platform/identity/authorization?binding=<id>` | Open drawer from human-first list | (same) › Binding: `<name>` |
| `/platform/identity/authorization/bindings/<id>` | Full-page fallback for direct links | Platform › Identity & Access › Authorization › Binding `<name>` |
| `/platform/ai/assignments` | Coworker-first list + filters | Platform › AI Workforce › Assignments |
| `/platform/ai/assignments?binding=<id>` | Open drawer from coworker-first list | (same) › Binding: `<name>` |
| `/platform/ai/assignments/bindings/<id>` | Full-page fallback for direct links | Platform › AI Workforce › Assignments › Binding `<name>` |
| `/platform/audit/authority`, `/platform/audit/routes` | Evidence; "Open binding" deep-links back into drawer | unchanged |
| Runtime pages (`/finance`, `/storefront`, `/build`, provider pages) | `AppliedPolicySummary` with deep-link | unchanged |

Rules:

- The two list paths are peers. Same component, same query params, different default pivot and different header copy.
- The drawer is the source of truth for layout. The full-page fallback renders the drawer inline for linkability, SSO iframe cases, and screen-reader flows.
- Filter state is URL-encoded so both lists are shareable and back-navigable.
- Breadcrumbs always reflect the list the user came from, even when the full-page fallback is used — fall back to the human-first path if no entry point is recorded.

---

## User Flows

The dual-entry-point claim is only useful if both flows feel native. These four flows are the acceptance cases.

### Flow A — "Restrict the finance coworker on the ops route"

1. Admin opens `/platform/ai/assignments`, filters by coworker `finance-controller`.
2. Sees a row for `/ops` with `approvalMode = none`. Opens the drawer.
3. On **Coworker application**, adds an `AuthorityBindingGrant` with `mode = require-approval` on the `ledger_write` grant key.
4. Saves. The drawer stays open. The list row now shows `approval: partial`. A toast offers "view decision log" → `/platform/audit/authority` filtered by this binding.

### Flow B — "Who can reach the storefront admin route?"

1. Admin opens `/platform/identity/authorization`, filters resource `route:/storefront/admin`.
2. Sees one binding. Opens the drawer.
3. **Subjects** panel lists the two platform roles + one team that are allowed. Admin removes one role.
4. **Evidence** panel immediately shows the decisions still governed by this binding. No need to leave the drawer.

### Flow C — "Runtime page to binding in one click"

1. Non-admin on `/finance`. `AppliedPolicySummary` at the top shows "Applied: `finance-controller` — approval: proposal-required — configured in Authorization".
2. Admin clicks "Edit binding". Lands on `/platform/identity/authorization?binding=<id>` with the drawer open, human-first breadcrumb.

### Flow D — "Audit → config repair"

1. Admin on `/platform/audit/authority`, filters by a recent `deny` decision in `EffectivePermissionsPanel`.
2. Row shows `authorityBindingId`. Clicks "Open binding". Drawer opens on whichever list page is most recently used (or human-first by default).
3. Admin adjusts the `AuthorityBindingSubject` rows. Returns to audit via browser back — filters preserved.

These flows also form the Phase 1 acceptance test suite (see Phasing).

---

## UX Phasing Recommendation

### Phase 1 — shared binding layer + dual-entry lists

Ship the minimum control plane. No runtime navigation changes.

Scope:

- `AuthorityBinding`, `AuthorityBindingSubject`, `AuthorityBindingGrant` migrations
- Seed pass that infers initial bindings from existing route↔coworker mappings and existing `UserGroup`/`PlatformRole`/`Team` relationships (read-only inference; write only when confidence is high)
- `BindingList` component with URL-encoded filters/pivots
- `BindingDetailDrawer` with Summary + Subjects + Coworker application + Evidence panels
- Mount on `/platform/identity/authorization` (human-first default pivot) and `/platform/ai/assignments` (coworker-first default pivot)
- Full-page fallback at `/platform/identity/authorization/bindings/<id>` and `/platform/ai/assignments/bindings/<id>`
- Add nullable `authorityBindingId` FK to `AuthorizationDecisionLog` and populate it at evaluation time
- Extend `EffectivePermissionsPanel` to traverse bindings and attribute the narrowing term

Phase 1 is done when User Flows A, B, and D work end-to-end, and the drawer-receiving half of Flow C works (`/platform/identity/authorization?binding=<id>` opens the drawer with the human-first breadcrumb). The runtime originator half of Flow C (`AppliedPolicySummary` on `/finance`, `/storefront`, etc.) ships with Phase 2. Additionally, `EffectivePermissionsPanel` must correctly attribute a narrowed decision to its governing `AuthorityBinding`, and `AuthorizationDecisionLog.authorityBindingId` must be populated at evaluation time for every decision mediated by a binding.

### Phase 2 — explicit route registry + runtime summaries

Scope:

- `RouteResource` table, seeded from the existing shell nav registry
- `defaultAuthorityBindingId` linkage on `RouteResource`
- `AppliedPolicySummary` component mounted on `/finance`, `/storefront`, `/build`, and provider pages
- Resource Context panel in the drawer upgraded to use `RouteResource` records (vs inferred route strings)
- Coworker-application coverage map (at-a-glance which coworker is applied where, grouped by domain)

Phase 2 is done when every shipped runtime route carries a `RouteResource` row and the drawer shows sibling bindings for the same resource.

### Phase 3 — outward projection

Only after Phase 1 and Phase 2 are stable:

- `GAID` / `AIDoc` projection of intrinsic posture + declared limitation classes
- A2A `AgentCard`-compatible export from applied bindings (scope: discovery; never the enforcement source)
- `TAK` envelope reference update noting that route/workspace scope is resolved through `AuthorityBinding`

Phase 3 is explicitly out of scope for the first implementation slice.

---

## Forward-Compatibility With TAK, GAID, And A2A

This design is intentionally aligned with the existing standards story, but none of that alignment is on the critical path for Phase 1. Phase 3 is when projection happens. The short version:

- **TAK** — `AuthorityBinding` is the editable companion to TAK's layered mediation. Intrinsic coworker posture stays on `Agent`; applied contextual posture lives on the binding. Update the TAK reference to note that runtime route/workspace scope resolves through `AuthorityBinding` records.
- **GAID / `AIDoc`** — declare intrinsic posture, capability classes, and limitation classes on the coworker. Applied authority (exact subject lists, route bindings, sensitivity ceilings, local overrides) remains local. `AIDoc` describes what the coworker *is*; `AuthorityBinding` describes what the coworker *may do here*.
- **A2A** — use core `AgentCard` fields for capabilities, skills, interfaces, and security requirements. Use DPF-specific extensions for the authority/limitation details that A2A does not model. Never force DPF's richer binding semantics into A2A core fields.

All three are downstream consumers of the binding layer, not sources for it.

---

## Data Model Stewardship Notes

This design intentionally avoids encoding route authority directly on `Agent`, `PlatformRole`, or route components.

Why:

- the same coworker can appear in more than one route/workspace with different posture
- the same route can evolve independently of the coworker's intrinsic identity
- authority needs a canonical reusable home rather than being duplicated across unrelated models

Future refactoring to watch:

- if route definitions remain stringly-typed across the repo, formalize a route registry model before authority logic spreads further
- if `UserGroup` remains effectively a user-to-role join rather than a richer directory group model, consider a future generalized group subject model for identity-admin maturity

---

## Migration Strategy

1. Introduce `AuthorityBinding`-family models additively.
2. Build read models that infer initial bindings from current route/coworker configuration where needed.
3. Add central admin CRUD on those bindings.
4. Update route/workspace resolution to consult binding records for applied coworker and access policy.
5. Update authority audit views to reference binding IDs and resources.
6. Only after the admin/control plane is stable, project selected posture into `GAID`, `TAK`, and A2A-facing artifacts.

This should be additive, not a big-bang rewrite.

---

## Recommended First Implementation Slice

1. Add Prisma models `AuthorityBinding`, `AuthorityBindingSubject`, `AuthorityBindingGrant`, plus a nullable `authorityBindingId` FK on `AuthorizationDecisionLog`.
2. Seed inference pass that reads the current route↔coworker + role/team mappings and writes baseline bindings so no configuration is lost.
3. Build `BindingList` (with URL-encoded filters/pivots) and `BindingDetailDrawer` (shared, deep-linkable).
4. Mount the list on `/platform/identity/authorization` (human-first default pivot) and `/platform/ai/assignments` (coworker-first default pivot) — both share the same component, same drawer, different default pivot and header copy.
5. Extend `EffectivePermissionsPanel` at `/platform/audit/authority` to traverse bindings and attribute which term narrowed the decision.

Explicitly deferred: `RouteResource` (Phase 2), `AppliedPolicySummary` on runtime pages (Phase 2), GAID/A2A projection (Phase 3).

This is the smallest slice that gives DPF a real human-operable control plane without fragmenting the existing IA.

---

## Open Questions

1. `RouteResource` is in Phase 2, not Phase 1 — is that the right call, or would seed-time inference benefit from having an explicit route registry on day one?
2. Whether principal-scoped coworker access should be modeled as a specialized `AuthorityBinding` scope only, or receive a dedicated convenience table or view model.
3. How much of the coworker limitation posture should be copied into `AIDoc` versus resolved dynamically from local bindings.
4. Whether team ownership and access should remain separate concepts or be partially unified in later identity-admin refactoring.
5. Naming of the coworker-first list: `/platform/ai/assignments` currently means "coworker ↔ model/tier/budget". Extending it to also mean "coworker ↔ resource bindings" risks overloading the term. Alternatives to consider: add a `Bindings` tab to the existing page (cheapest), or rename the page to `/platform/ai/coworker-access` with a `Model` and `Bindings` tab (cleaner long term, but churns URLs). The redirect history in the AI cluster argues for tabs over renames unless there is a hard reason.
6. Which entry-point list the `BindingDetailDrawer` should default its breadcrumb to when opened from a runtime page or from an audit deep-link that does not record an entry point. Current recommendation: human-first (`/platform/identity/authorization`), because the audit cluster skews to reviewers and compliance roles. Worth validating with real admins before locking in.

---

## Recommendation

DPF should implement a **single shared authority-binding model** with **dual-entry admin UX** built from one list component, one detail drawer, and URL-encoded pivots:

- `/platform/identity/authorization` for human-first administration (default pivot: subject)
- `/platform/ai/assignments` for coworker-first administration (default pivot: coworker)
- `/platform/audit/*` remains the evidence plane; no editing lives there
- Runtime pages host a read-only `AppliedPolicySummary` that deep-links into the shared drawer

Humans and AI coworkers remain **separate principal classes in the same authority plane**. Routes and workspaces are first-class governed resources. Intrinsic coworker posture stays on the coworker (`AgentToolGrant`, `AgentGovernanceProfile`); applied authority lives on `AuthorityBinding` and can only narrow the intrinsic posture, never widen it.

That is the cleanest path to:

- enterprise-grade security
- LDAP-style access-layer consistency
- stronger `TAK` and `GAID` alignment
- future A2A-compatible projection
- and a human-operable configuration model that reuses the existing IA (config in `identity/*` + `ai/*`, evidence in `audit/*`) instead of fragmenting it
