# Unified Capability and Integration Lifecycle — Design Spec

| Field | Value |
| ----- | ----- |
| **Epic** | AI Workforce / Platform Integrations |
| **Status** | Review |
| **Created** | 2026-04-12 |
| **Author** | Codex for Mark Bodman |
| **Reviewed by** | Codex (30 revisions), Claude Opus 4.6 (revision 2 + final review) |
| **Scope** | `apps/web/app/(shell)/platform/ai/**`, `apps/web/app/(shell)/platform/services/**`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/tak/mcp-server-tools.ts`, `apps/web/lib/actions/ai-providers.ts`, `apps/web/lib/actions/mcp-services.ts`, audit/reporting surfaces |
| **Primary Goal** | Standardize how integrations are connected, governed, exposed, and audited across AI coworkers without flattening away the real differences between internal tools, external MCP services, and provider-native execution paths |
| **Design Principle** | Unify the product model around capabilities and lifecycle; keep execution adapters and transport details separate underneath |

---

## 1. Problem Statement

The current AI admin surface mixes too many concepts at the same level:

- model providers and endpoint routing
- external MCP services
- Build Studio CLI dispatch
- route logs and async operations
- proposal history and authority audit
- skills observability

This creates a UX that reflects implementation boundaries rather than operator tasks. The result is a system that is individually understandable in code, but hard to reason about as a whole.

### 1.1 Current symptoms

Based on the live system state and current code paths on 2026-04-12:

- `Test connection` on the provider detail page performs more than a connection test. It chains auth verification, model discovery, and model profiling.
- `Sync Models & Profiles` overlaps with that same flow, but skips the auth check.
- `Run Eval` and `Run Probes` are separate calibration/health concepts, but the UX does not make their differences legible.
- Build Studio provider/model choices are a separate CLI dispatch configuration, but they visually read like just another model-routing control.
- AI admin exposes both provider/service registry concepts and MCP service activation concepts in adjacent panels without a clean mental model.
- Route logs currently have score inconsistencies:
  - one screen assumes score scale `0-100`
  - another assumes `0-1`
  - live data already contains `NaN`
- `Action History` and `Authority` overlap as audit surfaces, but actually represent different runtime events.
- `Skills` is implemented as an observability/catalog surface, but is presented like a peer to routing and authority.

### 1.2 Current architecture split

The current platform effectively has **two registries** and **one partial unification layer**:

1. `ModelProvider` / `ModelProfile` / `AgentModelConfig`
   - inference providers
   - model discovery and profiling
   - routing and assignment

2. `McpIntegration` / `McpServer` / `McpServerTool`
   - integration catalog
   - activated external MCP servers
   - external tool discovery

3. `getAvailableTools()`
   - partially unifies platform-native tools and external MCP tools into one runtime tool surface
   - governance filters already apply across both

This means the backend is already trending toward a unified capability model, but the product UX still exposes the underlying storage/layout split.

---

## 2. Goals

1. Define a single operator mental model for AI coworker capabilities and integrations
2. Standardize the lifecycle of integrations across internal and external capability sources
3. Preserve execution-path differences where they matter operationally
4. Make MCP legible without making it the primary mental model for most users
5. Introduce selective audit policy so the system records what matters without drowning in low-value tool chatter
6. Clarify which screens are for:
   - connecting
   - calibrating
   - assigning
   - observing
   - auditing

### 2.1 IT4IT value stream alignment

This spec spans three IT4IT v3.0.1 value streams. Each proposed admin section maps to a primary stream:

| Proposed section | Primary IT4IT value stream | Rationale |
| --- | --- | --- |
| AI Workforce | **Integrate** | Agent assignment, routing, skill composition — assembling service components |
| Tools & Integrations | **Integrate** / **Evaluate** | Capability discovery, integration activation, trust policy — onboarding external service sources; evaluating new integrations for fitness |
| Audit & Operations | **Operate** | Health monitoring, event ledger, authority audit — runtime governance and observability |

Cross-cutting concerns:

- **Routing & Calibration** touches **Evaluate** (scoring models for fitness) and **Integrate** (assigning them to agents)
- **Capability Inventory** touches **Integrate** (what is available) and **Operate** (is it healthy)

Agent ownership: When breaking this into implementation tasks, check the agent registry for existing agents in each value stream. Integration lifecycle work should be owned by Integrate-stream agents; audit refinement by Operate-stream agents.

### 2.2 Non-goals

- Replace all provider adapters with MCP
- Force every internal platform capability to be implemented as an MCP server
- Fully redesign the skills system in this epic
- Implement a new security model; this design reuses existing capability checks, tool grants, and HITL proposal flow
- Build a complete resources/prompts marketplace in phase 1

---

## 3. Research & Benchmarking

This design is informed by a mix of open standards, open-source systems, and commercial agent/tool platforms.

### 3.1 Open source / open ecosystem systems reviewed

#### A. Model Context Protocol ecosystem

What we learned:

- MCP cleanly separates **clients**, **servers**, and protocol primitives such as **tools**, **resources**, and **prompts**
- MCP standardizes the interface, not the business lifecycle of credentials, policy, or audit
- MCP is strongest as a transport and interoperability contract, not as the top-level user mental model

Patterns adopted:

- keep MCP as an execution and interoperability layer
- keep protocol primitives visible in architecture, but do not force them into the main admin IA for non-technical operators

Patterns rejected:

- treating “MCP” itself as the primary admin information architecture category

Sources:

- Model Context Protocol docs: architecture, client/server concepts, primitives

#### B. n8n

What we learned:

- n8n cleanly separates **credentials**, **nodes**, and generic fallback HTTP actions
- “credential-only” integrations are treated as real admin objects even when no specialized action surface exists yet
- credential testing and encryption are explicit parts of the lifecycle, not hidden side effects

Patterns adopted:

- integration lifecycle should be explicit: credentials, test, readiness, allowed actions
- support integrations that unlock capability without requiring a custom first-class UI for every one

Patterns rejected:

- overloading one button to simultaneously test, sync, profile, and calibrate

Sources:

- n8n docs: integrations, built-in node types, credentials library, credentials testing

### 3.2 Commercial systems reviewed

#### A. Anthropic Claude Code / Claude.ai MCP

What we learned:

- remote/local MCP server configuration is treated as a distinct concern from model/provider selection
- managed allowlists/denylists, tool search, output limits, OAuth flows, and dynamic tool updates are first-class concerns
- the docs explicitly warn about trust, prompt injection, and oversized output

Patterns adopted:

- capability exposure should support allow/deny policy and lazy exposure
- MCP output and trust controls should be treated as integration governance, not buried in provider routing

Patterns rejected:

- assuming all external tools are equally trustworthy or should always be fully exposed

Sources:

- Claude Code MCP docs

#### B. Microsoft Copilot Studio

What we learned:

- connectors, actions, authentication mode, and maker-provided credentials are explicitly modeled
- user credentials vs maker credentials is a first-class choice
- authentication policy is environment-scoped and treated as governance, not as an implementation footnote

Patterns adopted:

- integration auth mode should be explicit in admin UI
- governance policy should apply consistently across connectors, built-in actions, and external services

Patterns rejected:

- leaving credential ownership and auth mode implicit

Sources:

- Copilot Studio docs: connector tools, authentication, maker-provided credentials, SSO policy

### 3.3 Anti-patterns identified

- One control performing multiple hidden lifecycle steps
- Logging every low-value read/search/probe event forever in the same shape as approvals and writes
- Treating MCP as the user mental model instead of as one source/transport
- Mixing routing controls, integration management, and audit/observability on one screen
- Flattening all capabilities as if internal tools, external services, and provider-native functions had identical risk and lifecycle

### 3.4 Differentiator for DPF

DPF’s differentiator is not “support MCP.” Many systems do that.

The differentiator is:

- **one governance model** across internal and external capabilities
- **one coworker-facing capability surface**
- **one operator lifecycle** for connection, readiness, assignment, and audit
- while preserving specialized execution paths for:
  - model routing
  - CLI dispatch
  - external MCP services
  - internal platform tools

---

## 4. Design Principles

### 4.1 Unify around capabilities, not transports

The top-level product object should be the **capability**: something a coworker can do.

Examples:

- create a backlog item
- read a GitHub PR
- query Postgres
- run a browser probe
- update feature brief

How a capability is delivered is secondary.

### 4.2 Keep lifecycle and execution separate

The admin/operator lifecycle should be standardized even when execution differs:

- auth
- test
- health
- discovery
- readiness
- permissions
- audit

But execution can still differ underneath:

- platform-native tool execution
- external MCP tool execution
- provider-native tool calling
- CLI-dispatched tool delivery
- composite orchestrations

### 4.3 Audit selectively

Not all events deserve the same retention, display priority, or storage cost.

Use audit classes, not one flat stream.

### 4.4 MCP is important, but usually not primary

MCP should be first-class in the architecture and integrations area, but for most operators the primary question is:

> What can this coworker do, what does it need to do it, and what happened when it tried?

Not:

> Which protocol transport is in use?

---

## 5. Proposed Unified Model

### 5.1 New product concepts

#### A. Capability

A coworker-facing action or information access unit.

Canonical fields:

- `capabilityId`
- `name`
- `description`
- `sourceType`
- `inputSchema`
- `outputShape`
- `requiredCapability`
- `grantScope`
- `executionMode`
- `riskClass`
- `auditClass`
- `availabilityStatus`
- `integrationDependencies[]`
- `routeContexts[]`
- `buildPhases[]`

##### TAK governance alignment target

TAK is a work in progress, and this section describes the **intended correspondence** between the Capability model and TAK governance concepts rather than a claim about current runtime enforcement.

Current-state note:

- runtime tool exposure today is enforced primarily by the intersection of user role capabilities and `AgentToolGrant` resolution in `getAvailableTools()`
- delegated authority is further shaped by `DelegationGrant.scopeJson`
- TAK/governance models such as `AgentCapabilityClass` are part of the evolving governance vocabulary, but should not be treated here as the current single source of runtime truth

Proposed alignment targets:

- `riskClass` should align with TAK-style risk-band semantics, whether that remains on `AgentCapabilityClass` or moves to a more capability-native structure
- `auditClass` should align with TAK/HITL expectations for autonomy and review, without assuming a one-to-one mapping to the current tier model
- `grantScope` should align with the authority envelope expressed through `DelegationGrant.scopeJson`
- `executionMode` should align with the existing `executionMode` field on `PLATFORM_TOOLS` and any future expanded capability execution taxonomy

If implementation reveals that TAK's current risk band or HITL definitions are too coarse for the capability lifecycle, that should feed back into TAK as a refinement rather than forcing this implementation to conform to a premature model boundary.

##### Relationship to existing PlatformCapability model

The `PlatformCapability` model already exists in the schema (`capabilityId`, `name`, `description`, `state`, `manifest`). Rather than creating a parallel model, the Capability concept described here should extend `PlatformCapability`:

- The `manifest` JSON field can carry the new metadata (`riskClass`, `auditClass`, `sourceType`, `inputSchema`, `outputShape`, etc.) without a breaking schema change
- `state` already provides the availability lifecycle hook
- Phase 1 can enrich `manifest` content; Phase 2 can promote frequently-queried fields to dedicated columns if query performance requires it

##### Source of truth by phase

To avoid creating a stale second registry, capability ownership should be explicit:

- **Phase 1 runtime truth** remains the existing runtime sources:
  - `PLATFORM_TOOLS` for internal platform tools
  - `McpServerTool` for discovered external MCP tools
- **Phase 2 inventory metadata anchor** becomes `PlatformCapability`, enriched from those runtime sources and used to support inventory, classification, and admin-facing metadata
- **Later phase decision**: decide whether `PlatformCapability` should remain an enriched registry overlay or become the canonical authored source for capability metadata

Until that later decision is made, `PlatformCapability` should not be treated as replacing `PLATFORM_TOOLS` execution metadata.

#### B. Integration

A configured connection or activation that unlocks one or more capabilities.

Canonical fields:

- `integrationId`
- `integrationType`
- `name`
- `providerId` or `serverId`
- `authMode`
- `credentialOwnerMode`
- `status`
- `healthStatus`
- `syncStatus`
- `trustStatus`
- `lastTestedAt`
- `lastSyncedAt`
- `capabilityCount`

#### C. Adapter

An internal execution-path implementation detail.

Examples:

- `platform_tool`
- `external_mcp_http`
- `external_mcp_stdio`
- `cli_mcp_delivery`
- `provider_native`
- `composite`

Adapters should be visible in admin diagnostics, but not be the core IA object.

##### Two adapter layers

The codebase has two distinct adapter concepts that should not be conflated:

1. **Capability adapters** (described above) — how a capability is delivered to a coworker (platform tool, external MCP, CLI dispatch, etc.)
2. **Inference adapters** (existing `execution-adapter-registry.ts`) — how model calls are routed at the transport level (chat, responses, image_gen, embedding, transcription, async, cli)

These are orthogonal. A `composite` capability adapter might internally use the `chat` inference adapter. A `provider_native` capability adapter maps directly to an inference adapter. The capability adapter layer is the new concept; the inference adapter layer already works and should not be disturbed.

### 5.2 Capability source taxonomy

Every capability belongs to one `sourceType`:

- `internal`
  - platform-native tool defined in `mcp-tools.ts`
- `external_mcp`
  - tool discovered from an activated MCP server
- `provider_native`
  - provider-specific built-in action or model-native function path
- `composite`
  - orchestrated capability built from multiple underlying tools

**Edge case — internal tools with external dependencies:** Some platform-native tools are defined in `PLATFORM_TOOLS` (`sourceType: internal`) but delegate to an external service at runtime. For example, `evaluate_page` and `run_ux_test` are internal tool definitions that call browser-use via MCP. These remain `sourceType: internal` because their definition, schema, and governance are owned by the platform. However, their `integrationDependencies[]` must list the browser-use integration so the capability inventory can show them as unavailable when that dependency is unhealthy.

### 5.3 Integration taxonomy

Every integration belongs to one `integrationType`:

- `inference_provider`
- `cli_provider`
- `mcp_service`
- `knowledge_connector`
- `internal_service`

This allows the lifecycle to be standardized without pretending model providers and MCP servers are identical objects.

### 5.4 Skill-capability relationship

This spec does not redesign the skills system, but the relationship between skills and capabilities must be defined to prevent future confusion:

- A **skill** is a procedure or knowledge body that a coworker knows how to execute (defined in `.skill.md` files, stored in `SkillDefinition`)
- A **capability** is a discrete action or information access unit that a coworker can invoke at runtime
- A skill typically **composes** one or more capabilities — the `allowedTools` field in skill frontmatter is effectively a capability grant list
- The unified capability inventory should be queryable by skill: "which capabilities does skill X require?" This enables impact analysis when an integration goes unhealthy

The existing `SkillAssignment` model assigns skills to agents. The existing `DelegationGrant` model assigns capability scopes. These remain separate — skills define what an agent knows how to do; grants define what it is permitted to do. A skill without the required capability grants is inert.

---

## 6. Standardized Integration Lifecycle

Every integration should move through the same lifecycle stages, even if some stages are no-ops for a particular integration type.

### 6.1 Lifecycle stages

Progressive stages — an integration advances through these in order:

1. **Registered**
   - known to the system but not configured

2. **Authenticated**
   - required credentials or trust material are present

3. **Verified**
   - connectivity/auth test succeeded

4. **Discovered**
   - capabilities/models/tools/resources were fetched where applicable

5. **Ready**
   - the integration has at least one usable capability for coworker execution

6. **Healthy**
   - ongoing health checks are passing

Degradation states — an integration can move into these from any stage at or above Verified:

- **Degraded**
  - health checks show partial failure (some capabilities work, others do not), or latency/error rates exceed thresholds
  - the integration remains usable but should score lower in routing and surface warnings in admin
- **Unreachable**
  - connectivity lost entirely; capabilities gated on this integration become unavailable
  - automatic retry with backoff; operator notification after N consecutive failures
- **Suspended**
  - manually disabled by an operator or automatically by policy (e.g., trust revocation, credential expiry)
  - capabilities are hard-gated off until the operator re-enables

### 6.1.1 Governance as a parallel concern

Governance (trust and exposure policy) is **not** a lifecycle stage. It is a cross-cutting concern that applies at every stage from Registered onward:

- An operator can set or change exposure policy on a Registered integration before it is even Authenticated
- A Healthy integration can have its trust policy tightened or revoked at any time
- Governance resolution is checked at runtime alongside the progressive lifecycle state (Section 7.2)

### 6.2 Lifecycle actions

The UI should standardize these actions across integration types:

- `Configure Authentication`
- `Verify Connection`
- `Refresh Catalog`
- `Review Capabilities`
- `Set Exposure Policy`
- `Check Health`
- `View Audit`

### 6.3 Mapping to current confusing actions

Current `Test connection` on LLM providers should be split or renamed:

- **recommended split**
  - `Verify Connection`
  - `Refresh Catalog`

If a split is deferred, rename to:

- `Connect & Prepare`

and explicitly show that it performs:

- auth verification
- discovery
- profile sync

Current `Sync Models & Profiles` should become:

- `Refresh Model Catalog`

Current `Run Eval` should become:

- `Update Routing Scores`

Current `Run Probes` / `Run Full Tests` should become:

- `Health Probes`
- `Behavior Tests`

### 6.4 Auth model must be explicit

Each integration should declare:

- `authMode`
  - `none`
  - `api_key`
  - `oauth_client`
  - `oauth_user`
  - `service_account`
- `credentialOwnerMode`
  - `platform_owned`
  - `admin_owned`
  - `user_owned`
  - `mixed`

This is especially important for:

- Anthropic subscription OAuth vs Anthropic API key
- Codex / ChatGPT OAuth vs API key
- maker-provided vs end-user credentials in future shared integrations

**Phasing note:** Neither `ModelProvider` nor `McpServer` currently stores `authMode` or `credentialOwnerMode` as explicit fields. In Phase 1, these values can be inferred from existing provider config patterns (`providers-registry.json` already distinguishes API key vs OAuth providers). Formalizing them as schema fields is Phase 2 work, after the IA and terminology pass validates the mental model with operators.

---

## 7. Standardized Capability Exposure

### 7.1 Capability contract

All capabilities exposed to coworkers should present the same governance surface:

- description
- schema
- side-effect flag
- proposal/immediate mode
- risk class
- audit class
- grants/capability gating
- route/build-phase gating
- trust source

### 7.2 Capability availability resolution

At runtime, a capability is available only if all are true:

1. source integration is ready and healthy enough
2. user role is authorized
3. agent grants allow it
4. route/build-phase permits it
5. trust policy permits it
6. governance policy permits it (Section 6.1.1)

**Current implementation state:** `getAvailableTools()` in `mcp-tools.ts` already enforces checks 2-4, and partially enforces check 1 for external MCP tools:

- User role: `can(userContext, tool.requiredCapability)`
- Agent grants: `isToolAllowedByGrants(tool.name, agentGrants)` via `AgentToolGrant`
- Mode gating: `options.mode !== "advise" || !tool.sideEffect`
- External access: `options.externalAccessEnabled` gates MCP tool inclusion
- External MCP health gating: `getMcpServerTools()` only includes tools from servers with `status: active` and `healthStatus: healthy`

What is **not yet enforced** at the `getAvailableTools()` level:

- Integration health/readiness (check 1) for internal capabilities with external dependencies and richer degradation states — for example, internal tools that call external services at runtime still need explicit dependency health/readiness evaluation at capability resolution time
- Trust policy (check 5) and governance policy (check 6) — no per-integration trust or exposure policy is evaluated at tool resolution time

These gaps define the Phase 2 work for capability availability.

### 7.3 MCP-specific handling

MCP remains important, but should be framed as:

- one source of external capabilities
- one transport for CLI-delivered tool access
- a protocol that may later expose tools, resources, and prompts

It should **not** be the top-level concept for general AI workforce administration.

---

## 8. Selective Audit Policy

### 8.1 Problem

Current `ToolExecution` is a flat log shape. That is useful early on, but will not scale well if every low-value read, search, list, and probe is retained and surfaced identically to high-value writes and approvals.

### 8.2 Proposed audit classes

Every capability gets one `auditClass`:

#### A. `ledger`

Always retained in full, operator-visible, compliance-grade.

Use for:

- side-effecting writes
- destructive actions
- credential/config changes
- deployment/release actions
- approvals/rejections
- cross-boundary writes to external systems

#### B. `journal`

Retained in detail for a shorter window, grouped in operator UI, roll-up eligible later.

Use for:

- non-destructive external reads
- significant agent reasoning checkpoints
- high-value fetches (for example, loading an external schema or artifact)
- behavior tests and eval runs

#### C. `metrics_only`

Do not retain full payloads by default; aggregate counts/latency/error rate instead.

Use for:

- repetitive read-only tool chatter
- list/search polling
- route warmups
- health pings
- repeated probes inside one test cycle

### 8.3 Audit event shape

Introduce an internal normalized event shape:

- `eventId`
- `eventType`
- `capabilityId`
- `sourceType`
- `integrationId`
- `agentId`
- `userId`
- `threadId`
- `routeContext`
- `riskClass`
- `auditClass`
- `success`
- `startedAt`
- `durationMs`
- `summary`
- `payloadRef` or `payload`

Full payload storage should be conditional by `auditClass`.

#### Migration path from ToolExecution

The current `ToolExecution` model uses `toolName` (string) as its primary identifier. The proposed event shape uses `capabilityId`. The migration should be additive:

1. **Phase 3a:** Add `auditClass` and `capabilityId` columns to `ToolExecution` as nullable fields. Begin writing them on new rows. Existing queries continue to work via `toolName`.
2. **Phase 3b:** Backfill `capabilityId` from `toolName` using a mapping derived from the capability inventory. Tool names that map 1:1 to capabilities (the common case for `PLATFORM_TOOLS`) can be backfilled mechanically. MCP tools use their namespaced name (`serverSlug__toolName`).
3. **Phase 3c:** Migrate UI consumers from `toolName` filtering to `capabilityId` filtering. Only then consider deprecating `toolName` on new writes.

Do not remove `toolName` — it remains useful as a human-readable label even after `capabilityId` becomes the join key.

### 8.4 UI impact

Split audit UX into:

- **Action Ledger**
  - approvals, writes, governance events, destructive actions
- **Capability Journal**
  - meaningful execution history and investigation events
- **Operational Metrics**
  - counts, failure rates, latency, health

This replaces the current muddy overlap between `Action History`, `Authority`, and low-level tool logs.

---

## 9. Information Architecture Proposal

### 9.1 New top-level structure

#### A. AI Workforce

Purpose: who does what, with which models/capabilities

Subsections:

- Overview
- Assignments
- Routing & Calibration
- Build Studio CLI
- Skills

#### B. Tools & Integrations

Purpose: what can be connected, activated, governed, and monitored

Subsections:

- Integration Catalog
- Connected Integrations
- Capability Inventory
- Service Health
- Trust & Exposure Policy

#### C. Audit & Operations

Purpose: what happened, what is running, and what requires attention

Subsections:

- Action Ledger
- Route Log
- Long-running Operations
- Authority & Permissions
- Capability Journal

### 9.2 Where current pages move

| Current | Proposed home | Notes |
| --- | --- | --- |
| Workforce | AI Workforce > Overview | keep |
| Model Assignment | AI Workforce > Assignments | make primary assignment surface |
| Build Studio | AI Workforce > Build Studio CLI | explicitly label as CLI dispatch config |
| Route Log | Audit & Operations > Route Log | keep, fix score normalization |
| Operations | Audit & Operations > Long-running Operations | rename for clarity |
| Action History | Audit & Operations > Action Ledger | narrower and clearer |
| Authority | Audit & Operations > Authority & Permissions | keep, tighten scope |
| Skills | AI Workforce > Skills | not a top-level peer to routing/audit |
| AI External Services — provider registry (Section 1) | AI Workforce > Routing & Calibration | provider cards, sync, model discovery — these are inference routing concerns |
| AI External Services — activated MCP servers (Section 1b) | Tools & Integrations > Connected Integrations | MCP server activation, health, tool listing — these are integration concerns |
| `/platform/services` | Tools & Integrations > Connected Integrations | primary home for external MCP services |
| `/platform/integrations` | Tools & Integrations > Integration Catalog | primary home |

### 9.3 AI-specific surfaces that remain in AI

These stay in AI because they directly affect inference:

- model tiering
- provider/model routing
- model evals
- endpoint behavioral tests
- agent assignment
- Build Studio CLI dispatch

### 9.4 MCP-specific surfaces that move out

These belong in Tools & Integrations:

- browsing integration catalog
- activating MCP services
- testing MCP service health
- tool inventories by external service
- transport-level server configuration

---

## 10. MCP in the New Design

### 10.1 Product framing

MCP is represented in the specification in three roles:

1. **External capability source**
   - activated MCP servers expose external capabilities

2. **CLI tool-delivery transport**
   - platform tools may be delivered to Claude/Codex CLI through MCP

3. **Future context surface**
   - MCP resources/prompts may later become first-class context objects

### 10.2 Phase 1 scope for MCP

Phase 1 standardizes **tools/capabilities only**.

Phase 1 does **not** attempt to fully normalize:

- MCP resources
- MCP prompts
- elicitation UX
- channel/push patterns

These should be acknowledged in the architecture, but deferred from the first UX consolidation pass.

### 10.3 Why this boundary matters

Trying to unify tools, resources, prompts, model routing, auth policy, and selective audit in one first pass would over-expand the epic and blur the user-facing win.

The first win should be:

> a clear, governed, observable capability and integration model

---

## 11. Data Model Direction

This design does not require an immediate full schema rewrite, but it does require a clear canonical direction.

### 11.1 Canonical concept ownership

- `ModelProvider` remains canonical for inference providers
- `McpServer` remains canonical for activated external MCP services
- `McpIntegration` remains canonical for integration catalog entries
- `PlatformCapability` becomes the canonical **inventory metadata anchor** for capability inventory — it already has `capabilityId`, `name`, `description`, `state`, and a `manifest` JSON field that can carry the extended metadata described in Section 5.1.A

### 11.2 Recommended read-model additions

The `PlatformCapability.manifest` JSON field should be enriched in Phase 2 with: `sourceType`, `riskClass`, `auditClass`, `inputSchema`, `outputShape`, `integrationDependencies`, `adapterType`.

A computed read model (`CapabilityInventoryView` or equivalent query layer) should join across:

- `PlatformCapability` (internal capabilities with enriched manifest)
- `McpServerTool` (external MCP capabilities, joined to `McpServer` for integration status)
- `PLATFORM_TOOLS` constant array (runtime tool definitions from `mcp-tools.ts`)

Projected fields:

- `capabilityId`
- `sourceType`
- `integrationId`
- `integrationType`
- `adapterType`
- `displayName`
- `enabled`
- `availabilityStatus`
- `riskClass`
- `auditClass`
- `gating`

This allows the UI to present a unified capability inventory without rewriting underlying provider and MCP tables into one schema. If query performance degrades, frequently-filtered fields (`riskClass`, `auditClass`, `sourceType`) can be promoted from JSON to dedicated columns in a later migration.

This read model should treat runtime tool definitions as authoritative for execution and availability, while `PlatformCapability` provides the normalized inventory/admin layer.

### 11.3 Future refactoring opportunities

- Unify event/audit storage around typed audit classes (Phase 3)
- Reconcile provider readiness vs credential readiness drift
- Revisit whether `ModelProvider` categories should carry MCP-related labels that belong in integration taxonomy instead
- Promote high-query manifest fields to dedicated `PlatformCapability` columns if needed

---

## 12. Rollout Plan

### Phase 1: IA, terminology, and data integrity

- Rename/reframe confusing actions (Test connection, Sync Models, Run Eval, Run Probes)
- Move MCP service management under Tools & Integrations
- Relabel Build Studio as CLI dispatch
- Move Skills under AI Workforce
- Define audit class enum in code (`ledger`, `journal`, `metrics_only`), even if storage remains mostly unchanged initially
- **Fix route log score normalization** — this is a data integrity bug, not a future refactor. The inconsistency exists at three layers:
  - **Writer layer (mixed scoring paths):**
    - Legacy scorer path (`task-router.ts`) computes `fitnessScore` from 0-100 dimension math
    - Contract/V2 path (`pipeline-v2.ts` + `cost-ranking.ts`) writes `rankScore` that is not constrained to a shared 0..1 invariant
    - Persistence paths (`loader.ts`, `task-dispatcher.ts`) write `fitnessScore` without scale metadata
  - **UI layer 1:** `RouteDecisionLog.tsx` treats scores as 0..1 (thresholds at 0.8/0.5, renders `(score * 100).toFixed(0)%`)
  - **UI layer 2:** `RouteDecisionLogClient.tsx` treats scores as 0..100 (thresholds at 70/40, renders raw value)
  - **Storage:** `RouteDecisionLog.fitnessScore` is `Float` with no constraint — live data contains values across both scales and `NaN`
  - **Fix target:** Canonical stored `fitnessScore` should be `0..1`. All score-writer paths (legacy and V2) must normalize before persistence. Both UI components must agree on 0..1 input. Backfill existing rows with scale detection heuristic (values > 1.0 are 0-100 scale; divide by 100)

Scope: ~8 route/page files, 1 data-only migration for score backfill (no additive schema changes), nav component updates (`AiTabNav.tsx`, breadcrumbs, sidebar links) to reflect IA reorganization, audit class enum definition in a shared constants file

### Phase 2: Unified capability inventory and auth formalization

- Enrich `PlatformCapability.manifest` with sourceType, riskClass, auditClass, integrationDependencies
- Add computed `CapabilityInventoryView` query layer that joins `PlatformCapability`, `McpServerTool`, and `PLATFORM_TOOLS`
- Show internal + external capabilities in one searchable inventory
- Expose risk/gating/audit class per capability
- Formalize `authMode` and `credentialOwnerMode` as schema fields on provider and MCP models

Scope: 1 new Prisma view or query module, manifest schema definition, ~3 server actions, 2-3 UI components

### Phase 3: Audit refinement

- Split ledger/journal/metrics UI
- Add `auditClass` field to `ToolExecution` or introduce a new normalized event model
- Reduce full-payload retention for `metrics_only`
- Aggregate probe chatter and repeated read-only cycles

Scope: 1 migration (add auditClass column + index), audit UI refactor across 3 pages

### Phase 4: MCP resources/prompts

- Decide whether resources/prompts should become first-class operator-visible context objects
- Only proceed after Phase 1-3 reduce current conceptual overload

### Dependency map

```text
Phase 1: IA + terminology + score fix
    |           |
    |           +-- (independent) audit class enum definition
    |           +-- (independent) score normalization migration
    |           +-- (sequential) IA rename/move depends on nothing
    |
Phase 2: capability inventory + auth formalization
    |       depends on: Phase 1 IA structure (knows where pages live)
    |       does NOT depend on: Phase 1 score fix
    |
Phase 3: audit refinement
    |       depends on: Phase 1 audit class enum
    |       does NOT depend on: Phase 2
    |
Phase 4: MCP resources/prompts
            depends on: Phase 1-3 reducing conceptual load
```

Phases 2 and 3 can run in parallel once Phase 1 completes.

---

## 13. Risks and Mitigations

### Risk: over-unifying unlike things

Mitigation:

- unify at capability and lifecycle layer
- keep adapters and transport diagnostics separate

### Risk: hiding useful technical detail from advanced operators

Mitigation:

- keep transport/auth/trust details in integration detail screens
- add advanced diagnostics panels rather than promoting them to top-level IA

### Risk: audit signal loss

Mitigation:

- classify by audit class, not by deleting visibility
- retain metrics for everything
- retain full detail for ledger-class events

### Risk: breaking CLI tool-name contracts

MCP tools are exposed to Claude/Codex CLI clients via `mcp-server-tools.ts` using a `serverSlug__toolName` namespacing convention. Platform-native tools are exposed by their `name` field from `PLATFORM_TOOLS`. These names are effectively API contracts — CLI clients cache tool schemas and build tool-call references against them.

Mitigation:

- Do not rename existing tool `name` values as part of the IA reorganization
- The `capabilityId` introduced in the inventory layer is an internal join key, not a replacement for the tool name exposed to clients
- If tool names must change in a future phase, introduce a `legacyNames[]` alias mechanism so existing CLI sessions do not break mid-conversation

### Risk: MCP becomes invisible despite being important

Mitigation:

- keep MCP explicit in Tools & Integrations and Build Studio diagnostics
- describe it as a capability source and transport layer

---

## 14. Decision Summary

1. Standardize **both** integration lifecycle and coworker capability exposure
2. Do **not** standardize around “everything is MCP”
3. Use **capability** as the primary cross-system object
4. Use **integration** as the primary admin object for connection/configuration
5. Keep **adapter/transport** details visible only where operationally needed
6. Introduce **selective audit classes** to prevent low-value chatter from bloating operator UX and storage
7. Move generic MCP management to **Tools & Integrations**
8. Keep model routing, calibration, and CLI dispatch under **AI Workforce**

### 14.1 Reusability and future tenantization awareness

Per the platform's recursive self-improvement principle, the capability and integration model is itself a sellable feature. Customers running their own DPF instance need the same governance surface.

Current-state constraint:

- `PlatformCapability`, `McpServer`, and `ModelProvider` are not currently organization-scoped in the schema, so tenant scoping is **not** a near-term implementation requirement for this epic

Near-term guidance:

- Avoid introducing new assumptions that would make future tenant scoping harder
- Avoid hardcoding capability or integration IDs in ways that would not generalize across deployments
- Design the capability inventory query layer so tenant filtering can be introduced later without a conceptual rewrite

Future direction:

- If and when the platform adopts organization-scoped capability/integration records, the inventory layer defined here should be one of the first read models prepared for that migration

### 14.2 TAK co-evolution

TAK is an evolving spec. This work will likely surface refinements to TAK itself:

- If the audit class taxonomy reveals that TAK's HITL tiers need finer granularity, feed that back as a TAK spec revision
- If the capability-level risk classification shows that risk bands need to be per-capability rather than per-agent-class, propose that change to TAK
- Implementation findings should be captured as TAK refinement candidates in the follow-on plan

---

## 15. Acceptance Criteria

This design is successful when:

1. An operator can answer, from the UI:
   - what this coworker can do
   - what integrations it depends on
   - whether those integrations are healthy
   - which actions are audited and where to find them

2. MCP no longer appears as a confusing peer concept to routing, assignment, and authority for general users

3. Provider/test/sync/eval/probe actions have distinct labels and lifecycle meanings

4. Internal platform tools and external MCP tools appear in one coherent capability inventory

5. Audit views prioritize ledger-grade events while still preserving aggregate operational visibility

6. Build Studio CLI configuration is clearly understood as a special execution path, not just another routing panel

---

## 16. Implementation Notes for Follow-on Plan

The follow-on implementation plan should break work into:

1. IA and terminology pass (rename actions, move pages, relabel Build Studio)
2. Route log score normalization and NaN backfill (data integrity — do not defer)
3. Audit class enum definition in code
4. `PlatformCapability.manifest` enrichment and capability inventory query layer
5. `authMode` / `credentialOwnerMode` schema formalization
6. Audit class support in `ToolExecution` logging/reporting
7. Provider lifecycle cleanup (split Test Connection, rename Sync)
8. Build Studio / MCP diagnostics clarification

The implementation plan should also explicitly decide whether to:

- Merge `Action History` into `Audit & Operations`
- Merge `Authority` and tool-execution log around audit classes
- Create a new integration detail shell shared by provider and MCP service detail pages
- Keep tenantization out of near-term implementation scope, but avoid design choices that block future organization scoping

Each phase should include a TAK compatibility check: does the implementation reveal any TAK spec refinements needed? Capture those as follow-on TAK revision items rather than blocking on them.
