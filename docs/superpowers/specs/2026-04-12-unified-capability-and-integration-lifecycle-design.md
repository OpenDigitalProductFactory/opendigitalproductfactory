# Unified Capability and Integration Lifecycle — Design Spec

| Field | Value |
| ----- | ----- |
| **Epic** | AI Workforce / Platform Integrations |
| **Status** | Review |
| **Created** | 2026-04-12 |
| **Author** | Codex for Mark Bodman |
| **Reviewed by** | Codex (30 revisions), Claude Opus 4.6 (revision 2 + final review + cross-spec analysis), Claude Sonnet 4.6 (gap analysis + revision 3) |
| **Owner** | Mark Bodman (Integrate value stream) |
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
- **Phase 2 inventory metadata anchor** becomes `PlatformCapability`, kept fresh by source-appropriate sync strategies (see Section 11.4)
- **Later phase decision**: decide whether `PlatformCapability` should remain an enriched registry overlay or become the canonical authored source for capability metadata

Until that later decision is made, `PlatformCapability` should not be treated as replacing `PLATFORM_TOOLS` execution metadata. The inventory layer must always defer to the runtime source for execution and availability — it adds classification and admin metadata on top.

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

### 5.1.B capabilityId namespace convention

Every capability must have a stable, namespaced `capabilityId`. Without a convention, Phase 2 implementation will produce ad-hoc IDs across three sources that cannot be joined reliably.

Canonical format: `<namespace>:<identifier>`

| Source | Namespace prefix | Example |
| --- | --- | --- |
| Platform-native tool (`PLATFORM_TOOLS`) | `platform` | `platform:create_backlog_item` |
| External MCP tool (`McpServerTool`) | `mcp` | `mcp:browser-use__browse_act` |
| Provider-native function | `provider` | `provider:openai__code_interpreter` |
| Composite capability | `composite` | `composite:research_and_brief` |

Rules:

- Identifiers within a namespace use snake_case
- MCP tool identifiers use the existing `serverSlug__toolName` convention (double underscore) as the identifier segment, so the full ID is `mcp:serverSlug__toolName`
- `capabilityId` values must not change once assigned — they are join keys for audit records and skill grants
- If an external MCP tool is renamed by its server, assign a new `capabilityId` and add the old one to `legacyIds[]` (see Risk: CLI tool-name contracts, Section 13)
- `PlatformCapability.capabilityId` column is the persistent anchor; runtime sources (`PLATFORM_TOOLS`, `McpServerTool`) are the execution source of truth

**Existing capabilityId values:** The `PlatformCapability` table currently stores arbitrary string identifiers (not the `namespace:identifier` format above). When Phase 2 populates `PlatformCapability` rows for the first time from `PLATFORM_TOOLS`, use the new `platform:toolName` format for all new rows. If any legacy rows exist, migrate them to the new format in the same Phase 2 migration — do not mix formats in the same table.

**`legacyIds[]` storage:** The `PlatformCapability` manifest JSON is the right place to store an array of superseded `capabilityId` values under the key `legacyIds`. Schema column promotion (e.g. `String[] legacyIds`) can be deferred until query patterns prove it is needed.

> **Why:** The `CapabilityInventoryView` (Section 11.2) joins across three heterogeneous sources. Without a namespace convention specified here, three implementers will produce three different ID schemes that will require a painful normalization pass later.

---

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
  - **Status: taxonomy placeholder only.** Composite capabilities are listed here to reserve the namespace and prevent implementers from treating `composite` as synonymous with `internal`. Definition of authoring, ownership, and lifecycle for composite capabilities is deferred to a follow-on spec. Do not implement composite capability creation or inventory display in Phases 1-3. If discovered during implementation that a specific composite capability is needed, raise it as a TAK refinement candidate rather than inventing the rules ad-hoc.

**Edge case — internal tools with external dependencies:** Some platform-native tools are defined in `PLATFORM_TOOLS` (`sourceType: internal`) but delegate to an external service at runtime. For example, `evaluate_page` and `run_ux_test` are internal tool definitions that call browser-use via MCP. These remain `sourceType: internal` because their definition, schema, and governance are owned by the platform. However, their `integrationDependencies[]` must list the browser-use integration so the capability inventory can show them as unavailable when that dependency is unhealthy.

### 5.3 Integration taxonomy

Every integration belongs to one `integrationType`:

- `inference_provider`
- `cli_provider`
- `mcp_service`
- `knowledge_connector`
- `internal_service`

This allows the lifecycle to be standardized without pretending model providers and MCP servers are identical objects.

**`internal_service` and the lifecycle:** Some lifecycle stages are no-ops or have different semantics for internal services. `Verify Connection` for an `internal_service` means a localhost health-check against the service's own health endpoint (e.g. `GET /health`), not an external connectivity test. `Authenticated` is typically a no-op (internal services use ambient platform trust, not external credentials). Implementers should treat these stage adaptations as expected rather than signs that the lifecycle model is wrong — the lifecycle contract is standardized even when specific stages are trivial.

> **Why:** The gap analysis flagged that lifecycle actions written for external integrations (auth, test, credential ownership) do not map cleanly onto internal services. Specifying the adaptation here prevents implementers from either skipping the lifecycle for internal services or inventing incompatible semantics.

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
  - automatic retry with exponential backoff (suggested: 30s, 2m, 10m, 30m, then hourly)
  - operator notification after 3 consecutive failures (see Section 6.1.2 for notification mechanism)
- **Suspended**
  - manually disabled by an operator or automatically by policy (e.g., trust revocation, credential expiry)
  - capabilities are hard-gated off until the operator re-enables

### 6.1.1 State machine: valid transitions

Not all state transitions are valid. The table below defines permitted moves, their triggers, and any guards.

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| `Registered` | `Authenticated` | operator supplies credentials | credentials present and non-empty |
| `Registered` | `Suspended` | operator or policy action | none |
| `Authenticated` | `Verified` | `Verify Connection` succeeds | connectivity test passes |
| `Authenticated` | `Registered` | credentials removed or invalidated | — |
| `Authenticated` | `Suspended` | operator or policy action | none |
| `Verified` | `Discovered` | `Refresh Catalog` succeeds | at least one capability or model returned |
| `Verified` | `Authenticated` | `Verify Connection` fails | retried and still failing |
| `Verified` | `Suspended` | operator or policy action | none |
| `Discovered` | `Ready` | capability review passes; usable capability confirmed | at least one capability passes governance checks |
| `Discovered` | `Verified` | catalog refresh fails or returns empty | — |
| `Discovered` | `Suspended` | operator or policy action | none |
| `Ready` | `Healthy` | health check passes after Ready | health check passes (see Section 6.1.4 for scheduling) |
| `Ready` | `Degraded` | partial health failure | some capabilities failing, others passing |
| `Ready` | `Unreachable` | connectivity lost entirely | all health checks failing |
| `Ready` | `Suspended` | operator or policy action | none |
| `Healthy` | `Degraded` | partial health failure | — |
| `Healthy` | `Unreachable` | full connectivity loss | — |
| `Healthy` | `Suspended` | operator or policy action | none |
| `Degraded` | `Healthy` | health checks recover | all capabilities passing again |
| `Degraded` | `Unreachable` | full connectivity loss | — |
| `Degraded` | `Suspended` | operator or policy action | none |
| `Unreachable` | `Verified` | retry succeeds (connectivity restored) | connection test passes on retry |
| `Unreachable` | `Suspended` | operator or policy action | none |
| `Suspended` | `Authenticated` | operator re-enables (credentials still valid) | credentials present |
| `Suspended` | `Registered` | operator re-enables (credentials absent or expired) | — |

**Pre-Ready transition failures:** If a lifecycle action fails mid-transition (e.g. `Verify Connection` times out), the integration regresses to the last stable state, not to `Registered`. Failed transitions should annotate the current state with a `lastError` field (timestamp + message) rather than creating a new intermediate state. The operator sees the integration at its last stable state with a visible error banner.

> **Why:** Without explicit transitions, implementers invent different rules for "what happens when Verify fails." Regression to the last stable state (rather than all the way back to Registered) preserves already-validated progress and gives operators a meaningful starting point for diagnosis.

### 6.1.2 Operator notification mechanism

When an integration enters `Unreachable` after 3 consecutive health-check failures, the platform must surface a notification. Delivery targets in priority order for Phase 1:

1. **In-app alert** — a persistent banner in the Tools & Integrations admin surface showing the affected integration, failure count, and last error
2. **Admin dashboard badge** — a count badge on the Tools & Integrations nav item visible from all admin pages

Out of scope for Phase 1 (deferred):

- Email notification
- Webhook/outbound push
- Configurable N threshold per integration

> **Why:** The original spec said "operator notification after N consecutive failures" without defining the mechanism or N. Deferring notification entirely risks operators not discovering unhealthy integrations until a coworker fails visibly. In-app-only is the minimum viable surface that doesn't require email infrastructure.

### 6.1.3 Governance as a parallel concern

Governance (trust and exposure policy) is **not** a lifecycle stage. It is a cross-cutting concern that applies at every stage from Registered onward:

- An operator can set or change exposure policy on a Registered integration before it is even Authenticated
- A Healthy integration can have its trust policy tightened or revoked at any time
- Governance resolution is checked at runtime alongside the progressive lifecycle state (Section 7.2)

> **Why:** Governance is a parallel concern, not a lifecycle stage. Making this explicit prevents implementers from treating policy enforcement as something that only applies after an integration reaches Ready.

### 6.1.4 Health check scheduling

**Current state:** Health checks are **on-demand only**. `checkMcpServerHealth` is called at activation time and when the operator triggers `Check Health` manually. There is no scheduled background polling job for integration health.

**Phase 1:** On-demand health checks remain the only trigger. No change needed.

**Phase 2 decision:** Decide whether to add a scheduled health-check job (e.g. via the existing `ScheduledJob` system). The existing `mcp-catalog-sync` job pattern is the model. Suggested default interval: **15 minutes** for active integrations; **1 hour** for integrations in `Registered` or `Authenticated` state (they can't degrade in a meaningful way yet). Degraded or Unreachable integrations should retry more aggressively (30s backoff per Section 6.1).

Until scheduled polling exists, the state machine transitions from `Healthy → Degraded` and `Healthy → Unreachable` can only be triggered by: (a) an on-demand `Check Health` action, or (b) a failed tool execution that surfaces a connectivity error. Implementers should treat (b) as a valid degradation trigger and update `healthStatus` on tool execution failure.

> **Why:** The state machine references "health check interval elapsed" which implies scheduled polling. That infrastructure does not exist today. Without this note, a Phase 2 implementer will either build scheduled polling (scope creep) or leave the `Ready → Healthy` transition unreachable (broken lifecycle).

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

**`user_owned` credential expiry and lifecycle state:** When `credentialOwnerMode` is `user_owned`, token expiry affects individual users, not the integration as a whole. The integration-level lifecycle state (Healthy/Degraded/Unreachable) should not change when one user's token expires — the integration remains healthy for other users. Instead, per-user credential state is a separate concern:

- A coworker invocation that requires a `user_owned` credential should fail gracefully with an actionable error directing the user to re-authenticate, not trigger an integration-level degradation
- The capability availability check (Section 7.2) must be extended in Phase 2 to evaluate per-user credential validity as a separate gate alongside the integration-level health check
- Per-user token refresh and re-auth flows are out of scope for this spec but must be accounted for in the Phase 2 authMode formalization work

> **Why:** The gap analysis identified that the lifecycle model only describes platform-level credential states. User-owned OAuth tokens expire independently per user and cannot map onto a shared integration lifecycle state without producing misleading operator signals (e.g., marking a healthy integration as Degraded because one user's token expired).

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

**Retention defaults (all three classes):**

| Class | Full payload | Retention window |
| --- | --- | --- |
| `ledger` | Yes | Indefinite |
| `journal` | Yes | 30 days (rolling) |
| `metrics_only` | No | Aggregates indefinite; payloads not stored |

These defaults should be operator-configurable in a later phase. For Phase 3 implementation, treat 30 days as the hardcoded default for `journal`.

> **Why:** "Shorter window" is not an implementable spec. Without a concrete default, implementers will choose different values, creating inconsistent operator expectations across deployments. 30 days balances investigation utility (most incidents surface within a week) against storage cost.

#### B. `journal`

Retained in detail for a rolling 30-day window, grouped in operator UI, roll-up eligible after window expires.

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
2. **Phase 3b:** Backfill `capabilityId` from `toolName` using a mapping derived from the capability inventory. Tool names that map 1:1 to capabilities (the common case for `PLATFORM_TOOLS`) backfill as `platform:toolName`. MCP tools backfill as `mcp:serverSlug__toolName`, matching the `capabilityId` namespace convention in Section 5.1.B.
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

**Integration Catalog — sourcing:** The catalog is platform-curated, not dynamically discovered from an external registry. In Phase 1, the catalog is a static list of known integration types supported by the platform (e.g., GitHub, Jira, Anthropic, Codex, browser-use). Operators browse the catalog to activate an integration; activation moves the entry into Connected Integrations with a lifecycle state of `Registered`. Dynamic catalog discovery from external MCP registries or marketplaces is a Phase 4+ consideration and is not in scope here.

> **Why:** The gap analysis noted that the distinction between catalog (what could be connected) and connected integrations (what is connected) was undefined as to sourcing. A dynamically discovered catalog implies infrastructure (registry polling, trust vetting) that is out of scope for this epic. Clarifying it as platform-curated unblocks Phase 1 implementation without foreclosing future extensibility.

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

### 11.4 Capability inventory maintenance over time

The `PlatformCapability` table is a living registry, not a snapshot. Different capability source types change at different rates and for different reasons. Each needs its own sync strategy.

#### A. Internal tools (`sourceType: internal`, source: `PLATFORM_TOOLS`)

These change only when code deploys. The sync script (`sync-capabilities.ts`) runs as part of `portal-init` on every deploy — the same lifecycle as `seed-skills.ts` and `seed-prompt-templates.ts`. It is idempotent and safe to re-run.

**On new tool added** (developer adds entry to `PLATFORM_TOOLS`):

- Next deploy runs `sync-capabilities.ts`
- Upsert creates a new `PlatformCapability` row with `state: active`
- New `capabilityId` is assigned using `platform:toolName` convention
- No manual action needed

**On tool removed** (developer removes entry from `PLATFORM_TOOLS`):

- Sync script detects the tool is absent from the current `PLATFORM_TOOLS` array
- Sets `state: deprecated` on the existing row — does **not** delete it
- Audit records, skill grants, and delegation records that reference this `capabilityId` remain intact
- The capability inventory surfaces deprecated tools in a separate "Removed" section for operator awareness
- Hard deletion may be done manually by an operator after confirming no active grants reference it

**On tool schema or metadata changed** (developer updates `inputSchema`, `description`, `riskClass`, etc.):

- Sync script computes a hash of the tool's definition fields and compares to the stored `manifest.definitionHash`
- If hash differs, update the manifest and set `manifest.schemaChangedAt` timestamp
- Surface a notice in the capability inventory detail view: "Definition updated on [date]"
- Skills that reference this tool are **not** automatically updated — operator review is required if the schema change is breaking

#### B. External MCP tools (`sourceType: external_mcp`, source: `McpServerTool`)

These change when the external server changes its tool definitions. Sync is already handled by `discoverMcpServerTools()` triggered at activation and on `Refresh Catalog`. The existing `schemaChangedAt` flag mechanism (Section 13, Risk: external MCP tool schema changes) applies here.

The `CapabilityInventoryView` joins against `McpServerTool` directly, so no additional `PlatformCapability` rows are needed for external MCP tools. If classification metadata (riskClass, auditClass, integrationDependencies) is needed for a specific external tool, it can be added as an operator-authored annotation on the `McpServerTool` row rather than mirroring it into `PlatformCapability`.

#### C. Inference providers and models (`sourceType: provider_native`, source: `ModelProvider` / `ModelProfile`)

These change when a provider adds new models or model variants. Sync is already handled by `syncProviderRegistry()` reading `providers-registry.json` on schedule and on-demand via `Refresh Model Catalog`. No new sync infrastructure is needed.

Provider-native capabilities appear in the `CapabilityInventoryView` as a join against `ModelProvider` and `ModelProfile`. Changes to the provider registry propagate automatically on the next sync.

#### D. Composite capabilities (`sourceType: composite`)

Composite capability definition is deferred from Phases 1-3 (see Section 5.2). When composite capability authoring is introduced, it will require its own authoring and versioning workflow that is distinct from the deploy-time sync patterns above. This is a future spec concern.

#### E. Sync failure handling

If `sync-capabilities.ts` fails during `portal-init`:

- Log the error with full detail to container stdout (captured by the platform log pipeline)
- Do **not** fail the entire `portal-init` — capability inventory metadata is admin-facing, not runtime-critical
- The platform continues to operate using existing `PlatformCapability` rows and the runtime sources (`PLATFORM_TOOLS`, `McpServerTool`)
- Surface a warning badge in the Capability Inventory admin page if the last sync timestamp is stale (older than 2× the expected deploy frequency)

> **Why:** `seed-skills.ts` uses the same "warn but don't fail" approach for the same reason — a metadata sync failure should not take the platform down.

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
  - **Fix target:** Canonical stored `fitnessScore` should be `0..1`. All score-writer paths (legacy and V2) must normalize before persistence. Both UI components must agree on 0..1 input. Backfill existing rows using the following rules applied in order:
    1. `NaN` → `NULL` (unknown score; do not guess)
    2. `value > 1.0` → `value / 100` (0-100 scale; divide to normalize)
    3. `value >= 0.0 AND value <= 1.0` → no transform (already normalized; the ambiguity is accepted — a score of e.g. `0.5` is indistinguishable between scales, so we treat the [0,1] range as already correct)
    4. `value < 0.0` → `NULL` (corrupt; do not propagate)
  - UI components must handle `NULL` fitnessScore gracefully (render as "—" or "unscored", not as 0%)

> **Why:** The original backfill heuristic ("values > 1.0 divide by 100") left two cases unspecified: `NaN` rows (present in live data) and ambiguous values in the [0,1] range that could be either scale. Without explicit rules, the migration author will make ad-hoc choices that differ from what the UI expects.

- **URL redirect policy for IA moves:** Pages relocated by the IA reorganization must implement HTTP 301 redirects from old URLs to new URLs. Old routes must not return 404. Rationale: operators bookmark admin pages; broken bookmarks erode trust in the admin surface. Redirects can be removed after one major release cycle.

Scope: ~8 route/page files, 1 data-only migration for score backfill (no additive schema changes), nav component updates (`AiTabNav.tsx`, breadcrumbs, sidebar links) to reflect IA reorganization, audit class enum definition in a shared constants file, redirect rules for relocated pages

### Phase 2: Unified capability inventory and auth formalization

- **Implement `sync-capabilities.ts`** — the `PlatformCapability` table is currently empty. Phase 2 must introduce a sync script (same pattern as `seed-skills.ts`) that keeps `PlatformCapability` rows current as `PLATFORM_TOOLS` evolves. See Section 11.4 for the full sync strategy by source type. This is not a one-time seed — it is a recurring deploy-time sync for internal tools, plus hooks into existing provider and MCP refresh flows for other source types.
- Enrich `PlatformCapability.manifest` with `sourceType`, `riskClass`, `auditClass`, `integrationDependencies`, and a `definitionHash` for drift detection
- Add computed `CapabilityInventoryView` query layer that joins `PlatformCapability`, `McpServerTool`, and `PLATFORM_TOOLS`
- Show internal + external capabilities in one searchable inventory
- Expose risk/gating/audit class per capability
- Formalize `authMode` and `credentialOwnerMode` as schema fields on `ModelProvider` and `McpServer`
- Implement skill→capability queryability: given a `SkillDefinition.allowedTools` list, resolve the corresponding `capabilityId` values so the inventory can show "skills that require this capability"

Scope: 1 sync script (`sync-capabilities.ts`, ~50 initial rows from PLATFORM_TOOLS), manifest schema definition (`zod` or JSON Schema), 1 migration (authMode/credentialOwnerMode columns + `definitionHash` on PlatformCapability), ~3 server actions, 2-3 UI components

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
- If tool names must change in a future phase, introduce a `legacyIds[]` field (see Section 5.1.B) so audit records and grants remain joinable; the CLI-facing tool name contract is separate from the internal `capabilityId` key

### Risk: external MCP tool schema changes break existing skill and grant references

When `Refresh Catalog` runs and an external MCP server has changed its tool schema (added, removed, or renamed tools), existing `SkillAssignment` entries and `DelegationGrant` records that reference the old tool names may silently become stale.

Mitigation:

- On `Refresh Catalog`, diff the incoming tool list against `McpServerTool` rows for that server
- Tools that have disappeared: mark their `McpServerTool` row as `status: removed` rather than deleting it; keep it visible in the capability inventory with an unavailable state so admins can see what broke
- Tools that are new: add rows normally with `status: active`
- Tools that have changed schema (`inputSchema` or `outputShape`): update the row and flag it with a `schemaChangedAt` timestamp; surface a warning in the capability inventory detail view
- Do not automatically update `SkillAssignment.allowedTools` — require operator review when a referenced tool's schema changes
- The `legacyIds[]` mechanism defined in Section 5.1.B applies here: if a tool is renamed, the old `capabilityId` must be preserved as a legacy reference so audit records and grants remain joinable

> **Why:** The spec correctly protects platform-side tool names from being renamed (Risk: CLI tool-name contracts). The inverse — external tools changing their own contracts — is an equal risk that was not addressed in the original draft. Silent schema drift causes coworker failures that are hard to diagnose without this flag.

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

7. A coworker interacting with a Degraded or Unreachable integration receives a meaningful, actionable error message — not a silent failure, an opaque timeout, or a raw exception. The error must tell the user what broke and what they (or an operator) can do about it.

8. An operator who bookmarks an admin page before the IA reorganization can still reach that page after Phase 1 ships (via redirect, not 404).

> **Why criteria 7 and 8 were added:** The original acceptance criteria were entirely operator-centric. Criterion 7 closes the coworker-facing half of the capability availability chain — a system that governs capabilities well but fails opaquely at the coworker layer has not met its goal. Criterion 8 is a concrete test for the URL redirect policy added to Phase 1; without an acceptance criterion it would be treated as optional.

---

## 16. Cross-Spec Dependencies

This spec does not exist in isolation. It conflicts with three existing specs that require explicit reconciliation before Phase 1 work begins, and augments or is augmented by twelve others. The Build Studio and hive mind correlation is addressed separately.

### 17.1 Conflicting specs — requires resolution before implementation

#### A. `2026-04-11-platform-mcp-tool-server-design.md`

That spec proposes a DPF-hosted MCP server endpoint (`/api/mcp`) that exposes all platform tools to CLI clients (Claude CLI, Codex). Its framing positions MCP as the canonical delivery pillar for tools to CLI-agentic providers.

**Conflict:** The unified capability spec classifies platform tools as `sourceType: internal` and explicitly positions MCP as *one adapter layer among several* — not the primary delivery channel. The platform MCP tool server is the `cli_mcp_delivery` adapter in Section 4.2, not a replacement for the `internal` sourceType classification.

**Conflict point 2:** The platform MCP server exposes tools using their original `name` from `PLATFORM_TOOLS`. The unified capability spec assigns each tool a `capabilityId` (`platform:toolName`) as an internal inventory key. These are different identifiers for the same tool. The CLI-facing contract is the `name`; the `capabilityId` is the internal join key. Section 13 (Risk: CLI tool-name contracts) covers this, but the two specs must be reconciled to make the boundary explicit.

**Resolution:** Treat the platform MCP server as the execution-layer implementation of the `cli_mcp_delivery` adapter. The `capabilityId` is the inventory anchor; the `PLATFORM_TOOLS` name is the stable CLI contract. The MCP server spec does not change `sourceType` classification — platform tools remain `internal` regardless of how they are delivered to a client.

#### B. `2026-03-16-unified-mcp-coworker-design.md`

That spec establishes "Workforce = MCP Registry" as a design principle: all AI resources — local models, cloud models, external services — treated as MCP endpoints in one unified registry.

**Conflict:** This spec explicitly rejects that model. Non-goal 1 (Section 2.2) says "Replace all provider adapters with MCP." Non-goal 2 says "Force every internal platform capability to be implemented as an MCP server." The unified capability model keeps separate registries (`ModelProvider`, `McpServer`, `PlatformCapability`) and unifies them only at the product/capability layer via the `CapabilityInventoryView`.

**Status note:** Portions of the 2026-03-16 spec have already been superseded. The `2026-03-20-mcp-activation-and-services-surface-design.md` spec explicitly decoupled `ModelProvider` (LLM-only) from `McpServer` (MCP services only). The unified capability spec aligns with that decoupling. The "Workforce = MCP Registry" mental model should be treated as superseded by the differentiated registry approach.

#### C. `2026-03-20-mcp-activation-and-services-surface-design.md` (live implementation)

That spec designed and implemented the External Services admin surface — the current live UI at `/platform/services`. It established the `McpServer` schema, the two-track design (Catalog Activation Bridge + External Services Admin Surface), and the integration/health status UI. Its predecessor (`2026-03-16-external-services-mcp-surface-design.md`) is explicitly superseded by it.

**Conflict:** The unified capability spec proposes moving the external services surface out of the current AI nav into a new `Tools & Integrations` section. The data model from this spec (`McpServer`, `McpServerTool`) is correctly aligned and does not need to change — only the navigation home and URL change.

**Resolution:** The Phase 1 IA work must reconcile the live URL structure from this spec with the proposed IA reorganization. The URL redirect policy in Section 12 (Phase 1) covers the operator-facing impact. Implementers should treat this spec as the authoritative reference for `McpServer` schema semantics, activation lifecycle, and health states — those do not change.

### 17.2 Augmenting specs

These specs extend this design or are extended by it. No conflict exists, but implementation teams should read them together with this spec.

| Spec | Relationship |
| --- | --- |
| `2026-04-02-ai-workforce-consolidation-design.md` | Defines `AgentCapabilityClass` and single canonical agent ID (`AGT-xxx`). The `riskClass` and `grantScope` alignment targets in Section 5.1.A depend on this consolidation. The "two authorization models" problem it identifies (flat `tool_grants` vs `AgentCapabilityClass` riskBand) must be resolved for the capability governance layer to work cleanly. |
| `2026-04-08-build-studio-config-design.md` | Defines Build Studio CLI dispatch config tab (already implemented at `/platform/ai/build-studio`). The Phase 1 IA reorganization must update this tab's navigation position. Treat this spec as the source of truth for CLI dispatch config content; this spec governs where it lives in the IA. |
| `2026-04-05-provider-reconciliation-automation-design.md` | Defines automated provider reconciliation loop (connect → discover → profile → sync → routing repair). This IS the sync strategy for `sourceType: provider_native` described in Section 11.4.C. Phase 2 should treat this reconciliation loop as the authoritative sync mechanism for provider-native capabilities in the `CapabilityInventoryView`. |
| `2026-03-16-agent-action-history-design.md` | Establishes Action History at `/platform/ai/history`. The unified capability spec renames this to "Action Ledger" under `Audit & Operations`. HTTP 301 redirect from old URL required in Phase 1 per the URL redirect policy. |
| `2026-03-20-execution-adapter-framework-design.md` | Defines the inference adapter registry (`execution-adapter-registry.ts`). Section 5.1.A names this as the "inference adapters" layer orthogonal to "capability adapters." This spec is the authoritative description of the inference adapter layer — do not conflate the two. |
| `2026-04-01-platform-operational-health-monitoring-design.md` | Defines the Prometheus/Grafana operational health layer and `ScheduledJob` patterns. The Phase 2 decision point for scheduled health polling (Section 6.1.4) should use this spec as the reference implementation when introducing background health polling for integrations. |
| `2026-03-20-capability-detection-and-routing-design.md` | Defines provider-level capability detection (`codeExecution`, `webSearch`, `computerUse`). These detected provider-native capabilities are exactly the `sourceType: provider_native` entries in the `CapabilityInventoryView`. Phase 2 inventory population should use this spec's capability detection output for provider-native rows. |
| `2026-04-02-ai-provider-agent-operational-monitoring-design.md` | Defines AI provider health monitoring and health state reporting. The `Degraded` / `Unreachable` states in Section 6.1 of this spec should align with health state transitions defined there. |
| `2026-03-19-mcp-integrations-catalog-design.md` | Defines the MCP integration catalog (already implemented). Section 9.1.B notes the catalog is platform-curated, not dynamically discovered. This spec is the authoritative description of how the catalog is maintained; do not introduce a conflicting catalog sourcing model. |
| `2026-03-13-unified-identity-access-agent-governance-design.md` | Identity and access governance. The TAK alignment targets (Section 5.1.A) and capability availability resolution (Section 7.2) depend on `can()`, `AgentToolGrant`, and `DelegationGrant`. This spec is the authoritative reference for those mechanisms. |
| `2026-03-18-ai-routing-and-profiling-design.md` | Routing profiles and fitness scoring. The fitnessScore normalization bug in Section 12 (Phase 1) traces to the scoring computation in this spec's routing pipeline. The Phase 1 fix must reconcile scoring conventions between this spec and both UI components. |
| `2026-04-06-ideate-conversational-gate-design.md` | Build Studio ideate phase conversational gate. See Section 17.3. |

### 17.3 Build Studio and hive mind correlation

**Current Build Studio tool selection** uses `getAvailableTools()` at `build-orchestrator.ts:426`, filtered by the `buildPhases` property per tool. This is already a form of capability-phase gating, but it operates directly on `PLATFORM_TOOLS` — it has no visibility into `PlatformCapability`, integration health, or external MCP tool availability. New tools are invisible to Build Studio until the next deployment.

`sync-capabilities.ts` (Phase 2) will close the deploy-time gap for internal tools. It does not help with runtime integration health.

**The ideate conversational gate** (`2026-04-06-ideate-conversational-gate-design.md`) is not capability-aware. It performs a lightweight intent check before launching the research pipeline, but it does not query whether the integrations or capabilities that the research pipeline requires are actually healthy. If a required integration is unhealthy, the research pipeline launches, runs for up to 300 seconds, and fails mid-way.

**Phase 2+ enhancement opportunity (not in scope for Phases 1-3):** Once the `CapabilityInventoryView` exists, the ideate gate could query it before starting the research pipeline to surface "integration X is not configured" or "capability Y is unavailable" as a pre-build constraint check. This would let the gate offer a specific, actionable message ("this feature requires the GitHub integration — configure it first") instead of launching a failing pipeline. This enhancement should be captured as a follow-on spec when Phase 2 capability inventory work completes.

**Hive mind flywheel** (`2026-04-05-continuous-improvement-flywheel-design.md`) flows through `ImprovementSignal → ImprovementProposal → backlog items`. It does not involve tool or capability discovery — improvement signals come from conversational friction, build quality outcomes, and operator feedback. Knowledge is indexed separately in Qdrant. There is no direct correlation between the hive mind flywheel and the capability inventory introduced by this spec. They are complementary but orthogonal: the flywheel surfaces what to improve; the capability inventory surfaces what is available to do the work.

---

## 17. Implementation Notes for Follow-on Plan

**Implementation briefs:**

- Phase 1: `docs/superpowers/specs/2026-04-12-unified-capability-phase1-implementation.md` — IA, terminology, score fix, audit enum
- Phase 2: `docs/superpowers/specs/2026-04-12-unified-capability-phase2-implementation.md` — capability inventory, auth formalization
- Phase 3: TBD (audit refinement — implement after Phase 2 ships)
- Phase 4: TBD (MCP resources/prompts — deferred)

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
