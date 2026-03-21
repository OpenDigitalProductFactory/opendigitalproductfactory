# WhatsApp Secretary Gateway Design

**Date:** 2026-03-21  
**Status:** Draft  
**Epic:** EP-SECRETARY-001  
**Goal:** Add a WhatsApp-first company secretary that can communicate through a single company identity, act within the authority of validated employees, serve unknown/public contacts in a limited mode, and route cross-human asks into the platform's governed queue.

---

## 1. Problem Statement

The current AI coworker is built around authenticated in-app usage:

- `AgentThread` and `AgentMessage` are tied to platform users
- authority assumes a logged-in employee session
- human review is modeled mainly as same-user proposal approval
- the coworker has no external channel identity or channel/session model

That is not sufficient for a company-facing secretary workflow.

The target experience is:

- a company operates one outward-facing secretary identity
- employees can message that secretary from WhatsApp while in the field
- the secretary may act for the validated employee, but never beyond that employee's authority
- unknown/public senders get only public or narrowly-scoped workflow access
- when another human must act, the secretary creates a governed ask in the human queue and follows up

The secretary must be useful, but it must not become a backdoor admin user.

---

## 2. External Design Reference: OpenClaw

This design is informed by OpenClaw's chat-channel architecture, especially its separation of channel transport from agent runtime and authority policy.

Key reference patterns:

- One running gateway owns channel connections and reconnect behavior
- Inbound messages are routed deterministically from channel/account/peer bindings
- Channel sessions are distinct from the agent's internal workspace and memory
- A bot/channel can have one outward identity while internal routing remains separate

Relevant sources:

- OpenClaw GitHub: <https://github.com/openclaw/openclaw>
- Multi-agent routing: <https://docs.openclaw.ai/concepts/multi-agent>
- Channel routing: <https://docs.openclaw.ai/channels/channel-routing>
- WhatsApp channel docs: <https://docs.openclaw.ai/channels/whatsapp>

Patterns to copy:

- channel adapter as a bounded subsystem
- channel/account/peer scoped sessions
- deterministic routing before model execution
- separate external identity from internal agent state

Patterns not to copy blindly:

- treating the channel identity itself as the authority principal
- coupling inbound messages directly to unrestricted tool execution
- assuming the same session model works for both chat transport and business governance

---

## 3. Design Goals

1. Provide a single company-facing WhatsApp secretary identity.
2. Let validated employees interact with the secretary through bound phone numbers.
3. Allow the secretary to act only within the authority envelope of the validated employee.
4. Support unknown/public senders in a limited, safe mode.
5. Route cross-human asks into a shared, governed human queue rather than a chat-only approval path.
6. Preserve HITL, auditability, and current authorization principles.
7. Reuse the current coworker, proposal, notification, and governance foundations where possible.

## 4. Non-Goals

1. Full omnichannel support in the first slice.
2. Payments, credential changes, or unrestricted admin actions through chat.
3. Replacing the in-app coworker.
4. Granting the secretary independent authority.
5. Solving all customer identity and CRM workflow design in this epic.

---

## 5. Chosen Approach

Three approaches were considered:

1. Put WhatsApp transport directly inside the Next.js app
2. Add a dedicated secretary gateway in front of the existing coworker stack
3. Use an external inbox/helpdesk as the primary system and let DPF sit behind it

This spec chooses **option 2**.

Reasoning:

- It matches the strongest OpenClaw pattern: transport concerns are isolated from reasoning and business logic.
- It keeps reconnect, session, delivery, and proactive outbound messaging out of the main web runtime.
- It allows DPF to reuse the existing coworker, routing, tool, and audit layers without turning the web app into a channel daemon.
- It creates a clean path to future SMS or other messaging channels.

---

## 6. Core Principle

**The secretary has an external identity, but no independent business authority.**

Every action must resolve through:

- sender trust level
- validated employee authority, if the sender is a bound employee
- secretary policy ceiling
- workflow-specific risk rules
- step-up requirements for sensitive actions

Effective rule:

**effective secretary authority = validated employee authority ∩ secretary policy ∩ workflow scope**

---

## 7. Identity Model

The design uses three identity layers.

### 7.1 Secretary identity

The company-facing service identity:

- one WhatsApp Business number
- one display name and profile
- one durable internal identity record

This identity is not a human and must never be treated as a substitute employee account.

### 7.2 Employee principal

The validated internal human whose authority may be exercised through the secretary.

This maps to the current employee/user foundation:

- `User`
- `EmployeeProfile`

### 7.3 External contact

The outside party messaging the secretary:

- known customer contact
- known customer account contact
- partner/vendor contact later
- unknown/public sender

These actors do not inherit employee authority.

---

## 8. Trust Classes

### 8.1 Unknown/public sender

Allowed:

- public information
- product/service information
- store/service availability
- appointment inquiry or lightweight booking request
- pass a message

Not allowed:

- privileged data access
- employee-only operational actions
- financial or administrative actions

### 8.2 Known customer/contact sender

Allowed:

- the same public-safe actions
- known-contact workflow actions the platform explicitly permits
- customer-safe scheduling and status workflows

Not allowed:

- employee authority
- admin/security actions

### 8.3 Bound employee sender

Allowed:

- low-risk operational actions within the employee's actual authority
- secretary-assisted coordination
- queue/ask generation for other humans
- proactive reminder and follow-up workflows

Sensitive actions may require step-up.

---

## 9. Employee Binding Model

Employee validation is anchored on explicit channel binding, not on heuristic identity recognition.

### 9.1 Binding rule

Each employee may bind one or more approved WhatsApp numbers to their account.

Binding flow:

1. Employee signs into DPF
2. Employee registers a WhatsApp number
3. Platform initiates a verification challenge
4. On success, the number is bound to the employee
5. Future WhatsApp messages from that number are treated as employee-authenticated channel traffic

### 9.2 Why this is required

- It gives a clear trust anchor for field usage
- It avoids treating a phone number as authority without proof
- It keeps channel identity separate from in-app login identity

---

## 10. Action Trust Tiers

### 10.1 Public

Examples:

- answer product/service questions
- provide hours or location information
- pass messages
- lightweight booking inquiry

Available to unknown/public senders.

### 10.2 Bound-employee operational

Examples:

- check or adjust schedules
- create low-risk operational records
- create backlog items
- notify a customer
- coordinate internal work

Allowed from a bound employee number without extra approval if the employee already holds the required authority.

### 10.3 Bound-employee sensitive

Examples:

- sensitive customer or HR disclosures
- materially consequential workflow changes
- certain compliance or financial commitments

These require step-up confirmation.

### 10.4 Prohibited in chat

Examples:

- payments
- credentials or secrets
- security/admin configuration changes
- any action beyond the employee's real authority

These are never executed directly from WhatsApp.

---

## 11. Step-Up Policy

This design chooses:

**bound number only for normal actions, with step-up only for high-risk actions**

### 11.1 Step-up triggers

- action classified as sensitive
- action touches restricted data or workflow
- action exceeds secretary policy ceiling
- action affects another party materially

### 11.2 Step-up method

Primary method in v1:

- create a queue item / approval task in the platform
- optionally send the employee a confirmation link or notification

Future options:

- one-time approval codes
- device-bound approval confirmations

### 11.3 Audit

Step-up must log:

- originating WhatsApp session
- requesting sender
- validated employee
- action requested
- approving human
- final decision

---

## 12. Runtime Architecture

### 12.1 Secretary Gateway

A new bounded subsystem responsible for:

- WhatsApp connection lifecycle
- channel session tracking
- inbound message normalization
- outbound delivery
- delivery state and retries
- proactive sends

The gateway is the transport/runtime owner for the secretary channel.

### 12.2 Secretary Orchestrator

Receives normalized channel events and:

- resolves sender trust level
- resolves bound employee if applicable
- determines allowed action envelope
- invokes the existing coworker/routing/tool stack with secretary-specific policy

### 12.3 Shared platform services reused

- `AgentThread`
- `AgentMessage`
- `AgentActionProposal`
- `Notification`
- `DelegationGrant`
- `AuthorizationDecisionLog`

---

## 13. Session and Thread Model

OpenClaw's channel/peer session pattern should be mirrored here.

### 13.1 Secretary session

Channel-side session of record, keyed by:

- secretary identity
- channel type
- channel account
- peer reference (phone number)

This is distinct from the internal coworker conversation thread.

### 13.2 Agent thread

The internal reasoning/audit conversation already represented by `AgentThread`.

### 13.3 Mapping rule

One active `SecretarySession` links to one active `AgentThread`, but the secretary session remains the source of truth for transport continuity.

This avoids overloading the current `userId + contextKey` thread model with external chat semantics.

---

## 14. Human Ask / Queue Model

The secretary should not create a separate WhatsApp-only approval path.

Instead, it should route work into a shared human queue.

### 14.1 Queue item types

The queue needs to support:

- `proposal` — the agent wants to execute an action
- `ask` — another human must provide input or perform an action
- `handoff` — responsibility moves to another employee
- `reminder` — follow-up or nudge on outstanding work

### 14.2 Why proposals alone are not enough

Current `AgentActionProposal` is too narrow for secretary workflows because it is modeled around same-user approval in a conversation thread.

Secretary scenarios include:

- field employee asks finance to act
- customer asks for a callback
- employee asks the secretary to get manager approval
- customer message needs assignment to another employee

These are workflow items, not just chat proposals.

### 14.3 Recommended direction

Keep `AgentActionProposal` as an existing primitive and historical pattern, but evolve toward a broader human work queue as the system of record.

Notifications remain a delivery mechanism, not the record of truth.

---

## 15. Authority Resolution Flow

For every inbound message:

1. Normalize inbound WhatsApp event
2. Resolve `SecretarySession`
3. Resolve sender class:
   - bound employee
   - known customer/contact
   - unknown/public sender
4. Determine requested intent/action
5. Compute effective authority:
   - sender trust class
   - bound employee authority if present
   - secretary policy ceiling
   - workflow rules
   - step-up requirement
6. Choose one result:
   - direct execution
   - queue item / ask
   - step-up request
   - refusal / public-safe fallback
7. Log decision and respond

---

## 16. Proactive Secretary Behavior

This design is intentionally proactive, not just reactive.

### 16.1 Allowed proactive behaviors

- remind field staff about appointments, tasks, missing inputs, or approvals
- remind customers about appointments or expected follow-ups
- prompt employees about queue items awaiting action
- nudge on SLA breaches or stuck asks

### 16.2 Proactive limits

- no high-risk action without normal authority checks
- no proactive disclosure of sensitive information to an unverified sender
- no proactive activity outside tenant-configured policy

### 16.3 Scheduling source

These proactive messages should be driven by real platform workflow state, not ad hoc LLM initiative.

---

## 17. Proposed Data Model Additions

Exact naming may shift during implementation, but the boundaries should stay stable.

### 17.1 `SecretaryIdentity`

Represents the durable company-facing secretary identity.

Suggested fields:

- `secretaryId`
- `organizationId`
- `name`
- `status`
- `policyClassId`
- `defaultLanguage`

### 17.2 `SecretaryChannel`

Represents one external messaging channel bound to a secretary identity.

Suggested fields:

- `secretaryId`
- `channelType` (`whatsapp`)
- `accountRef`
- `phoneNumber`
- `status`
- `transportConfig`

### 17.3 `EmployeeChannelBinding`

Represents a verified employee-owned external number.

Suggested fields:

- `employeeProfileId`
- `channelType`
- `externalUserRef`
- `verifiedAt`
- `status`
- `lastSeenAt`

### 17.4 `SecretarySession`

Represents one channel/peer conversation continuity record.

Suggested fields:

- `secretaryId`
- `channelType`
- `accountRef`
- `peerRef`
- `linkedEmployeeId?`
- `linkedContactId?`
- `trustLevel`
- `activeThreadId?`
- `lastMessageAt`

### 17.5 `HumanQueueItem` or equivalent generalized queue model

Represents a human action/approval/request item.

Suggested fields:

- `queueItemId`
- `kind` (`proposal` | `ask` | `handoff` | `reminder`)
- `requestedByType`
- `requestedByRef`
- `actingForUserId?`
- `targetUserId?`
- `status`
- `sourceChannel`
- `sourceSessionId?`
- `relatedEntityType?`
- `relatedEntityId?`
- `authorityClass`
- `dueAt?`
- `resolvedAt?`

---

## 18. Reuse of Existing Models

The design should reuse the current governance/audit foundations:

- `DelegationGrant` for bounded authority envelopes where needed
- `AuthorizationDecisionLog` for final allow/deny/audit records
- `AgentThread` and `AgentMessage` for internal conversation state
- `Notification` for in-app and future push delivery

`AgentActionProposal` should be reused where it still fits, but not treated as the final model for all secretary-mediated human work.

---

## 19. Security Rules

The following rules are mandatory:

1. The secretary is never an admin user.
2. The secretary never originates authority.
3. Bound phone number proves channel possession, not unlimited authority.
4. Unknown senders remain public/limited by default.
5. Every non-public action must resolve to a human authority context or be refused.
6. Cross-human coordination becomes a queue item, not an implicit side effect.
7. High-risk actions require step-up.
8. Certain actions are categorically blocked in chat.

---

## 20. WhatsApp-First Rollout Plan

### Slice 1

WhatsApp secretary for:

- public-safe interactions
- employee-bound low-risk operational actions
- cross-human asks routed into the shared queue

No payments, no admin actions, no secrets.

### Slice 2

Proactive reminders and field coordination:

- appointment reminders
- follow-up nudges
- outstanding ask reminders
- field employee coordination prompts

### Slice 3

Sensitive step-up workflows:

- approval tasks
- stronger confirmation paths
- higher-risk action classes

### Slice 4

Multi-channel expansion:

- SMS or other business messaging channels
- reuse the same secretary identity, session, and authority model

---

## 21. Files and Components Likely Affected

### New areas

- `apps/web/lib/secretary/` — gateway/orchestration helpers
- channel adapter service or worker runtime for WhatsApp
- queue service/actions for human asks

### Existing areas to extend

- `packages/db/prisma/schema.prisma`
- `apps/web/lib/actions/agent-coworker.ts`
- `apps/web/lib/actions/proposals.ts`
- `apps/web/lib/mcp-tools.ts`
- notification surfaces and queue UI
- employee/settings/admin surfaces for channel binding and secretary config

---

## 22. Testing Strategy

### Unit tests

- sender trust classification
- employee binding verification logic
- authority resolution
- step-up policy classification
- queue routing rules

### Integration tests

- bound employee WhatsApp message -> operational action allowed
- unknown sender -> public-only behavior
- bound employee sensitive action -> step-up required
- cross-human request -> queue item created + notification sent

### End-to-end tests

- WhatsApp inbound -> secretary session -> thread mapping -> reply
- field employee asks for help -> target human queue item -> completion -> secretary follow-up

### Security verification

- blocked actions from unknown senders
- blocked high-risk actions without step-up
- blocked actions beyond employee authority
- audit log written for all non-public decisions

---

## 23. Open Questions Deferred

1. Exact WhatsApp provider/runtime choice and ops model.
2. Whether a separate `SecretaryMessage` raw transport log is needed in slice 1 or later.
3. Whether the human queue should extend `AgentActionProposal` or introduce a new canonical queue table immediately.
4. Whether known customer contacts get richer self-service authority in later phases.

---

## 24. Recommendation

The first implementation spec after this one should be:

**WhatsApp Secretary Gateway + Employee Channel Binding + Human Ask Queue**

That is the smallest slice that proves the real product value:

- a durable company secretary identity
- employee-backed authority
- limited public-safe access for unknown senders
- governed cross-human coordination
- proactive field-friendly operation without violating HITL or authorization boundaries
