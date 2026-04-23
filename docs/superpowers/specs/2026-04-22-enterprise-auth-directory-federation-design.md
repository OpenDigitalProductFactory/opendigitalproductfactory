# Enterprise Auth, Directory, And Federation Design

**Date:** 2026-04-22  
**Status:** Draft  
**Scope:** Define how DPF implements workforce authentication, manager-aware authorization, LDAP publishing, downstream application federation, ADP-backed workforce hierarchy, and HR/Finance coworker access in one coherent identity architecture.

---

## Problem Statement

DPF already has working local authentication, local RBAC, customer login, coworker governance, and the first ADP integration substrate. What it does not yet have is a single enterprise identity architecture that ties together:

- workforce login and API auth
- employee versus manager separation
- ADP-backed workforce hierarchy
- external product SSO
- LDAP publishing for legacy consumers
- SCIM-style lifecycle provisioning
- HR and Finance coworker route/tool access

The immediate customer need is practical rather than theoretical:

- an ADP-integrated customer needs employee and manager separation implemented correctly
- DPF will become the login and authority source for additional external products
- HR and Finance coworkers will gain MCP servers and skills that must respect route, role, and manager scope
- LDAP, auth, routing, and access control must land together rather than as disconnected features

This design treats identity as a platform subsystem, not a set of one-off integrations.

---

## Goals

1. Keep DPF as the source of truth for organizational identity context, role/group semantics, and runtime authorization.
2. Implement employee versus manager separation using the existing workforce core and ADP hierarchy.
3. Support downstream application login through standards-based federation rather than per-app custom auth.
4. Publish a company directory and coarse authority model over LDAP for legacy systems.
5. Use SCIM-compatible lifecycle provisioning patterns rather than inventing a custom sync protocol.
6. Keep coworker tool access aligned with the same human identity and authority model.
7. Reuse open-source identity infrastructure where it is stronger than building protocols from scratch.
8. Preserve the path toward first-class human, service, and AI coworker identities under one DPF authority model.

## Non-Goals

- Replacing the existing `User`, `CustomerContact`, `EmployeeProfile`, or `Agent` tables in one cutover
- Making ADP the source of truth for DPF route permissions or coworker tool grants
- Building a full custom LDAP server, SAML IdP, OIDC provider, and SCIM server natively inside DPF in phase 1
- Solving every aspect of public/global AI agent identity in this implementation slice
- Replacing existing customer social login flows
- Implementing payroll writeback or HRIS writeback in this spec

---

## Current-State Anchors

DPF already has several pieces of the target architecture:

- local workforce and customer authentication in [apps/web/lib/govern/auth.ts](../../../apps/web/lib/govern/auth.ts)
- workforce API token auth in [apps/web/app/api/v1/auth/login/route.ts](../../../apps/web/app/api/v1/auth/login/route.ts)
- bearer/session auth middleware in [apps/web/lib/api/auth-middleware.ts](../../../apps/web/lib/api/auth-middleware.ts)
- local capability checks in [apps/web/lib/govern/permissions.ts](../../../apps/web/lib/govern/permissions.ts)
- manager hierarchy fields in [packages/db/prisma/schema.prisma](../../../packages/db/prisma/schema.prisma) on `EmployeeProfile.managerEmployeeId` and `directReports`
- coworker tool-grant enforcement in [apps/web/lib/tak/agent-grants.ts](../../../apps/web/lib/tak/agent-grants.ts)
- routing scope and capability-floor logic in [2026-04-20-routing-architecture-current.md](2026-04-20-routing-architecture-current.md)
- ADP credential/connect flow and MCP service groundwork in [2026-04-21-adp-mcp-integration-design.md](2026-04-21-adp-mcp-integration-design.md)

Important current gaps:

- browser auth and API auth do not fully share the same password verification path
- role checks are coarse and role-only; they do not yet account for manager scope
- DPF has no protocol edge for LDAP, SAML, OIDC issuance, or SCIM publication
- downstream external products are not yet modeled as federated relying parties
- AI coworkers are governed operationally but not yet integrated into the broader enterprise identity surface

---

## Research And Benchmarking

This design intentionally benchmarks both open-source and commercial identity systems before choosing an architecture.

### Open-source systems compared

#### 1. authentik

Relevant official docs:

- [Welcome to authentik](https://docs.goauthentik.io/docs/)
- [LDAP Provider](https://docs.goauthentik.io/add-secure-apps/providers/ldap/)
- [SCIM Provider](https://docs.goauthentik.io/docs/providers/scim/)
- [SCIM Source](https://docs.goauthentik.io/docs/users-sources/sources/protocols/scim/)

What matters:

- authentik supports OAuth2/OIDC, SAML, LDAP, and SCIM in one platform
- its LDAP provider serves users and groups from authentik’s own database
- its SCIM source allows an external system to provision users and groups into authentik
- its SCIM provider allows authentik to provision outward to downstream applications

What we adopt:

- use one identity edge that can serve LDAP and modern federation together
- use SCIM as the provisioning plane and OIDC/SAML as the login plane
- keep directory and federation surfaces behind one managed protocol layer

#### 2. Keycloak

Relevant official docs:

- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)

What matters:

- Keycloak has strong LDAP/AD federation support
- it supports OIDC and SAML well
- it can import, synchronize, and authenticate against upstream LDAP/AD stores with configurable storage modes

What we adopt:

- federation mode distinctions like `READ_ONLY`, `WRITABLE`, and `UNSYNCED` are operationally useful
- realm/application style federation boundaries are proven for enterprise SSO

What we reject:

- Keycloak is excellent when LDAP/AD is upstream, but that is not the main requirement here
- our problem is not “consume LDAP into an IdP”; it is “publish DPF authority outward through LDAP plus modern federation”

#### 3. OpenLDAP / FreeIPA

Relevant official docs:

- [OpenLDAP Administrator’s Guide](https://www.openldap.org/doc/admin26/OpenLDAP-Admin-Guide.pdf)
- [OpenLDAP access control](https://openldap.org/doc/admin24/access-control.html)
- [FreeIPA LDAP system accounts](https://www.freeipa.org/page/HowTo/LDAP)

What matters:

- authoritative LDAP systems are usually writable internally but accessed read-only by many consumers
- ACLs and service accounts are central to operational safety
- directory placement alone is not enough; schema and explicit attributes matter too

What we adopt:

- read-only consumer access as the default for external integrations
- explicit principal type and group/role publication rather than inferring identity kind only from OU placement

What we reject:

- using a traditional LDAP server as the canonical enterprise control plane for agent-aware auth, route-aware coworker access, and downstream federation

### Commercial systems compared

#### 1. Microsoft Entra ID

Relevant official docs:

- [SCIM support in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/scim-support-in-entra-id)
- [How application provisioning works](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works)

What matters:

- Entra explicitly separates login/federation from SCIM lifecycle provisioning
- Entra can act as both SCIM client and SCIM service provider
- its provisioning layer can bridge into LDAP-oriented environments through an agent pattern

What we adopt:

- provisioning and authentication are separate surfaces
- standards-based lifecycle sync should be first-class, not an afterthought

#### 2. Okta

Relevant official docs:

- [LDAP Interface](https://help.okta.com/en-us/Content/Topics/Directory/ldap-interface-main.htm)
- [SCIM protocol](https://developer.okta.com/docs/api/openapi/okta-scim/guides/)
- [Understanding SCIM](https://developer.okta.com/docs/concepts/scim/)

What matters:

- Okta’s LDAP Interface translates LDAP commands into Okta-backed identity operations
- Okta treats SCIM as the standard downstream lifecycle protocol for users and groups

What we adopt:

- legacy LDAP consumers still matter and need a compatibility surface
- LDAP can be a protocol edge over a more modern directory core instead of the canonical storage model

#### 3. Auth0

Relevant official docs:

- [Enterprise identity providers](https://auth0.com/docs/connections/identity-providers-enterprise)
- [Configure inbound SCIM](https://auth0.com/docs/authenticate/protocols/scim/configure-inbound-scim)
- [Self-Service SSO](https://auth0.com/docs/authenticate/enterprise-connections/self-service-SSO)

What matters:

- Auth0 is strong for enterprise connection onboarding and self-service SSO
- Auth0 supports inbound SCIM for enterprise connections
- Auth0 does not expose a full `/groups` SCIM object model for this scenario

What we adopt:

- enterprise connection onboarding must be customer-manageable over time

What we reject:

- a customer-identity-first system as the core of DPF’s internal workforce and coworker authority model

### Standards activity considered

Relevant current standards sources:

- [IETF SCIM Working Group charter](https://datatracker.ietf.org/doc/charter-ietf-scim/)
- [IETF WIMSE charter](https://datatracker.ietf.org/doc/charter-ietf-wimse/)

What matters:

- SCIM is actively being revised and remains the clearest standards home for lifecycle provisioning
- workload identity and non-human trust concerns are developing outside LDAP
- there is no equally strong modern LDAP-specific standards track for first-class AI coworker identity

### Patterns adopted

- SCIM for provisioning and lifecycle
- OIDC/SAML for downstream application login
- LDAP as a compatibility directory and bind surface, not the canonical model
- read-only LDAP consumption as the default external stance
- explicit principal kind rather than inference from OU/container alone
- one canonical authority model with multiple protocol projections

### Patterns rejected

- DPF implementing LDAP, SCIM, SAML, and OIDC from scratch in the first implementation
- ADP driving route permissions directly
- using LDAP as the platform’s canonical internal identity model
- creating separate, disconnected auth stacks for humans, managers, and coworkers

---

## Approaches Considered

### 1. DPF-native protocol stack

DPF would directly implement LDAP publishing, SCIM provisioning, OIDC/SAML federation, and downstream app registration inside the main platform.

Pros:

- maximum strategic ownership
- cleanest “DPF is the identity system” story

Cons:

- highest delivery risk
- too much protocol work before solving customer problems
- likely to produce half-built LDAP/SCIM behavior under real enterprise load

### 2. DPF authority core with open-source identity edge

DPF remains authoritative for principals, org structure, route/tool authorization, and manager scope. An incorporated open-source identity edge publishes LDAP and modern federation protocols from DPF-managed state.

Pros:

- fastest path to robust LDAP + OIDC + SAML + SCIM
- keeps DPF authoritative where it matters
- avoids hand-building mature protocol stacks

Cons:

- introduces an additional service/runtime
- requires provisioning and sync discipline between DPF and the edge

### 3. External IdP-first architecture

Adopt Entra/Okta/Auth0 as the main identity layer and reduce DPF to a relying party plus authorization app.

Pros:

- fast for standard workforce SSO
- low protocol implementation burden

Cons:

- weakens DPF as the central company platform
- poor fit for AI coworker identity and DPF-governed authority
- less control over LDAP publication and org-specific semantics

### Chosen approach

This design chooses **approach 2**.

DPF should remain the authority core. An incorporated open-source identity edge should handle LDAP, OIDC, SAML, and SCIM protocol surfaces. Based on the benchmark set, **authentik** is the best fit for that role because it can act as:

- LDAP directory provider
- OIDC/SAML identity provider
- SCIM source and provider
- self-hosted, open-source standards edge

Keycloak remains a strong fallback option if the dominant future need shifts toward upstream LDAP/AD federation rather than DPF-authored directory publishing.

---

## Core Architecture

### Principle

> DPF owns identity meaning and authority. The identity edge owns protocol presentation.

That means:

- DPF decides who a person, manager, service, or coworker is
- DPF decides what groups, roles, route capabilities, manager scope, and tool access they have
- the identity edge publishes those decisions over LDAP, OIDC, SAML, and SCIM

### Layer 1: Canonical identity and authority in DPF

DPF remains the source of truth for:

- internal workforce users
- employee profiles and manager relationships
- service identities
- AI coworkers and their governance overlays
- platform roles and group membership
- route access
- coworker tool grants
- application-level authorization mapping

The architecture should introduce a canonical identity spine that can unify existing records without forcing an immediate replacement of current tables.

Recommended internal model:

```prisma
model Principal {
  id           String   @id @default(cuid())
  principalId  String   @unique
  kind         String   // human | customer | service | agent | system
  status       String   @default("active")
  displayName  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PrincipalAlias {
  id           String   @id @default(cuid())
  principalId  String
  aliasType    String   // user | employee | adp | oidc | ldap | scim | gaid | service
  aliasValue   String
  issuer       String?
  createdAt    DateTime @default(now())

  @@unique([aliasType, aliasValue, issuer])
}
```

This does not replace `User`, `CustomerContact`, `EmployeeProfile`, or `Agent`. It gives them one shared identity anchor.

### Layer 2: Workforce hierarchy and manager scope

`EmployeeProfile` already models the manager tree. This design keeps that model and formalizes how it drives authorization.

When ADP is connected:

- ADP becomes authoritative for workforce hierarchy inputs:
  - active employment state
  - manager relationship
  - employee number / worker identifier
  - department and position references where mapped
- DPF remains authoritative for:
  - platform roles
  - route capabilities
  - coworker access
  - workflow approvals

This separation matters:

- ADP says whether Alice manages Bob
- DPF says whether Alice may approve Bob’s leave, view Bob’s payroll summary, or invoke an HR coworker action over Bob’s record

Manager separation should be enforced through scoped access, not just global roles. A manager is not automatically an HR administrator.

### Layer 3: Identity edge

DPF should incorporate **authentik** as the identity edge runtime.

Responsibilities of the edge:

- OIDC and SAML for downstream applications
- LDAP directory publishing and LDAP bind support
- SCIM inbound provisioning target from DPF
- SCIM outbound provisioning to downstream applications where needed

Responsibilities explicitly retained in DPF:

- principal creation
- identity-to-employee linking
- manager hierarchy
- capability mapping
- route gating
- coworker grant resolution
- application entitlement semantics

### Layer 4: Auth in DPF itself

DPF should continue using Auth.js in the application layer, but the workforce login path should evolve from local credentials toward OIDC against the identity edge.

Phased behavior:

1. Local credentials remain supported while the edge is introduced.
2. Workforce browser login moves to OIDC through the identity edge.
3. Workforce API/mobile flows align to the same identity source.
4. Customer auth remains separate unless and until customer federation becomes a deliberate scope item.

This lets DPF migrate without breaking existing sessions and local operators.

### Layer 5: Protocol projections

The same DPF authority state should be projected outward in four ways:

- **OIDC/SAML:** login for external products
- **LDAP:** directory and legacy auth surface
- **SCIM:** lifecycle provisioning surface
- **DPF runtime authz:** route/tool/coworker authorization surface

No downstream system should define DPF authority semantics on its own.

---

## Employee, Manager, And Role Separation

The platform must distinguish three separate concerns:

1. **Identity kind**
   - human
   - service
   - agent

2. **Organizational role**
   - employee
   - manager
   - HR specialist
   - finance operator
   - administrator

3. **Scope**
   - self
   - direct reports
   - indirect reports
   - department
   - full organization

The current `PlatformRole` system captures only part of this. It should remain for coarse role assignment, but effective authorization must become:

`principal role capabilities`
`AND manager scope`
`AND route context`
`AND coworker/tool policy`

Examples:

- a manager can view approved fields for direct reports, but not organization-wide payroll data
- an HR operator can view workforce-wide data because of role, not because they happen to manage someone
- a finance coworker may summarize payroll counts for a manager only over the manager’s allowed employee scope

---

## LDAP Design

### Role of LDAP

LDAP is a **published directory and compatibility auth surface**, not DPF’s canonical internal storage model.

### Directory structure

The published DIT should expose separate branches:

- `ou=people`
- `ou=agents`
- `ou=services`
- `ou=groups`

This follows established directory practice while still allowing explicit type metadata.

### Published objects

The LDAP surface should include:

- human workforce principals
- AI coworkers that are externally representable
- service accounts
- groups
- role-derived groups
- memberships

### Type distinction

Downstream systems should be able to distinguish identity kinds by:

- branch/container
- object class
- explicit attribute

Preferred explicit attribute:

- `dpfPrincipalType=human|agent|service`

### Authority publication

For LDAP compatibility, DPF roles should be projected as groups.

That means:

- DPF keeps roles and capabilities internally
- LDAP consumers see groups and memberships
- group naming conventions can distinguish role groups from business groups

Example:

- `cn=role-HR-300,ou=groups,dc=dpf,dc=internal`
- `cn=dept-finance,ou=groups,dc=dpf,dc=internal`

### Read/write stance

External LDAP clients should be **read-only by default**.

That means:

- bind/search/read supported
- external writes to group membership are out of scope for the first release
- all authoritative changes continue through DPF UI, API, jobs, or governed provisioning flows

This matches common enterprise operating practice and preserves one authoritative control plane.

---

## SCIM Design

SCIM is the lifecycle plane.

### Direction 1: DPF to identity edge

DPF should provision workforce users, groups, service accounts, and eventually agent principals into authentik through SCIM.

That gives us:

- DPF as the authority source
- authentik as the standards edge

### Direction 2: Identity edge to downstream apps

Where downstream applications support SCIM, the identity edge should provision:

- users
- groups
- memberships
- deactivation state

This keeps DPF from having to implement one-off provisioning adapters for every application.

### Why SCIM matters here

SCIM is where current standards work is active, and it cleanly separates lifecycle provisioning from interactive login and route-time authorization.

---

## External Product Federation

DPF will need to support logins for external products that are part of the broader company platform.

### Pattern

External products should authenticate against the identity edge using OIDC or SAML.

DPF should remain the place where admins define:

- which applications exist
- which groups/roles are assigned
- which claims should be emitted
- whether access is workforce-wide, manager-scoped, finance-only, HR-only, or otherwise restricted

### App model

DPF should introduce an application registry for downstream relying parties.

Recommended fields:

- app identifier
- protocol (`oidc` | `saml` | `ldap-only`)
- claim mappings
- assigned groups/roles
- provisioning mode (`manual` | `scim`)
- status

This registry is not the same as route permissions inside DPF. It is the contract between DPF’s authority model and downstream applications.

---

## ADP Integration Semantics

This design resolves the earlier authority question as follows:

- when ADP is connected, **ADP is authoritative for workforce hierarchy and employment status inputs**
- DPF is authoritative for **platform authorization and coworker access**

Concretely:

- ADP worker identifiers become `PrincipalAlias` records
- ADP manager chains update `EmployeeProfile.managerEmployeeId`
- DPF derives manager scope from the synced hierarchy
- DPF maps workforce records to platform groups and route capabilities

This keeps payroll/HRIS truth where it belongs without letting an HRIS define platform authorization by accident.

---

## Coworker, Skills, MCP, And Route Access

HR and Finance coworkers should not bypass the enterprise identity model. They should consume it.

Effective coworker action permission should remain:

`human authority`
`AND agent tool grants`
`AND route context`
`AND object scope`
`AND integration connection state`

Examples:

- HR coworker can call ADP tools only if ADP is connected
- Finance coworker can access payroll tools only for users whose route and role permit finance visibility
- a manager interacting with a coworker receives scoped answers for their team, not unrestricted HR back-office access

This design extends existing TAK enforcement rather than replacing it.

---

## Routing And Access Model

Current route permissions are coarse and role-driven. This design evolves them to be identity-aware.

### Current model

- `permissions.ts` maps coarse capabilities to `PlatformRole`
- `auth-middleware.ts` produces a simple `{ user, capabilities }` result
- route and tool gating use those coarse capabilities

### Target model

Auth context should become richer:

```ts
type EffectiveAuthContext = {
  principalId: string;
  principalKind: "human" | "service" | "agent";
  platformRole: string | null;
  isSuperuser: boolean;
  employeeId: string | null;
  managerScope: {
    directReportIds: string[];
    indirectReportIds: string[];
  } | null;
  grantedCapabilities: string[];
  routeContext: string | null;
};
```

Route access then becomes:

- coarse capability check
- optional manager/self scope check
- optional sensitivity check
- optional integration-availability check

This is the bridge between enterprise auth and actual application behavior.

---

## Security And Trust Boundaries

### Credential authority

Near-term:

- workforce credentials may still exist locally during migration
- the identity edge becomes the preferred credential authority for federated login

Long-term:

- DPF remains the authority source for who a principal is and what it may do
- the edge remains the credential and standards presentation layer unless DPF later absorbs that role deliberately

### Directory and provisioning trust

- SCIM from DPF to the edge is authenticated and audited
- LDAP consumers are read-only by default
- downstream app access is group/claim based, never direct DB trust

### Coworker trust

- coworkers are still governed by TAK
- agent identity can later be surfaced through `PrincipalAlias` and `GAID`
- no coworker gets broader tool or data access through federation than it already has through DPF governance

---

## Implementation Phases

### Phase 1: Harden current auth

- unify password verification across browser and API flows
- enrich auth/session context with principal and employee links
- keep local auth working while preparing for federation

### Phase 2: Workforce hierarchy and manager scope

- sync ADP hierarchy into `EmployeeProfile`
- derive manager scopes
- implement manager-aware capability enforcement

### Phase 3: Principal spine

- add `Principal` and `PrincipalAlias`
- link existing `User`, `EmployeeProfile`, `Agent`, and service identities

### Phase 4: Identity edge integration

- deploy authentik beside DPF
- provision DPF users/groups into authentik
- migrate workforce login to OIDC through authentik

### Phase 5: LDAP and SCIM publication

- enable LDAP directory publishing from the edge
- expose groups/role-as-group mappings
- enable SCIM provisioning for downstream apps

### Phase 6: External product federation

- add downstream application registry and claim/group mapping
- issue OIDC/SAML to external products

### Phase 7: Coworker and MCP alignment

- connect HR and Finance coworkers to manager-aware and route-aware auth context
- gate ADP and future finance MCP tools through the new access evaluator

---

## Design Decisions

1. **DPF remains the authority source of truth.**
   The identity edge is adopted for standards delivery, not to replace DPF’s business authorization model.

2. **ADP is authoritative for workforce hierarchy when connected.**
   DPF consumes that hierarchy but remains authoritative for route and tool access.

3. **authentik is the recommended open-source component to incorporate.**
   It is the best fit for the combination of LDAP publishing, OIDC/SAML federation, and SCIM lifecycle support.

4. **LDAP is a projection, not the core model.**
   This prevents the platform from bending around legacy protocol constraints.

5. **Manager access is scope-driven, not role-only.**
   This is required for correct employee versus manager separation.

6. **Coworkers consume the same authority model as humans.**
   No parallel auth stack should be created for HR or Finance coworkers.

---

## Open Questions

These do not block the architecture, but they will affect execution details:

1. Should workforce password authority remain local in DPF through the first federation release, or should authentik become the only workforce credential authority once OIDC cutover is complete?
2. Should agent principals appear in the first LDAP directory release, or should LDAP v1 publish humans and services first with agent publication in v2?
3. Which downstream external products are first in line for federation, so claim and group design can be validated against real relying-party requirements?

---

## Relationship To Existing Specs

This spec extends and operationalizes:

- [2026-03-13-unified-identity-access-agent-governance-design.md](2026-03-13-unified-identity-access-agent-governance-design.md)
- [2026-04-21-adp-mcp-integration-design.md](2026-04-21-adp-mcp-integration-design.md)
- [GAID.md](../../architecture/GAID.md)
- [trusted-ai-kernel.md](../../architecture/trusted-ai-kernel.md)

The March unified identity spec remains the foundation. This document narrows it into a concrete implementation architecture for:

- workforce auth
- LDAP publication
- SCIM provisioning
- external product federation
- ADP-backed manager separation
- coworker route/tool access

