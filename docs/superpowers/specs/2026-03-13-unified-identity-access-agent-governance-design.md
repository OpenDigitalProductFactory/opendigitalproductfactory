# Unified Identity, Access, and Agent Governance Foundation Design

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Define the shared identity, access-control, delegation, and agent-governance foundation that HR Core, CRM/customer operator access, and AI agent execution will consume.

---

## Overview

The platform is becoming a recursive digital product factory: it builds software for customers while also operating and improving itself. That requires a control model that treats humans, agents, and business domains as one governed system rather than separate feature silos.

The current codebase already has the raw pieces of this split across separate areas:

- `User`, `PlatformRole`, and `UserGroup` provide human platform access control
- `CustomerContact` provides customer-side identity records
- `Agent` provides AI agent registry and portfolio association
- `AgentThread` and `AgentMessage` provide interaction history
- `apps/web/lib/permissions.ts` provides a coarse route-level capability matrix

What is missing is the shared governance layer above those models:

- who organizationally owns an agent
- which human is accountable for an agent's actions
- which team may use or supervise an agent
- what the agent is approved to do by default
- when a human may temporarily delegate elevated authority to an agent
- how effective authority is resolved at runtime
- how these decisions are audited and later integrated with an external identity provider

This spec adds that shared layer without rewriting the current `User` and `Agent` models. The design is intentionally additive: it keeps the current data model intact and introduces a governance overlay that can evolve toward a more unified principal model later if needed.

---

## Design Goals

1. Keep humans accountable for agent behavior while allowing meaningful delegation and autonomy.
2. Let teams, not just individuals, own agents organizationally so responsibility survives personnel changes.
3. Make effective authority contextual: an agent's authority depends on both its own policy and the current human using it.
4. Support employees, contractors, internal operators, and future customer-side operators on one governance foundation.
5. Avoid colliding with separate work on AI agent configuration payloads and editor UX.
6. Preserve the option to federate authentication to an external identity platform later.
7. Keep DPF as the source of truth for business governance even if authentication moves elsewhere.

---

## Non-Goals

- Replacing the current `User`, `CustomerContact`, `PlatformRole`, or `Agent` tables
- Defining the raw prompt/config schema for agents
- Building the agent configuration editor or approval UI for config payloads
- Designing payroll, benefits, or full HRIS workflows
- Designing CRM/customer portal flows in detail
- Implementing every object-level authorization rule in the platform
- Replacing the existing `apps/web/lib/permissions.ts` capability layer in one step

---

## Chosen Approach

Three options were considered:

1. Governance overlay on current models
2. Partial identity consolidation
3. Full principal rewrite

This spec chooses **option 1**.

Reasoning:

- It fits the current schema and codebase with the least disruption.
- It can be implemented incrementally without pausing delivery on HR Core, CRM, or agent features.
- It avoids broad migration churn while still creating a stable long-term contract.
- It does not step on parallel work around agent configuration internals.

The design should still keep naming and relationships clean enough that a later shift toward a shared principal core remains possible.

---

## Platform Rule Set

The governing rule of the platform is:

**Humans are the accountable authorities. Agents are governed operators.**

Operational implications:

- agents do not own business authority independently
- an agent may have broad capability, but it may only exercise authority that is valid in the current human and workflow context
- teams own agents organizationally
- humans grant runtime authority contextually
- some actions require explicit, time-bounded delegation grants
- high-risk actions may require approval even if both the human and the agent would otherwise qualify

This produces the desired UX behavior:

- the agent can appear as a teammate
- different humans may experience the same agent with different authority envelopes
- stronger tasks can be routed to more capable agents
- a manager can temporarily elevate an agent for a specific task
- all material actions remain attributable to a human chain of accountability

---

## Current-State Anchors

This design builds on the existing schema rather than replacing it:

- `User` is the current internal authenticated human account
- `UserGroup` joins users to `PlatformRole`
- `PlatformRole` already carries `roleId`, `hitlTierMin`, and SLA metadata
- `CustomerContact` is the existing customer-side identity record
- `Agent` is the current machine teammate registry
- `AgentThread` and `AgentMessage` already capture user-agent interaction context
- `permissions.ts` currently maps coarse capabilities to platform roles

This spec treats those as the base identity records and adds a governance layer above them.

---

## Architectural Model

The system is split into five layers:

### 1. Authentication layer

Confirms who is signing in.

Near term:

- local app authentication remains in place
- `User` and `CustomerContact` remain the authenticated records

Future:

- federation to an external identity provider such as Keycloak, authentik, or ZITADEL is supported through a mapping boundary

### 2. Identity record layer

Represents the raw account records:

- `User`
- `CustomerContact`
- `Agent`

These are not yet unified into one table.

### 3. Governance layer

Adds the shared control plane:

- team ownership
- human-to-team membership
- agent governance profile
- capability classes
- delegation grants
- directive policy classes
- authorization decision logging

### 4. Authorization resolution layer

Calculates effective authority for a specific request by combining:

- human session authority
- team and relationship context
- agent baseline policy
- business-object constraints
- temporary delegation grants

### 5. Experience layer

Exposes the results in the UX:

- route gating
- action button availability
- approval prompts
- delegation grant prompts
- audit visibility
- agent-task review flows

---

## Domain Model

This section proposes new models and concepts. Names may still shift during implementation, but the boundaries should remain stable.

### Existing models retained as-is

- `User`
- `CustomerContact`
- `PlatformRole`
- `UserGroup`
- `Agent`

### New: `Team`

Organizational owner unit for both humans and agents.

Purpose:

- group humans into durable operating units
- give agents an organizational home
- support continuity when individual humans change

Suggested fields:

```prisma
model Team {
  id          String   @id @default(cuid())
  teamId      String   @unique
  name        String
  slug        String   @unique
  description String?
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### New: `TeamMembership`

Relates internal users to teams and identifies their responsibility mode.

Purpose:

- expresses organizational membership
- supports team-based ownership and supervision
- distinguishes member vs manager vs approver style relationships

Suggested fields:

```prisma
model TeamMembership {
  id        String   @id @default(cuid())
  teamId    String
  userId    String
  role      String   // member | manager | approver | operator
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())

  team      Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
}
```

### New: `AgentOwnership`

Makes team ownership explicit and allows primary/secondary responsibility without forcing one human owner.

Purpose:

- teams own agents as durable organizational assets
- named humans can still be designated as current supervisors or approvers

Suggested fields:

```prisma
model AgentOwnership {
  id               String   @id @default(cuid())
  agentId          String
  teamId           String
  responsibility   String   // owning_team | operating_team | approving_team
  createdAt        DateTime @default(now())

  agent            Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)
  team             Team  @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@unique([agentId, teamId, responsibility])
}
```

### New: `AgentCapabilityClass`

Defines what categories of work an agent is built and approved to do.

Purpose:

- supports the "right skill for the right job" model
- separates capability tier from human authority
- lets the platform classify simple vs high-complexity agents

Suggested fields:

```prisma
model AgentCapabilityClass {
  id                 String   @id @default(cuid())
  capabilityClassId  String   @unique
  name               String
  description        String?
  riskBand           String   // low | medium | high | critical
  defaultActionScope Json
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

### New: `AgentGovernanceProfile`

Defines the baseline control envelope for an agent.

Purpose:

- autonomy level
- whether delegation is allowed
- whether approval is mandatory for certain classes of actions
- what directive policy class governs the agent

Suggested fields:

```prisma
model AgentGovernanceProfile {
  id                    String   @id @default(cuid())
  agentId               String   @unique
  capabilityClassId     String
  autonomyLevel         String   // advisory | constrained_execute | supervised_execute | elevated_execute
  hitlPolicy            String   // always | risk_based | never_without_grant
  allowDelegation       Boolean  @default(true)
  maxDelegationRiskBand String?  // low | medium | high | critical
  directivePolicyClass  String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  agent                 Agent                @relation(fields: [agentId], references: [id], onDelete: Cascade)
  capabilityClass       AgentCapabilityClass @relation(fields: [capabilityClassId], references: [id])
}
```

### New: `DelegationGrant`

Time-bounded human-issued authority grants for a specific agent and task scope.

Purpose:

- supports manager-driven temporary elevation
- creates explicit accountability for elevated execution
- avoids permanently over-privileging agents

Suggested fields:

```prisma
model DelegationGrant {
  id                  String   @id @default(cuid())
  grantId             String   @unique
  grantorUserId       String
  granteeAgentId      String
  targetUserId        String?  // optional human beneficiary/operator context
  scopeJson           Json
  reason              String?
  riskBand            String
  status              String   @default("active") // active | expired | revoked | consumed
  validFrom           DateTime
  expiresAt           DateTime
  maxUses             Int?
  useCount            Int      @default(0)
  workflowKey         String?
  objectRef           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  grantorUser         User  @relation("DelegationGrantGrantor", fields: [grantorUserId], references: [id])
  granteeAgent        Agent @relation(fields: [granteeAgentId], references: [id])
}
```

### New: `DirectivePolicyClass`

Defines categories and governance semantics for agent directives without storing raw prompt/config payloads.

Purpose:

- creates a contract with the separate agent-configuration workstream
- lets this foundation define approval and audit semantics without owning config internals

Suggested fields:

```prisma
model DirectivePolicyClass {
  id                 String   @id @default(cuid())
  policyClassId      String   @unique
  name               String
  description        String?
  configCategory     String   // persona | workflow | tool_access | compliance | domain_rules
  approvalMode       String   // self_service | manager_approval | admin_approval
  allowedRiskBand    String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

### New: `AuthorizationDecisionLog`

Persistent audit record for allow/deny decisions.

Purpose:

- explains why a request succeeded or failed
- captures the authority chain
- supports later compliance, incident analysis, and UX transparency

Suggested fields:

```prisma
model AuthorizationDecisionLog {
  id                 String   @id @default(cuid())
  decisionId         String   @unique
  actorType          String   // user | customer_contact | agent
  actorRef           String
  humanContextRef    String?
  agentContextRef    String?
  delegationGrantId  String?
  actionKey          String
  objectRef          String?
  decision           String   // allow | deny | require_approval
  rationale          Json
  createdAt          DateTime @default(now())
}
```

### Application concept: `PrincipalContext`

This does not need to be a table in the first phase. It should exist as a runtime object assembled at request time.

Suggested shape:

```ts
type PrincipalContext = {
  authenticatedSubject:
    | { kind: "user"; userId: string }
    | { kind: "customer_contact"; contactId: string };
  actingHuman:
    | { kind: "user"; userId: string }
    | { kind: "customer_contact"; contactId: string };
  actingAgent?: { agentId: string };
  teamIds: string[];
  platformRoleIds: string[];
  effectiveCapabilities: string[];
  delegationGrantIds: string[];
};
```

This gives the authorization layer one consistent runtime envelope even while persistence remains split across current tables.

---

## Effective Authority Resolution

The platform should use a mixed authority model:

- baseline authority is the intersection of human authority and agent baseline policy
- temporary elevation is possible through explicit delegation grants

Resolution order:

1. authenticated human authority
2. team and relationship context
3. agent capability class
4. agent governance profile
5. business-object constraints
6. active delegation grants

Result:

```ts
effectiveAuthority =
  intersect(
    humanAuthority,
    agentBaselineAuthority,
    contextualBusinessConstraints
  ) + validDelegationGrantExtensions;
```

Rules:

- agents cannot self-elevate
- delegation must always point to a human grantor
- grants must be bounded by time and scope
- grants may be single-use or limited-use
- grants must respect the agent's `maxDelegationRiskBand`
- high-risk operations may still require a separate approval checkpoint
- each decision writes an `AuthorizationDecisionLog`

---

## Human-In-The-Loop Model

Human-in-the-loop is not just an approval checkbox. It is the platform's accountability structure.

Three modes:

1. **Advisory**
   Agent proposes, human executes.

2. **Supervised execution**
   Agent may execute within baseline scope, but review is required for sensitive operations.

3. **Delegated elevation**
   Human explicitly grants a higher envelope for a bounded workflow or object.

Typical manager flow:

1. manager is signed in
2. manager selects or invokes an agent in the UX
3. agent baseline policy says the requested action is above normal baseline scope
4. system offers a delegation flow
5. manager enters reason, scope, duration, and confirms
6. `DelegationGrant` is created
7. action executes under the combined authority context
8. audit log records grantor, agent, action, object, and rationale

This matches the desired behavior described in the brainstorming session.

---

## HR Core Relationship To This Foundation

HR Core should not own access control by itself. It should consume this foundation.

HR-specific work that becomes cleaner after this foundation:

- employee lifecycle state
- contractor and operator relationship handling
- team membership and managerial structure
- role assignment and removal
- who is allowed to supervise which agents
- workforce reporting by domain and authority tier

Implication:

- `EmployeeProfile` belongs in the HR epic
- identity governance, delegation, and authority resolution belong in this foundation epic

This avoids coupling personnel lifecycle rules directly to authorization mechanics.

---

## Customer And CRM Relationship To This Foundation

The user stated that CRM and customer portal work are separate epics, but the foundation must support them.

Near-term rule:

- `CustomerContact` remains the customer-side account record
- customer portal auth and CRM workflow design remain out of scope

Foundation contract:

- customer-side operators can later participate in `PrincipalContext`
- their authority will be constrained to their account/domain context
- they may use permitted agents in their own bounded authority envelope
- team ownership and agent governance remain reusable for customer-facing agents

This is why the foundation must be broader than employee-only identity.

---

## Authorization Model Evolution

The current `permissions.ts` model is route-level and role-list based. It is good enough for coarse navigation, but not sufficient for governed human-agent execution.

The target evolution is:

### Phase A: coexistence

- keep `can()` and route gating for tiles and page access
- add new authorization resolver for governed actions

### Phase B: action-level enforcement

- server actions call the new resolver
- resolver reads human, team, agent, and grant context
- route-level gating remains a coarse prefilter

### Phase C: policy-backed capabilities

- capability keys and action families become data-backed
- some or all of `PERMISSIONS` may eventually move into DB policy records

This staged approach minimizes disruption and keeps the current app usable while the new control plane is added.

---

## External Identity Provider Boundary

The platform should be designed so authentication may later move to an open-source identity platform, while governance stays inside DPF.

Examples of future-compatible external IdPs:

- Keycloak
- authentik
- ZITADEL

What the external IdP should own:

- login
- federation
- MFA
- credential lifecycle
- SSO
- possibly coarse groups/claims

What DPF should continue to own:

- business roles and route capability semantics
- team ownership
- human accountability chains
- delegation grants
- agent governance profiles
- directive policy classes
- authorization decision logs
- workflow and object-level approval rules

Implementation boundary:

- add optional external identity reference fields later, for example on `User` and `CustomerContact`
- map external claims into `PrincipalContext`
- do not make the external IdP the source of truth for agent delegation logic

This preserves local operability now and enterprise federation later.

---

## UX Surfaces

This spec does not design final UI layouts in detail, but it does define the required UX capabilities.

### Required experiences

1. Human identity visibility
   Show roles, teams, status, and relationship type for the acting human.

2. Agent governance visibility
   Show ownership team, capability class, autonomy level, and whether the agent is currently elevated by grant.

3. Delegation flow
   When a requested action exceeds baseline scope, the UX prompts for a bounded delegation grant.

4. Approval flow
   High-risk actions surface a required approval step even when technically executable.

5. Decision explainability
   The platform can say why an action is blocked, allowed, or pending approval.

6. Audit visibility
   Operators and auditors can inspect historical authority chains.

### Likely route ownership

- `/employee` for workforce and relationship management
- `/admin` for user and access oversight
- `/ea/agents` or successor agent-governance views for agent registry visibility
- `/platform` for policy, provider, and governance administration

Exact route decomposition is an implementation concern for later specs and plans.

---

## Integration Boundary With Agent Configuration Work

Another agent is currently working on AI agent configuration. This spec must not conflict with that work.

Therefore this foundation owns:

- directive policy categories
- approval modes for directive classes
- authority and risk semantics for agent execution
- links from governance profiles to policy classes

This foundation does **not** own:

- raw prompt templates
- provider/model config payloads
- tool manifest internals
- config editor UX
- versioning format for agent configs

Contract between the two workstreams:

- configuration work defines what can technically be configured
- governance work defines who may approve which classes of configuration and how those classes affect runtime authority

---

## Data Flow

### Standard agent action

1. Human signs in.
2. Session resolves `User` or `CustomerContact`.
3. System assembles `PrincipalContext`.
4. If an agent is involved, system loads `AgentGovernanceProfile` and ownership/team data.
5. Authorization resolver evaluates baseline authority.
6. If allowed, action proceeds and a decision log is written.

### Elevated agent action

1. Human requests action above baseline.
2. Resolver returns `require_approval` or `deny_with_possible_grant`.
3. UX offers bounded delegation flow if policy allows it.
4. Human creates `DelegationGrant`.
5. Resolver re-evaluates with grant in context.
6. Action proceeds if now valid.
7. Grant usage and decision log are updated.

---

## Failure And Risk Handling

Failure modes the design must handle:

- user is authenticated but has no team context
- agent belongs to no owning team
- delegation grant expired between prompt and execution
- human has authority, but agent policy forbids the action
- agent policy allows a class of action, but business-object constraints deny it
- customer-side operator attempts cross-account action
- external IdP claim exists, but DPF mapping is missing or stale

Required platform behavior:

- fail closed for governed actions
- give user-facing deny reasons that are understandable
- write deny decisions to `AuthorizationDecisionLog`
- never silently upgrade authority
- never let agent context replace human accountability context

---

## Testing Strategy

The implementation that follows this spec should be tested at four levels.

### 1. Pure authorization logic tests

Examples:

- baseline intersection logic
- grant expiry logic
- risk-band cap logic
- deny-with-explanation behavior

### 2. Data-model tests

Examples:

- unique constraints on team membership and grant identifiers
- ownership relationships
- allowed/required nullability for target workflow/object references

### 3. Server action integration tests

Examples:

- manager can delegate within policy
- non-manager cannot grant elevated authority outside policy
- agent cannot execute elevated action after grant expiry

### 4. Route and UX gating tests

Examples:

- button visible but elevation prompt required
- decision explanation renders expected reason
- audit entries appear after allow and deny cases

---

## Rollout Strategy

The foundation should be introduced incrementally.

### Step 1

Add governance tables and a small resolver library without changing current route gating.

### Step 2

Adopt the resolver in a small number of governed actions first:

- role assignment
- user lifecycle changes
- selected agent-triggered actions

### Step 3

Add delegation grant UX and audit visibility.

### Step 4

Expand to HR lifecycle, CRM/customer operators, and more agent-driven workflows.

### Step 5

Add optional external IdP federation boundary when the platform is ready.

---

## Out Of Scope For This Spec

- final `EmployeeProfile` schema and HR route UX
- payroll or benefits administration
- CRM workflow detail and customer portal UX
- full object-level policy language
- service-account or workload identity implementation
- agent config payload schema/editor
- replacing all current route permissions with DB-native policy in one pass

---

## Summary

The correct first move is not to merge HR, CRM, and agent configuration into one giant feature. It is to build a shared governance foundation that all three can consume.

That foundation should:

- keep current account models
- add team ownership and governance overlays
- resolve authority from both human and agent context
- support bounded delegation grants
- preserve human accountability
- stay compatible with later external identity federation
- avoid colliding with parallel work on raw agent configuration

This gives DPF the control model it needs to become a self-operating and self-improving factory without losing accountability.
