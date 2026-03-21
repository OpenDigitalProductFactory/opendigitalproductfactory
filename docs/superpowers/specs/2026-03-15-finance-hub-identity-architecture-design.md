# Finance Hub And Identity Architecture Design

**Date:** 2026-03-15
**Status:** Superseded by EP-FINMGMT-001 (native financial management suite, 2026-03-20)
**Scope:** Define the target architecture for DPF as the employee-facing platform hub, with finance as a back-office subsystem, a separate identity provider runtime, and a future path toward DPF-native identity capabilities.

## Execution Status

- Finance epic is actively resumed and centered on finance runtime exposure plus first employee-facing work portal entry points.
- Current capability scope includes AP/AR, taxes, payroll connectors (US + UK abstraction layer), trainer storefront-to-ledger handoff, and role-aware visibility.
- Identity boundary remains external for token issuance in this phase; DPF owns business identity context and linkage.
- Current backlog alignment status:
  - Finance backlog SQL alignment updated in `scripts/update-finance-epic.sql`.
  - Self-development/runtime registration SQL alignment updated in `scripts/update-selfdev-epic-runtime-registration.sql`.
  - Execution slice target remains: managed finance runtime visibility and first employee portal integration before broader work portal expansion.

---

## Overview

DPF is becoming the front door for a small-to-medium business operating model rather than just a software delivery surface. The platform needs to support:

- employee-facing portal access
- finance operations and reporting
- trainer storefront and payment flows
- centralized identity and access
- long-term integration of external tools behind one coherent internal experience

The user clarified several architectural constraints:

- DPF must remain the primary employee-facing hub
- ERPNext should be mostly back-office
- accountants may use ERPNext directly, but regular employees should not need to
- the platform should centralize identity over time
- long term, both internal and external identities must be supported
- the business scale is relatively modest at first: under 200 employees and roughly 30 system/service accounts

This spec defines the first stable boundary that supports that direction without forcing DPF to immediately become a full finance suite or a full identity provider implementation.

---

## Design Goals

1. Keep DPF as the primary employee-facing and workflow-facing platform.
2. Use proven open-source or external systems where they reduce time-to-value.
3. Keep ERPNext isolated as a back-office finance system of record.
4. Introduce a separate IdP runtime now, while preserving a path toward DPF-native identity later.
5. Make identifiers future-proof for OIDC, ERP, AI agents, MCP resources, and later agent identity standards.
6. Avoid legal and maintenance lock-in from directly embedding third-party AGPL identity server code.
7. Support a gradual path from "hub over external tools" to "more native DPF capability over time."
8. Ensure downloaded and deployed platform packages are visible in inventory and represented as digital products in the correct portfolio context.

---

## Non-Goals

- Rebuilding ERPNext features natively in DPF in phase 1
- Rebuilding a ZITADEL-class identity platform in phase 1
- Delivering full payroll compliance for both US and UK in the first finance slice
- Making ERPNext the main end-user experience
- Designing the complete employee portal UX in this spec
- Designing full customer portal and partner federation UX in this spec

---

## Chosen Approach

Three approaches were considered:

1. DPF-native finance and identity from the start
2. DPF as orchestration hub over external finance and identity runtimes
3. ERP/IdP first with DPF as a thin shell

This spec chooses **option 2**.

Reasoning:

- It gets usable finance and centralized authentication online faster.
- It aligns with the existing DPF route, auth, and backlog structure.
- It avoids trying to replace mature infrastructure before the product needs are clearer.
- It gives DPF strategic ownership over business context, identities, and workflows without forcing DPF to immediately become the protocol issuer for everything.

The long-term strategy is still to build strategic platform capability in DPF, but the near-term product should operate through stable integration boundaries.

---

## System Boundaries

### DPF

DPF is the system of engagement and orchestration.

DPF owns:

- canonical principal registry
- employee and external-user business context
- role and group mapping
- portal UX and application shell
- service catalog and request entry points
- workflow orchestration and approvals
- finance reporting and operational views
- AI agent registry and agent identity mapping
- cross-system ID alias mapping

DPF does not own in phase 1:

- token issuance protocol implementation
- ERP accounting truth
- payment processing execution
- payroll compliance execution

### Inventory And Digital Product Registration

Any third-party package or runtime that DPF downloads, deploys, or manages as part of the business platform must be visible through the platform's own inventory and digital product model.

This applies to examples such as:

- ERPNext
- the identity provider runtime
- future employee-facing packaged applications
- future managed supporting services that DPF installs or operates

Required rule set:

- a managed runtime must create or update an inventory record
- a user-facing or employee-operated runtime must create or link a `DigitalProduct` record
- the `DigitalProduct` must be associated to the correct portfolio and taxonomy context rather than remaining an unclassified infrastructure artifact
- employee-operated business applications should land in the appropriate `for_employees` portfolio context
- DPF should preserve linkage between the discovered/runtime inventory object and the higher-level digital product registration

Operational implication:

- when DPF stands up ERPNext or an IdP, those systems should not exist only as hidden Docker services
- they should appear as governed platform-managed products and assets
- this keeps inventory, portfolio management, finance visibility, and employee portal behavior aligned

### Identity Provider Runtime

The IdP runs as a separate service beside DPF in Docker.

The IdP owns:

- authentication flows
- sessions
- token issuance
- client application trust
- MFA and passkey capability later

The IdP should not own:

- DPF business authorization semantics
- workforce organizational context
- finance/business workflow logic
- AI agent identity semantics beyond mapped claims and aliases

### ERPNext

ERPNext runs as a separate back-office subsystem beside DPF in Docker.

ERPNext owns:

- chart of accounts
- AP/AR/GL records
- finance back-office processing
- finance operator workflows
- accounting reports and accounting-grade transaction truth

ERPNext should be treated as an integration target, not the employee front door.

### Stripe And Regional Payroll Providers

Stripe remains external for:

- trainer checkout
- subscriptions where needed
- payment execution
- payment webhooks

Regional payroll providers remain external for:

- US payroll compliance
- UK payroll compliance and HMRC reporting

---

## Identity And ID Strategy

### Core Principal Model

Every actor in DPF should receive one immutable internal identifier: `principalId`.

Principal types:

- `employee`
- `external_user`
- `service_account`
- `ai_agent`
- `system`

This creates one stable platform-level identity layer independent of any external provider or subsystem.

### Alias Model

External identifiers must be modeled as aliases, not primary keys.

Examples:

- `oidc:{issuer}|{sub}`
- `idp:{subjectId}`
- `erpnext:{userIdOrEmail}`
- `stripe:{customerId}`
- `mcp:{serverId}`
- `mcp:{resourceUri}`
- `a2a:{agentId}`
- `did:{did}`

Why this matters:

- the IdP can change later without rewriting platform identity references
- finance and external tools can be linked without becoming authoritative
- AI agent and MCP-oriented identifiers can evolve independently
- DPF can later issue its own identity semantics while preserving legacy mappings

### Authority Boundaries

Near term:

- IdP is authoritative for authentication sessions and issued tokens
- DPF is authoritative for principal registry, workforce context, role/group mapping, and business authorization context

Long term:

- DPF may absorb more identity responsibilities
- external identity runtimes may become optional for some internal cases

This keeps the product path open without forcing a premature rewrite.

---

## Finance Architecture

### Finance System Of Record

ERPNext is the accounting system of record for the initial finance stack.

Scope:

- general ledger
- accounts payable
- accounts receivable
- customer and vendor master records
- accounting-side reporting

### DPF Finance Hub

DPF is the finance operating layer and employee-facing coordination layer.

DPF should expose:

- finance service catalog entries
- finance request intake
- trainer storefront and order status
- payment visibility and exception handling
- AI provider spend attribution
- cross-business reporting views
- operational reconciliation queues
- CRM handoff triggers from finance/commercial events

### Payroll

Payroll should not be modeled as one shared in-house subsystem in the first phase.

Reasoning:

- the businesses span the US and London
- regional payroll compliance differs materially
- payroll is a compliance-sensitive domain where provider integration is safer than greenfield implementation early on

The initial architecture should allow payroll connectors, not a monolithic payroll engine.

---

## Employee Portal Relationship

The employee portal is a separate epic, but finance depends on a minimal version of it.

Phase-1 portal needs:

- app launchpad shell
- authenticated employee home
- request/catalog surface
- request/task/status tracking
- role-aware navigation

Later portal capabilities may include:

- profile
- HR workflows
- payroll visibility
- documents
- expense submission
- approvals

The first finance slice should depend only on the minimal work portal shape, not the full people portal.

---

## Docker Topology

Recommended container topology:

- `dpf-web`
- `dpf-db`
- `idp`
- `erpnext-web`
- `erpnext-db`
- `erpnext-redis`
- `erpnext-workers`
- `reverse-proxy`

Networking rule:

- employees access DPF first
- DPF communicates with IdP and ERPNext over internal Docker networking
- ERPNext can remain hidden from most end users
- direct database coupling between DPF and ERPNext is forbidden

Integration rule:

- all integration crosses service boundaries through APIs, claims, or event/webhook flows
- no shared-schema shortcuts between DPF and ERPNext

---

## Third-Party Identity Legal Boundary

### Decision

DPF will build toward a native identity core over time, but it will **not** fork, embed, or derive its core platform from ZITADEL code.

### Why

ZITADEL is useful as a separate identity runtime, but current versions are published under AGPL-3.0. Direct modification or derivative embedding would create obligations and product constraints that are not appropriate for DPF core at this stage.

### Allowed Boundary

Allowed:

- self-host ZITADEL or a similar IdP as a separate service
- integrate with that service using OIDC, APIs, SDKs, or claims mapping
- build DPF-native admin, workforce, and business UX on top of that integration boundary

Not allowed under this strategy:

- copying ZITADEL server internals into DPF
- building a derivative embedded identity subsystem from ZITADEL code
- treating AGPL runtime internals as if they were a permissive code library for platform core

### Long-Term Strategic Consequence

If DPF later replaces third-party IdP components, it should do so through fresh DPF-native implementation based on standards and product requirements, not by refactoring AGPL code into the platform.

---

## Architecture Decisions To Capture In The Backlog

The following decisions should be preserved as backlog/architecture records:

1. DPF remains the employee-facing platform hub and service catalog front door.
2. ERPNext is the finance back-office system of record, not the general employee front end.
3. Identity provider runtime remains a separate service initially.
4. DPF will build toward a native principal and authorization core over time.
5. DPF will not fork or embed AGPL ZITADEL code into platform core.
6. Identity integration with third-party IdPs must remain API/OIDC boundary based.
7. Principal identity must support humans, service accounts, AI agents, and future external agent identity aliases.
8. Managed downloaded packages must register in inventory and, where user-facing or employee-operated, also register as digital products in the appropriate `for_employees` portfolio context.

Recommended backlog placement:

- current finance epic captures ERPNext and finance hub direction
- identity/governance epic should capture the native-identity-roadmap and legal-boundary decisions
- bootstrap/inventory work should capture automatic registration of managed runtimes into inventory and digital product records
- future employee portal epic should capture the work-portal dependency used by finance

---

## Phased Delivery

### Phase 1: Runtime Stand-Up

- deploy DPF, IdP, and ERPNext together in Docker
- keep ERPNext mostly back-office
- support direct accountant access where needed
- keep employees in DPF

### Phase 2: Principal Foundation

- add `principal` and `principal_alias` concepts to DPF
- map IdP subjects, ERP users, service accounts, AI agents, and future MCP/A2A aliases
- centralize business identity context in DPF

### Phase 3: Finance Hub

- connect Stripe checkout and payment webhooks
- connect DPF workflow surfaces to ERPNext
- expose finance reporting, reconciliation, and AI-spend attribution through DPF

### Phase 4: Employee Portal Expansion

- add work portal capabilities beyond the existing route shell
- expose app launch, requests, approvals, and status tracking
- later add richer HR and finance-adjacent employee experiences

### Phase 5: DPF-Native Identity Core

- implement only the DPF-native identity capabilities that are strategically needed
- start with internal workforce identity and authorization context
- defer full external federation replacement until product maturity justifies it

---

## Risks And Constraints

- Payroll is cross-jurisdictional and should not be underestimated.
- Identity protocol implementation is much easier to underestimate than finance integration.
- ERPNext and IdP should not be allowed to leak their data models into DPF core.
- If DPF tries to replace both ERP and IdP too early, the platform will stall in infrastructure work instead of delivering business value.

---

## Summary

The correct first move is to make DPF the authoritative hub for business context, workflow, and principal identity mapping while running finance and authentication through separate runtimes that are integrated cleanly.

That gives the platform:

- immediate forward movement on finance and centralized access
- a safe legal boundary around AGPL identity software
- a future-proof identity model for humans, systems, and AI agents
- a clear path to a DPF-native employee portal and identity core over time

The long-term strategy is not "never build our own." The long-term strategy is "build our own deliberately, behind stable boundaries, after the business model and operating needs are proven."
