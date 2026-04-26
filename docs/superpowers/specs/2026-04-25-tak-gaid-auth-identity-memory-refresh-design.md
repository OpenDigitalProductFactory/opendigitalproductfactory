# TAK / GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment

| Field | Value |
|-------|-------|
| **Status** | Draft for review |
| **Created** | 2026-04-25 |
| **Author** | Claude Opus 4.7 + Mark Bodman |
| **Backlog Epic** | `EP-TAK-3F9A21` — TAK/GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment |
| **Defines** | `BI-TAK-9C1E02` — Research and spec the TAK/GAID refresh for DPF auth, identity, and memory |
| **Related Standards** | [`TAK`](../../architecture/trusted-ai-kernel.md), [`GAID`](../../architecture/GAID.md) |
| **Sibling Specs (do not duplicate)** | [Standards-family meta-spec (2026-04-18)](2026-04-18-tak-gaid-standards-family-design.md), [Enterprise auth, directory, federation (2026-04-22)](2026-04-22-enterprise-auth-directory-federation-design.md), [A2A-aligned coworker runtime (2026-04-23)](2026-04-23-a2a-aligned-coworker-runtime-design.md) |
| **Out of Scope (separate thread)** | [Governed MCP backlog-surface (2026-04-25)](2026-04-25-governed-mcp-backlog-surface-design.md) |

## Purpose

`TAK` and `GAID` were strengthened on 2026-04-23 / 2026-04-24 with non-normative pseudocode for runtime trust, governed memory, audit, transparency, AIDoc resolution, authorization-class mapping, MCP projection, and receipt issuance. The standards-family meta-spec (2026-04-18) called explicitly for a DPF conformance assessment as the first practical proving ground.

In parallel, DPF landed an enterprise auth foundation on 2026-04-23 (PR #200) that introduced a real `Principal` / `PrincipalAlias` substrate, principal-linking helpers, and a private-namespace GAID minter for agents. That changed the picture materially: the alignment problem is no longer "DPF has no GAID surface", it is "DPF has the start of a GAID surface; align the rest of the stack to it without duplicating the federation/runtime work that other specs already own."

This spec produces that alignment. It treats:

- **Auth** as the entry/control layer (workforce + customer NextAuth, JWT, OAuth)
- **Principal + private GAID** as the enduring subject layer (humans, customers, agents, services)
- **Local runtime authorization** (capability × tool grant intersection, HITL, proposals) as execution truth
- **GAID authorization classes** as the portable declaration layer (what the agent is *designed* to request)
- **TAK runtime governance** as the policy and oversight layer that enforces behavior at action time
- **Governed memory** as a policy-classed, freshness-aware, effectiveness-measured surface — not "best effort"

It explicitly does *not* re-design the federation edge (authentik, LDAP, SCIM) — that lives in [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md). It does not re-design the task envelope — that lives in [2026-04-23](2026-04-23-a2a-aligned-coworker-runtime-design.md). It does not propose the new MCP backlog tool catalog — that lives in [2026-04-25 governed-mcp-backlog-surface](2026-04-25-governed-mcp-backlog-surface-design.md).

What it does: it makes explicit, in repo-grounded terms, *what TAK and GAID actually require from these substrates after the recent identity changes*, so the four sibling backlog items (`BI-GAID-8D72B4`, `BI-MEM-5A41C7`, `BI-MCP-7E53D1`, `BI-OBS-4B63F2`) can be implemented coherently rather than as drift.

## Scope

In scope:

- Current-state assessment of DPF auth, principal identity, agent registry, memory, and audit surfaces *as they actually exist in code on 2026-04-25*
- Target-state mapping between workforce/customer auth, principal identity, `GAID-Private`, internal `AIDoc`, portable authorization classes, TAK runtime policy, and HITL posture
- A governed memory model with explicit classes, retention rules, freshness rules, and effectiveness checks
- A clear separation between governed runtime memory, user/team knowledge vaults, and primary system-of-record data
- An applicability review of "open brain" / personal-wiki / OpenMemory / memory-block / archival-memory style approaches, and a recommendation about where each fits in DPF
- Protocol-facing implications for MCP/HTTP identity, auth metadata, and receipts (referencing MCP 2025-11-25 spec direction without re-spec'ing it)
- Supervisor/operator observability requirements for proving conformance in live runtime
- A recommended execution order across the seeded backlog items

Out of scope:

- Public `GAID-Public` issuance, transparency logs, or external verifier infrastructure (deferred per 2026-04-23 A2A spec § *What Should Wait*)
- The authentik integration mechanics (owned by [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md))
- The A2A task envelope itself (owned by [2026-04-23](2026-04-23-a2a-aligned-coworker-runtime-design.md))
- The MCP backlog tool catalog (owned by [2026-04-25 governed-mcp-backlog-surface](2026-04-25-governed-mcp-backlog-surface-design.md))
- Cryptographic signing of receipts beyond design intent — phase-1 of `BI-OBS-4B63F2` should land structured receipts before adding signature material

## Live Runtime Baseline

Snapshot from `dpf-postgres-1` on 2026-04-25:

| Table | Rows | Meaning |
|-------|------|---------|
| `Principal` | 67 | Identity spine is live, populated for humans + agents |
| `PrincipalAlias` | 72 | Alias substrate is live and already carries `gaid` aliases for agents |
| `Agent` | 68 | Agent inventory matches expected install scale |
| `AgentToolGrant` | 354 | Grant intersection substrate is exercised in production |
| `AgentThread` | 217 | Coworker conversations active |
| `ToolExecution` | 91 | Tool audit substrate live |
| `TaskRun` | 14 | Task substrate exists but is not yet canonical (per A2A spec § *Live DB Snapshot*) |
| `UserFact` | 6 | Structured user-fact memory in use, sparse |
| `AgentActionProposal` | 0 | Proposal flow defined but not yet exercised on this install |
| `AuthorizationDecisionLog` | 2 | Decision logging just turning on |
| `KnowledgeArticle` | 0 | Knowledge layer schema present but unpopulated |
| `ComplianceAuditLog` | 3 | Compliance audit log lightly used |

The numbers above are not metrics targets. They are evidence that the *substrates* exist for principal, alias, grant, execution, thread, and task — what is missing is the *policy layer that ties them to the standards*.

## Layered Model

The standards-alignment problem becomes tractable once the layers are named and kept distinct.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 5  TAK runtime governance                                           │
│           policy decisions, HITL gating, fabrication mitigation,           │
│           memory revalidation gates, audit + receipt emission              │
│           (apps/web/lib/tak/agentic-loop.ts, mcp-tools.ts, agent-grants)   │
├────────────────────────────────────────────────────────────────────────────┤
│ Layer 4  GAID portable authorization classes                              │
│           observe / analyze / create / update / approve / execute /        │
│           delegate / administer / cross-boundary                           │
│           — declared, carried in receipts, projected over MCP/LDAP/SCIM    │
├────────────────────────────────────────────────────────────────────────────┤
│ Layer 3  Local runtime authorization (execution truth)                    │
│           PERMISSIONS × AgentToolGrant ∩ route context ∩ object scope      │
│           (govern/permissions.ts, tak/agent-grants.ts)                     │
├────────────────────────────────────────────────────────────────────────────┤
│ Layer 2  Principal + private GAID (enduring subject)                      │
│           Principal + PrincipalAlias including gaid:priv:dpf.internal:…    │
│           AIDoc projection (model_binding, tool_surface, badges, etc.)     │
│           (lib/identity/principal-linking.ts, schema.prisma:190-212)       │
├────────────────────────────────────────────────────────────────────────────┤
│ Layer 1  Auth / entry / control                                           │
│           NextAuth (workforce + customer credentials, Google, Apple),      │
│           JWT for API, future OIDC via authentik edge                      │
│           (apps/web/lib/govern/auth.ts, api/v1/auth/login/route.ts)        │
└────────────────────────────────────────────────────────────────────────────┘
```

Three rules govern interaction between layers:

- **Authority does not flow upward.** A successful auth (Layer 1) does not entitle action; it only identifies the subject.
- **The identifier (Layer 2) is durable; everything above it can change without minting a new principal.** Model swap, prompt change, tool-grant update — all are operating-state changes under the same `gaid:priv:…`.
- **Local runtime authorization (Layer 3) is execution truth.** Layer 4 portable classes are *declarations* — TAK MUST NOT treat them as proof of present authorization. This mirrors `GAID §9.3`.

This layering is the integrating frame for the rest of this spec.

## Current-State Assessment

This section is descriptive — it reports what exists in code on 2026-04-25, not what is desired. Each subsection ends with the standards anchor that the surface aligns or fails to align with.

### 4.1 Workforce and customer authentication (Layer 1)

| Surface | File | Notes |
|---------|------|-------|
| NextAuth core | [apps/web/lib/govern/auth.ts:75-288](../../../apps/web/lib/govern/auth.ts#L75-L288) | JWT session strategy; port-scoped cookie isolation between portal and sandbox |
| Workforce credentials | [apps/web/lib/govern/auth.ts:110-147](../../../apps/web/lib/govern/auth.ts#L110-L147) | Email + bcrypt against `User.passwordHash` |
| Customer credentials | [apps/web/lib/govern/auth.ts:148-182](../../../apps/web/lib/govern/auth.ts#L148-L182) | Email + bcrypt against `CustomerContact.passwordHash` |
| Google / Apple OAuth | [apps/web/lib/govern/auth.ts:186-260](../../../apps/web/lib/govern/auth.ts#L186-L260) | Customer-side social only |
| API JWT | [apps/web/api/v1/auth/login/route.ts:1-90](../../../apps/web/api/v1/auth/login/route.ts#L1-L90) | HS256, 15-minute access, 30-day refresh as `ApiToken` rows |
| Auth middleware | [apps/web/lib/api/auth-middleware.ts](../../../apps/web/lib/api/auth-middleware.ts) | Resolves `principalId` for admin sessions |

What is **NOT** present today:

- MFA (TOTP / WebAuthn) — none
- OIDC issuance from DPF — planned per [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md), not yet landed
- SAML / SCIM endpoints — same
- Step-up authentication (RFC 6750-style `WWW-Authenticate` challenges with `error="insufficient_scope"`) — none

Standards anchor: `TAK §7.1` requires "authentication of the human or calling system" as Layer 1; this is satisfied for password and OAuth. `TAK §7.5 Runtime Identity Proof Posture` requires the runtime to support the stronger claim that "the subject identity is X" — partial: the JWT carries `sub=userId` but does not carry the principal `principalId` or any GAID. That is a Layer-2 projection gap, not a Layer-1 gap.

### 4.2 Principal + private GAID (Layer 2)

| Surface | File | Notes |
|---------|------|-------|
| `Principal` table | [packages/db/prisma/schema.prisma:190-199](../../../packages/db/prisma/schema.prisma#L190-L199) | `principalId` (`PRN-<uuid>`), `kind` ∈ {human, agent, …}, `displayName`, `status` |
| `PrincipalAlias` table | [packages/db/prisma/schema.prisma:201-212](../../../packages/db/prisma/schema.prisma#L201-L212) | `(aliasType, aliasValue, issuer)` unique; `aliasType` includes `user`, `employee`, `agent`, `gaid` |
| Private GAID minter | [apps/web/lib/identity/principal-linking.ts:51-53](../../../apps/web/lib/identity/principal-linking.ts#L51-L53) | `gaid:priv:dpf.internal:<normalized-id>` |
| Sync helpers | [apps/web/lib/identity/principal-linking.ts:154-281](../../../apps/web/lib/identity/principal-linking.ts#L154-L281) | `syncEmployeePrincipal`, `syncUserPrincipal`, `syncAgentPrincipal` |
| Principal context | [apps/web/lib/govern/principal-context.ts:10-25](../../../apps/web/lib/govern/principal-context.ts#L10-L25) | Builds `PrincipalContext` from session user |
| Effective auth context | [apps/web/lib/identity/effective-auth-context.ts](../../../apps/web/lib/identity/effective-auth-context.ts) | Adds `managerScope`, `directReportIds` |

What is **NOT** present today:

- `syncCustomerPrincipal()` does not exist; customer contacts are not yet projected into `Principal`
- No `AIDoc` projection — there is no resolver, no signed document, no `model_binding`/`tool_surface`/`authorization_classes` projection
- No `operating_profile_fingerprint` / `validation_state` — `AgentExecutionConfig` and `AgentToolGrant` *contain* the materially relevant state, but no digest is computed
- No exposure-state column on `Agent` (the schema has `Agent.sensitivity` for data-handling, not `exposure_state` ∈ {private, federated, public})
- The principal context is built but is not yet passed into `agentic-loop.ts` tool dispatch — `ToolExecution` rows record `userId` not `principalId`

Standards anchor:
- `GAID §6.2` (private namespace syntax) — **satisfied** for agents (already minting `gaid:priv:dpf.internal:<id>`); not yet for customers
- `GAID §6.4` (private namespace requirements) — **partially satisfied** — uniqueness within boundary holds; resolution exists; status/revocation does not yet
- `GAID §7.1`/`§7.2` (AIDoc and minimum fields) — **not yet** — the data exists in adjacent tables but no resolver or document
- `GAID §6.8` (subject identity vs exposure-state continuity) — **not yet enforceable** — no `exposure_state` column

### 4.3 Agent registry and operating state (Layer 2/3 boundary)

| Surface | File | Notes |
|---------|------|-------|
| File-backed registry | [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json) | Bootstrap defaults for `Agent`, `AgentExecutionConfig`, tool grants |
| `Agent` table | [packages/db/prisma/schema.prisma:1378-1418](../../../packages/db/prisma/schema.prisma#L1378-L1418) | `agentId`, `name`, `tier`, `sensitivity`, `hitlTierDefault`, `escalatesTo`, `delegatesTo`, `valueStream`, `it4itSections` |
| `AgentExecutionConfig` | [packages/db/prisma/schema.prisma:1506-1521](../../../packages/db/prisma/schema.prisma#L1506-L1521) | `defaultModelId`, `temperature`, `maxTokens`, `executionType`, `concurrencyLimit`, `dailyTokenLimit` |
| `AgentSkillAssignment` | [packages/db/prisma/schema.prisma:1522-1536](../../../packages/db/prisma/schema.prisma#L1522-L1536) | Per-agent skill labels, capability gates, prompts |
| `AgentToolGrant` | [packages/db/prisma/schema.prisma:1537-1548](../../../packages/db/prisma/schema.prisma#L1537-L1548) | `agentId`, `grantKey`; intersection target |
| `AgentGovernanceProfile` | [packages/db/prisma/schema.prisma:1458-1475](../../../packages/db/prisma/schema.prisma#L1458-L1475) | `capabilityClassId`, `directivePolicyClassId`, `autonomyLevel`, `hitlPolicy`, `allowDelegation`, `maxDelegationRiskBand` |
| `DelegationChain` | [packages/db/prisma/schema.prisma:5730-5755](../../../packages/db/prisma/schema.prisma#L5730-L5755) | `chainId`, `depth`, `authorityScope`, `originUserId`, `originAuthority`, narrowing-only |
| Delegation runtime | [apps/web/lib/tak/delegation-authority.ts](../../../apps/web/lib/tak/delegation-authority.ts) | Loop detection (line ~152), depth limit 4 (line ~127), authority narrowing (line ~181) |

Standards anchor:
- `TAK §7.4` (approved operating profile) — **partially satisfied** — the materially relevant fields exist but are not bundled, fingerprinted, or treated as a single governed artifact
- `GAID §6.9` (subject vs operating state) — **partially satisfied** — operating state can be reconstructed across tables; no version history beneath the `Agent` row

### 4.4 Local runtime authorization (Layer 3)

| Surface | File | Notes |
|---------|------|-------|
| Capabilities × roles | [apps/web/lib/govern/permissions.ts:42-93](../../../apps/web/lib/govern/permissions.ts#L42-L93) | 27 capabilities mapped to HR-* role ids; `can(user, capability)` |
| Tool → grant mapping | [apps/web/lib/tak/agent-grants.ts:11-179](../../../apps/web/lib/tak/agent-grants.ts#L11-L179) | 100+ tools → grant categories; tools not in map default to **deny** |
| Grant intersection | [apps/web/lib/tak/agent-grants.ts:240-254](../../../apps/web/lib/tak/agent-grants.ts#L240-L254) | `isToolAllowedByGrants` |
| Agent grant lookup | [apps/web/lib/tak/agent-grants.ts:200-237](../../../apps/web/lib/tak/agent-grants.ts#L200-L237) | DB-first, file fallback to `agent_registry.json` |
| Auto-approve predicate | [apps/web/lib/mcp-tools.ts](../../../apps/web/lib/mcp-tools.ts) | Per-tool `autoApproveWhen()` for standing authorization (e.g. `contribute_to_hive` under `contributionMode=contribute_all`) |

Standards anchor:
- `TAK §7.2` (effective permission rule — intersection of principal × agent × route) — **satisfied** for the principal × agent dimension; route-context narrowing is the "third leg" and is partially present via `RouteContextDef.domainTools` ([apps/web/lib/tak/route-context-map.ts](../../../apps/web/lib/tak/route-context-map.ts))
- `TAK §8.1` (tool definitions with machine-readable metadata) — **satisfied** — `mcp-tools.ts` definitions carry name, description, schema, side-effecting/readOnlyHint, executionMode, requiredCapability
- `TAK §8.3` (proposal flow) — **satisfied at the data-model level** (`AgentActionProposal` lifecycle; `apps/web/lib/actions/proposals.ts`) — but live install has 0 rows on this table, so the path is exercised in tests, not yet in production

### 4.5 Audit and receipts (TAK §13)

| Surface | File | Notes |
|---------|------|-------|
| `ToolExecution` | [packages/db/prisma/schema.prisma:2538-2564](../../../packages/db/prisma/schema.prisma#L2538-L2564) | `agentId`, `userId`, `taskRunId`, `toolName`, `parameters`, `result`, `executionMode`, `auditClass`, `capabilityId` |
| `AgentActionProposal` | [packages/db/prisma/schema.prisma:2462-2488](../../../packages/db/prisma/schema.prisma#L2462-L2488) | Proposal lifecycle, `decidedById`, `executedAt` |
| `AuthorizationDecisionLog` | [packages/db/prisma/schema.prisma](../../../packages/db/prisma/schema.prisma) | `actionKey`, `actorType`, `actorRef`, `decision`, `rationale` |
| `ComplianceAuditLog` | [packages/db/prisma/schema.prisma:4015-4032](../../../packages/db/prisma/schema.prisma#L4015-L4032) | Entity-level field-change audit |
| Audit class taxonomy | [apps/web/lib/audit-classes.ts:1-16](../../../apps/web/lib/audit-classes.ts#L1-L16) | `ledger` (durable), `journal` (30-day rolling), `metrics_only` (no payload) |
| Tool-execution write | [apps/web/lib/tak/agentic-loop.ts](../../../apps/web/lib/tak/agentic-loop.ts) | Fire-and-forget after every `executeTool()`; metrics-only suppression at line ~438/~936 |
| Task trace (recent) | migrations 2026-04-24 | `taskRunId` added to `AgentActionProposal`, `ToolExecution`, `AgentMessage` |

Standards anchor:
- `TAK §13.1` (minimum audit events) — **satisfied** for tool execution attempts, results, proposals, decisions; **partial** for delegation events (logged in `DelegationChain` rather than the unified audit stream), policy denials, and provider-budget/queue/failover events (no rows yet because the queue path is light)
- `TAK §13.2` (evidence fields — `parameters`, `result`, `executionMode`, `provider`/`model` attribution) — **satisfied** for tool execution; **gap**: `provider_ref` and `model_ref` are not currently captured on `ToolExecution`
- `TAK §13.3` / `GAID §10.4` (cryptographic non-repudiation; RFC 9421 / JOSE / COSE) — **not present**, intentional defer
- `GAID §10.3` (trace context preserved end to end across delegation) — **partial** — `taskRunId` chains within DPF; **W3C `traceparent` is not propagated** outward to MCP, Inngest, or external services

### 4.6 Conversation and memory surfaces (TAK §12)

| Surface | File | Notes |
|---------|------|-------|
| `AgentThread` | [packages/db/prisma/schema.prisma:2405-2417](../../../packages/db/prisma/schema.prisma#L2405-L2417) | Per-user conversation container indexed on `[userId, contextKey]` |
| `AgentMessage` | [packages/db/prisma/schema.prisma:2419-2439](../../../packages/db/prisma/schema.prisma#L2419-L2439) | Role / content / `taskRunId` |
| `UserFact` | [packages/db/prisma/schema.prisma:2441-2460](../../../packages/db/prisma/schema.prisma#L2441-L2460) | Categories: `preference`, `decision`, `constraint`, `domain_context`; supersession chain |
| `KnowledgeArticle` | [packages/db/prisma/schema.prisma:5754-5780](../../../packages/db/prisma/schema.prisma#L5754-L5780) | `category` ∈ {process, policy, decision, how-to, reference, troubleshooting, runbook}; `reviewIntervalDays @default(90)` |
| Vector store | [packages/db/src/qdrant.ts](../../../packages/db/src/qdrant.ts) | Two collections: `AGENT_MEMORY` (768-dim cosine), `PLATFORM_KNOWLEDGE` |
| Semantic recall | [apps/web/lib/inference/semantic-memory.ts:27-150](../../../apps/web/lib/inference/semantic-memory.ts#L27-L150) | `storeConversationMemory()`, `recallRelevantContext()` (threshold 0.55) |
| Fact extraction | [apps/web/lib/tak/user-facts.ts:100-231](../../../apps/web/lib/tak/user-facts.ts#L100-L231) | `upsertUserFact`, `extractAndStoreFacts` |
| Context budget | [apps/web/lib/tak/agentic-loop.ts:59-61](../../../apps/web/lib/tak/agentic-loop.ts#L59-L61) | `MAX_AGENTIC_HISTORY_MESSAGES = 24`, `MAX_TEXT_MESSAGE_CHARS = 4000`, `MAX_TOOL_RESULT_CHARS = 1500` |

Standards anchor:
- `TAK §12.1` (memory is governed) — **partially satisfied** — categories exist for facts; semantic recall has no class taxonomy
- `TAK §12.2` (retention rules) — **partial** — audit classes have retention; memory itself has no policy column. `BacklogItem.stalenessDetectedAt` exists but is not wired
- `TAK §12.3` (context truncation discipline) — **partially satisfied** — 24-message window + char budgets; no documented summarization
- `TAK §12.4` (memory is advisory until revalidated for consequential action) — **not present** — the agentic loop does not gate consequential actions on memory revalidation; it uses memory directly

### 4.7 Protocol-facing surfaces (MCP / HTTP / inter-service)

| Surface | File | Notes |
|---------|------|-------|
| MCP tools route | [apps/web/app/api/mcp/tools/route.ts:1-22](../../../apps/web/app/api/mcp/tools/route.ts#L1-L22) | `auth()` session check; filters by capability |
| MCP call route | [apps/web/app/api/mcp/call/route.ts:1-37](../../../apps/web/app/api/mcp/call/route.ts#L1-L37) | `auth()` + `can(user, tool.requiredCapability)` |
| browser-use client | [apps/web/lib/operate/browser-use-client.ts:1-104](../../../apps/web/lib/operate/browser-use-client.ts#L1-L104) | HTTP JSON-RPC, **no `Authorization` header** — Docker network isolation only |
| ADP token exchange | [apps/web/lib/integrate/adp/token-client.ts](../../../apps/web/lib/integrate/adp/token-client.ts) | mTLS OAuth 2.0 client_credentials |
| Inngest webhooks | [apps/web/app/api/inngest/route.ts](../../../apps/web/app/api/inngest/route.ts) | `INNGEST_SIGNING_KEY` |

Standards anchor:
- `GAID §11.4` (MCP profile — agent SHOULD expose its `GAID` and AIDoc reference in connection metadata) — **not yet** — the portal's MCP routes do not advertise `gaid` or `aidoc_ref`
- `GAID §11.6` (HTTP profile — `GAID` SHOULD be carried in request/message metadata) — **not yet**
- MCP authorization (2025-11-25 spec — OAuth 2.1, RFC 9728 Protected Resource Metadata, RFC 8707 Resource Indicators, PKCE-S256, no token passthrough) — **not yet** — the portal's MCP routes use NextAuth session cookies only; that is fine *as a portal-internal API* but it is not the surface other agents/clients can authenticate against externally

### 4.8 Observability and conformance surfaces (TAK §14)

| Surface | File | Notes |
|---------|------|-------|
| Authority workspace | [apps/web/app/(shell)/platform/audit/authority/page.tsx](../../../apps/web/app/(shell)/platform/audit/authority/page.tsx) | Authority Matrix + Delegation Chain + Effective Permissions Inspector |
| Effective permissions inspector | [apps/web/components/platform/EffectivePermissionsPanel.tsx](../../../apps/web/components/platform/EffectivePermissionsPanel.tsx) | (user role × agent) → per-tool allowed/denied |
| Tool execution journal | [apps/web/app/(shell)/platform/audit/journal/page.tsx](../../../apps/web/app/(shell)/platform/audit/journal/page.tsx) | Searchable execution history |
| Action ledger | [apps/web/app/(shell)/platform/audit/ledger/page.tsx](../../../apps/web/app/(shell)/platform/audit/ledger/page.tsx) | Proposal counts and history |
| Route decision log | [apps/web/app/(shell)/platform/audit/routes/page.tsx](../../../apps/web/app/(shell)/platform/audit/routes/page.tsx) | Routing decisions with fitness scores |
| Diagnostics | [apps/web/app/(shell)/admin/diagnostics/page.tsx](../../../apps/web/app/(shell)/admin/diagnostics/page.tsx) | Preflight + live probe |
| Coworker health | [apps/web/components/monitoring/AiCoworkerHealthPanel.tsx](../../../apps/web/components/monitoring/AiCoworkerHealthPanel.tsx) | Inference uptime, Qdrant uptime, p95 latency, memory error rate |

Standards anchor:
- `TAK §14.1` (operator MUST inspect effective permissions, active tools, oversight tier, recent actions, proposal state, queue/retry/deferral, provider budget) — **partial**: effective permissions and recent actions are present; **proposal queue, queued/deferred inference, provider-budget state are not present** as supervisor-facing views
- `TAK §14.2` (human-facing honesty — anti-fabrication) — **partially satisfied** at the audit level (every tool call is logged, narration cannot fake completion) — there is no automated detector that scans assistant text for "I deployed X" claims with no matching tool call

### 4.9 External representation and contributions

| Surface | File | Notes |
|---------|------|-------|
| Hive contribution identity | [apps/web/lib/integrate/identity-privacy.ts](../../../apps/web/lib/integrate/identity-privacy.ts) | Per-install pseudonym `dpf-agent-<shortId>` (8-char hex); author email `agent-<sha256-16>@hive.dpf` |
| Contribution flow | [apps/web/lib/integrate/contribution-pipeline.ts](../../../apps/web/lib/integrate/contribution-pipeline.ts) | DCO sign-off uses pseudonym; real identity stays local |

This is the existing "obfuscated, not anonymous" stance. It satisfies the user requirement that contributions are pseudonymous-but-distinguishable. It does *not* yet expose any `gaid:pub:` URI for cross-install agents — and per the meta-spec scope, public issuance is deferred.

Standards anchor: `GAID §6.5` (boundary mapping — a private agent exposed publicly MUST get a public `GAID`) — **future work**, not an immediate gap.

## Target-State Alignment

Each subsection below states the alignment goal, the rule that governs it, and the *minimum* implementation surface that satisfies it. These are the inputs to the four sibling backlog items.

### 5.1 Workforce + customer auth → principal + private GAID (Layer 1 → Layer 2)

**Goal.** Every authenticated session resolves to a `Principal` row, and every consequential action attributed downstream uses `principalId` (not `userId`) as the actor key.

**Rule.** Auth identifies; the principal carries identity. Auth tokens MAY change (session rotation, MFA step-up, re-login); principal ID does not.

**Implementation surface for `BI-GAID-8D72B4`.**

1. Add `syncCustomerPrincipal(customerContactId)` parallel to existing `syncEmployeePrincipal` / `syncUserPrincipal` / `syncAgentPrincipal` in [apps/web/lib/identity/principal-linking.ts](../../../apps/web/lib/identity/principal-linking.ts). `kind: "customer"`, alias rows for `customer_contact` and the customer's email if not already present.
2. Backfill: a `prisma migrate` data step that creates principals + aliases for every existing `User`, `EmployeeProfile`, `Agent`, and `CustomerContact` row that lacks one. This is idempotent (the linking helpers already use `findPrincipalByAliases` first).
3. Surface `principalId` in `DpfSession.user` (the type at [apps/web/lib/govern/auth.ts:60-73](../../../apps/web/lib/govern/auth.ts#L60-L73)) by adding it to the JWT callback payload. The JWT remains signed by `AUTH_SECRET`; the principal ID is non-secret.
4. Pass `principalId` into the agentic loop and add it to `ToolExecution` (new nullable column `actingPrincipalId`). `userId` is retained for backward compatibility; `actingPrincipalId` is the canonical actor key going forward.
5. The `actingAgent` arm of the principal context flips from "Agent.agentId" to the agent's principal ID once `syncAgentPrincipal` has run — which it already has on this install (354 grants, 67 principals, 72 aliases).

This satisfies `GAID §6.4` (private namespace requirements: uniqueness, resolution, status), and gives `TAK §7.5` the stronger claim ("the subject identity is X") at the audit boundary.

### 5.2 Internal AIDoc resolver

**Goal.** A single function `resolveInternalAIDoc(gaid)` returns the agent's enduring identity, current operating state, declared tool surface, declared authorization classes, and validation state — pulling from existing tables.

**Rule.** The AIDoc is a *projection*, not a new table. The standard's `MUST` list maps onto existing data; nothing new needs to be persisted to land a v0 AIDoc.

**Implementation surface for `BI-GAID-8D72B4`.**

1. New file `apps/web/lib/identity/aidoc-resolver.ts` exposing `resolveInternalAIDoc(gaid: string): Promise<AIDoc>` and `resolveAIDocForAgent(agentId: string): Promise<AIDoc>` that:
   - reads `Agent`, `AgentExecutionConfig`, `AgentToolGrant`, `AgentSkillAssignment`, `AgentGovernanceProfile`
   - resolves the agent's principal + GAID alias
   - projects `model_binding` from `AgentExecutionConfig.defaultModelId` + `AgentModelConfig`
   - projects `tool_surface` from grants intersected with `mcp-tools.ts` definitions
   - projects `authorization_classes` via `mapLocalPolicyToPortableClasses(grants)` (see §5.4)
   - computes `operating_profile_fingerprint` as `sha256(canonicalize({ model_binding, tool_grants_sorted, prompt_class_refs, hitl_default, sensitivity }))`
   - sets `validation_state` ∈ {`validated`, `pending-revalidation`, `stale`} — phase-1 just returns `validated` if the agent is `status="active"`; the freshness machinery comes later
   - sets `exposure_state: "private"` until §5.6 lands the column
2. Mirror the non-normative pseudocode at [docs/architecture/GAID.md §7.6](../../architecture/GAID.md). The fields not yet known (e.g. `evidence_refs` for model cards) are emitted as `"undisclosed"` per `GAID §7.3` — making missing evidence explicit, not fabricating it.
3. Phase-1 returns the AIDoc as an unsigned plain object. Phase-2 (after `BI-OBS-4B63F2` lands receipts) adds a JOSE detached signature option behind a feature flag.

This satisfies `GAID §7.1`–`§7.6` for `GAID-Private`. It explicitly does *not* claim `GAID-Federated` or `GAID-Public`, which require accredited issuance + verifier material publication.

### 5.3 Agent operating-state versioning and validation continuity

**Goal.** Distinguish *identity continuity* (same `gaid:priv:…`) from *validation continuity* (same materially-validated operating state). Material change MUST trigger a state transition, not silently retain the prior `validated` claim.

**Rule.** From `TAK §7.7`: model swap, instruction-bundle swap, tool-surface change, autonomy-posture change, and dependency drift are material. The rule applies to every `Agent` row, not only to externally-exposed ones.

**Implementation surface for `BI-GAID-8D72B4`.**

1. Compute the operating-profile fingerprint at every `Agent` / `AgentExecutionConfig` / `AgentToolGrant` / `AgentSkillAssignment` write. Persist in a new column `Agent.operatingProfileFingerprint` and a small history table `AgentOperatingStateRevision { agentId, fingerprint, capturedAt, validationState, materialChangeReason }`.
2. The seed loader and admin write paths mark the new revision `pending-revalidation` if `materialChangeReason` is in {`model_binding_changed`, `tool_grants_changed`}. They mark it `validated` if the change is cosmetic (display name, description).
3. The `EffectivePermissionsPanel` (already present) gains a column showing the current fingerprint and validation state. Operators can see "this agent's operating profile is newer than the last validated one."
4. No coupling yet to revalidation gates — this is observability infrastructure first. Gates land in §5.7.

This satisfies `TAK §7.8` (profile fingerprints) and `GAID §6.9` / §8.7–8.9 (operating-state versioning, badge invalidation on material change).

### 5.4 Portable authorization classes (Layer 4)

**Goal.** Map DPF's local grants (Layer 3) to GAID's portable nine-class vocabulary (`observe / analyze / create / update / approve / execute / delegate / administer / cross-boundary`) so that AIDoc, MCP responses, LDAP/SCIM projections, and receipts all agree on the agent's declared scope.

**Rule.** Portable classes are *declarations*, not *grants*. A relying party reads the classes to decide whether to engage; the runtime still enforces local intersection at action time. `GAID §9.3` is explicit: "MUST NOT treat a declared authorization class as proof of present authorization."

**Implementation surface for `BI-GAID-8D72B4`.**

1. New file `apps/web/lib/identity/authorization-classes.ts` exporting `mapLocalPolicyToPortableClasses(grantKeys: string[]): GaidAuthorizationClass[]`. The mapping mirrors the non-normative pseudocode at [docs/architecture/GAID.md §9.4](../../architecture/GAID.md), specialized to DPF's grant taxonomy:

   | DPF grant key (examples) | Portable class |
   |--------------------------|----------------|
   | `backlog_read`, `registry_read`, `portfolio_read`, `telemetry_read` | `observe` |
   | `analysis_tools` (none today; would map from utility-tier inference) | `analyze` |
   | `backlog_write`, `registry_write` | `create`, `update` |
   | grants invoking `AgentActionProposal` decision authority | `approve` |
   | `sandbox_execute`, `iac_execute`, `release_gate_create` | `execute` |
   | `subagent_dispatch` (delegation tools) | `delegate` |
   | `admin_write`, `agent_control_read` | `administer` |
   | `web_search`, `external_registry_search`, `cross_org_connectors` | `cross-boundary` |

2. The mapping is the *single canonical map*. AIDoc, observability surfaces, and any future LDAP/SCIM projection (per [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md)) all read from it.

3. `mcp-tools.ts` tool definitions gain an `authorizationClass` annotation matching the table above. This is for declaration; the runtime still enforces the existing capability + grant intersection. Tools whose classification is non-obvious (e.g. `evaluate_page` — observe? analyze?) get the class that best describes the *consequence*, not the implementation detail.

This satisfies `GAID §9.1`–`§9.4`.

### 5.5 TAK runtime policy and HITL posture

**Goal.** TAK §8 (tool execution and gating) and §9 (HITL tiers) are already substantially implemented. The alignment work is to make the existing implementation legible as *TAK conformance*, not to rewrite it.

**Rule.** "Don't fabricate conformance." If a control is partial (e.g. proposal flow exists in code but has zero rows in production), the conformance statement says so.

**Implementation surface (cross-cutting, lands as supporting work in `BI-OBS-4B63F2`).**

1. A short `docs/architecture/dpf-tak-conformance.md` table that, for every `MUST` in TAK §7–§16, points to the file/line that implements it or marks it `not_implemented` / `partial` / `deferred`. This is the meta-spec's "Phase 4: Conformance Appendix" deliverable, scoped to the runtime policy half.
2. An invariant test in `apps/web/lib/tak/__tests__/tak-conformance.test.ts` that asserts the table is current — it cross-checks that every grant key referenced by tool definitions has a `mapLocalPolicyToPortableClasses` entry; that every tool definition has an `executionMode`; that every proposal-mode tool has a non-null `requiredCapability`.
3. Document the autonomy ladder at [apps/web/lib/tak/agent-grants.ts](../../../apps/web/lib/tak/agent-grants.ts) and `Agent.hitlTierDefault` against `TAK §9.1` tier table (0/1/2/3) explicitly — the values exist, the mapping is implicit.

This satisfies `TAK §17.1` (TAK-Basic) once the conformance doc is committed, with the gaps named honestly.

### 5.6 Public-vs-private exposure boundaries

**Goal.** A future moment when a DPF-internal agent is exposed across an organizational boundary (B2B Hive contribution receives external agents; a DPF customer offers a coworker to their customer) requires `GAID §6.5` boundary mapping. Make the column-level substrate ready *now* so that future is not a schema migration emergency.

**Rule.** Identity continuity ≠ exposure-state continuity. The same `gaid:priv:…` should remain valid as the agent transitions through `private → federated → public`. No silent reassignment.

**Implementation surface (small, lands in `BI-GAID-8D72B4`).**

1. Add `Agent.exposureState String @default("private")` ∈ {`private`, `federated`, `public`}. Default for every existing row is `private`.
2. Add `Agent.publicGaid String?` (nullable) for the future case where a private agent is exposed publicly. Today this column stays null.
3. The hive-contribution flow already uses a separate per-install pseudonym (`dpf-agent-<shortId>`); this is *not* the same as `publicGaid` and should not be folded in. The pseudonym is a contribution-author identity; `publicGaid` is the agent's enduring public subject identity. The two coexist.
4. `Agent.exposureState` is read-only in v0 — no UI to flip it. The transition mechanics (verification material, transparency log, cross-boundary mapping) are the meta-spec's `Phase 4: Conformance Appendix` future work.

This satisfies `GAID §6.5` and `§6.8` at the schema level without prematurely committing to an issuance model.

### 5.7 Governed memory model

This is the largest target-state section. The current memory surface (4.6 above) is functional but not policy-classed. TAK §12 requires explicit classes, retention rules, freshness gates, and effectiveness checks.

**The five memory classes for DPF.**

| Class | What it holds | Retention | Allowed writers | Retrieval mode | Revalidation for consequential action? |
|-------|---------------|-----------|-----------------|----------------|----------------------------------------|
| `core` (pinned) | Per-agent immutable directives, route-scoped persona, immutable platform preamble. The "always in context" surface. | Durable (lifetime of the agent / route definition) | System / supervisor / governed seed loader | Always in context; never searched | No — these are policy, not facts |
| `user_fact` | Structured user/principal facts: preferences, decisions, constraints, domain context. Already exists in `UserFact`. | Durable; supersession chain | Fact extractor + user write | Structured lookup by `(principalId, category, key)` | **Yes** — `decision` and `constraint` facts MUST be revalidated against current source-of-truth before consequential action |
| `semantic_recall` | Conversational embeddings for relevance-based recall — the Qdrant `AGENT_MEMORY` collection today. | Bounded (rolling window; class-level TTL configurable, default 90 days) | `runtime_memory_writer` only | Search by similarity; threshold-gated | **Yes** — semantic recall is advisory; if it is the *basis* for a state-changing action, the relevant fact MUST be re-verified |
| `archival_knowledge` | DPF-internal knowledge articles, runbooks, decisions — the existing `KnowledgeArticle` table; RAG over `PLATFORM_KNOWLEDGE`. | Policy-controlled per article (`reviewIntervalDays`); reviewed cadence | Authors with `registry_write` grant | Search; structured fetch by entity | **Yes for policy/decision categories**; advisory for how-to/reference |
| `audit_evidence` | Receipts, tool execution rows, proposal records, authorization decisions. Not "memory the agent reads" — memory the operator/auditor reads. | Class-tiered: `ledger` durable, `journal` 30-day, `metrics_only` no payload | Runtime only | Evidence query, not in-context recall | N/A — evidence is the source of truth |

**The five classes are deliberately NOT seven and NOT three.** Five is the smallest set that distinguishes:
- what the agent always sees (`core`)
- what the user "is" — structured (`user_fact`)
- what the conversation surfaced — vector (`semantic_recall`)
- what the org knows — curated (`archival_knowledge`)
- what happened — tamper-evident (`audit_evidence`)

Any new memory pattern proposed for DPF must be placed into one of the five or argued for as a sixth.

**Freshness and revalidation rules.**

A memory item carries a `validation_state` ∈ {`current`, `stale`, `advisory`, `advisory_until_revalidated`}. The state is computed at retrieval time (cf. [GAID §7.6 / TAK §12.5](../../architecture/trusted-ai-kernel.md) pseudocode):

```
classify_validation_state(item, request):
  if item.source_type in [db_row, live_api, current_policy]: return "current"
  if item.age > class.max_freshness:                          return "stale"
  if request.action_risk in [approve, execute, cross_boundary]:
    return "advisory_until_revalidated"
  return "advisory"
```

`request.action_risk` is derived from the tool's portable authorization class. Tools in `{approve, execute, cross-boundary, delegate}` are consequential; tools in `{observe, analyze}` are not. `create` and `update` depend on side-effect declaration in the tool definition.

When `validation_state == "advisory_until_revalidated"`:

- For `user_fact`: re-read the underlying record (e.g. `EmployeeProfile.workEmail` rather than the cached preference fact) before passing to the tool. If the fact is no longer corroborated, the action is denied with reason `memory_revalidation_failed`.
- For `archival_knowledge` (policy/decision): check `KnowledgeArticle.lastReviewedAt + reviewIntervalDays` against `now()`. If overdue, the article is excluded from the prompt and a deny-with-reason `archival_overdue_for_consequential_action` fires.
- For `semantic_recall`: this class never directly authorizes consequential action — it is always advisory. If it surfaces a fact that is needed for the action, the path is to materialize that fact through `user_fact` or `archival_knowledge` first.

**Effectiveness checks.**

TAK §14.3 (non-normative transparency state pseudocode) names `embedding_status`, `memory_recall_status`, `fact_extraction_status` as required supervisor surfaces. The corresponding metrics:

| Metric | Threshold | Surfaces in |
|--------|-----------|-------------|
| Qdrant `up` | live | already in [AiCoworkerHealthPanel.tsx](../../../apps/web/components/monitoring/AiCoworkerHealthPanel.tsx) |
| `dpf_semantic_memory_errors_total` rate (5m) | < 1 / minute steady-state | already in panel |
| Fact extraction success ratio | > 0.9 over 7d | new — counter on `extractAndStoreFacts` |
| Recall hit-rate at threshold 0.55 | > 0.4 over 24h | new — counter on `recallRelevantContext` |
| KnowledgeArticle review overdue count | < 5% of corpus | new — periodic job; surfaces on observability page (per `BI-OBS-4B63F2`) |

These are signals, not gates. None of them block agent action; they raise visibility.

**Implementation surface for `BI-MEM-5A41C7`.**

1. Add a `memoryClass` column on `UserFact` (default `user_fact`), and define the class taxonomy in a new file `apps/web/lib/tak/memory-classes.ts` (mirroring `audit-classes.ts:1-16` style).
2. Add a `validation_state` field to the in-memory shape returned by `recallRelevantContext` and `loadUserFacts` — computed at read time per the rule above. The agentic loop reads `validation_state` and, for consequential tools, applies the revalidation gate.
3. Wire `BacklogItem.stalenessDetectedAt` (already in schema) into the archival-knowledge path: a periodic job marks `KnowledgeArticle` entries past their review interval as overdue and either excludes them from RAG or re-queues them for review.
4. Add the new metrics counters and surface them on `/platform/audit/authority` (the same workspace the EffectivePermissionsPanel lives in) plus the existing health panel. Do not add a new top-level page — `BI-OBS-4B63F2` consolidates conformance views there.
5. The agentic loop gains a small helper `gateMemoryForAction(memoryItems, request)` that returns the filtered set + an explicit `denied_for_revalidation` list. Today's loop reads memory directly; the gate is a one-line wrap.

### 5.8 Separation of governed runtime memory, knowledge vaults, and primary system-of-record data

This is the user's most explicit design ask. It is not a code surface; it is a discipline.

**Three memory zones, three rules.**

| Zone | What it holds | Authority | TAK governance | Examples in DPF |
|------|---------------|-----------|----------------|-----------------|
| **Governed runtime memory** | `core`, `user_fact`, `semantic_recall`, `audit_evidence` (per §5.7) | Platform / TAK kernel | All five classes; revalidation; effectiveness checks; receipts | `AgentThread`, `AgentMessage`, `UserFact`, Qdrant `AGENT_MEMORY`, `ToolExecution` |
| **User/team knowledge vaults** | The optional "open-brain" / personal-wiki layer; per-team Logseq/Obsidian-style notes; team SOP repositories that the team curates | The user or team owns the content | TAK governs *access* (read-only RAG via tool grants) but does NOT govern the *content* — the team writes whatever it writes | DPF does not yet ship a vault layer; `KnowledgeArticle` is platform-curated, not user-vault. Future user-vault layer would mount here. |
| **Primary system-of-record data** | The actual database rows that *are* the truth — `Organization`, `EmployeeProfile`, `BacklogItem`, `FeatureBuild`, `Order`, `Invoice` | Operational systems own this | TAK governs *access through tool calls*; the data is not "memory" — it is the world | `Organization`, `EmployeeProfile`, financial tables, `BacklogItem`, `DigitalProduct` |

**The three rules.**

1. **Governed runtime memory MUST NOT be the system of record for anything.** If a fact lives only in `UserFact` and not in any DB row that an admin can edit through the UI, that's a smell — it means the runtime is the only writer. Move it into a primary table with a UI, then optionally cache as a `user_fact`.
2. **User/team knowledge vaults MAY be a knowledge layer; they MUST NOT be the runtime control plane.** Even if a team writes "the agent should never deploy on Fridays" into their Obsidian vault, that text is *advisory knowledge*, not policy. Policy lives in TAK rules, immutable directives, capability classes, and `AgentGovernanceProfile`. The vault is an input to inform; TAK is the output that enforces.
3. **Primary system-of-record data is the revalidation target.** When TAK §12.4 says "memory MUST be revalidated against a current source of truth," the source of truth is *this zone*, not a freshness recheck of the same memory layer.

**Why this matters in DPF specifically.** The platform already has the right shape — the fact extraction layer pulls from chat into `UserFact`, but the underlying employee/customer data is in `EmployeeProfile`/`CustomerContact`. The risk is drift: a `user_fact` that says "Mark prefers PostgreSQL" is harmless; a `user_fact` that says "Mark's role is HR-500" is dangerous if it disagrees with `User.platformRole`. The revalidation gate (§5.7) is what catches that. The discipline is what prevents it.

### 5.9 Applicability of "open brain", personal-wiki, OpenMemory, memory-block, and archival-memory approaches

**Letta (formerly MemGPT) — `core / archival / recall` taxonomy and agent-self-edited memory blocks.**

- *Where it fits in DPF.* The vocabulary maps closely (DPF's `core` ≈ Letta core memory; DPF's `archival_knowledge` ≈ Letta archival; DPF's `semantic_recall` ≈ Letta recall). DPF should adopt the Letta vocabulary as the canonical naming for the five-class model where it overlaps. **Citation, not adoption of the implementation.**
- *Where it does NOT fit.* Letta's memory is *agent-self-edited*: the agent can rewrite its own core memory blocks via tool calls. **DPF MUST NOT adopt this for production.** TAK §12.1 requires explicit policy on who can write each class. `core` memory in DPF is system / supervisor only — never agent-self-edited at production tier. (A sandbox-tier agent in a bounded experiment may self-edit; that is a different runtime profile.)

**mem0 / OpenMemory.**

- *Where it fits.* These provide retrieval/storage substrate (vector + graph + KV). DPF already has Qdrant for this and is not under-substrated. **Not adopted.** No need to introduce a parallel substrate.
- *Notable confirmation.* mem0's own *State of AI Agent Memory 2026* report names staleness, consent, and identity-resolution as *open problems* in the field. That is exactly the gap §5.7 fills with the revalidation gate.

**Anthropic Claude memory tool (six file ops, developer owns storage).**

- *Where it fits.* The split — protocol semantics defined by Anthropic, storage by the developer — is a useful precedent for DPF's relationship to the standards. TAK defines memory class semantics; the storage substrate (Postgres, Qdrant) is an implementation detail. **Pattern adopted, not the implementation.**
- *Where it does NOT fit.* The six file ops (`view / create / str_replace / insert / delete / rename`) are unclassified — they don't carry policy. DPF should not expose raw file ops on memory; it should expose typed operations on classed memory.

**"Open brain" / personal wiki (Logseq, Obsidian, SiliconBrain-style).**

- *Where it fits.* As an **optional knowledge layer** (the user/team knowledge vault zone in §5.8), per team. Mark's vision of customers contributing notes/decisions to their own knowledge surface is a legitimate future feature. It connects to TAK as a retrieval-only data source under tool grants.
- *Where it does NOT fit.* As the runtime control plane. A team-curated wiki is *not* policy. The platform must keep TAK rules, immutable directives, and `AgentGovernanceProfile` as the authoritative control plane regardless of what a team writes in their notes.

**Memory blocks generally.**

- *Where it fits.* As an internal implementation pattern for `core` memory: small, named, atomic blocks that compose into the always-in-context surface. DPF already uses this informally (the `PLATFORM_PREAMBLE` constant + per-route persona + immutable-directive blocks at [apps/web/lib/tak/agent-routing.ts](../../../apps/web/lib/tak/agent-routing.ts)).
- *Where it does NOT fit.* As the storage primitive for `user_fact` or `semantic_recall`. Those have stronger structural requirements (categories + supersession; vector search with similarity threshold) that "memory blocks" alone don't carry.

**Archival memory generally.**

- *Where it fits.* As the `archival_knowledge` class — exactly DPF's `KnowledgeArticle` model. Adoption already underway; the gap is not the substrate but the freshness wiring (§5.7).

The summary recommendation: **DPF's memory model is a five-class governed system that borrows Letta's vocabulary, the Anthropic split between protocol and storage, and the field's hard-won "staleness/consent/identity-resolution are open problems" framing. It does not adopt Letta's self-editing model, does not adopt a parallel substrate from mem0/OpenMemory, and treats personal-wiki/open-brain as an optional knowledge layer rather than the control plane.**

### 5.10 Protocol-facing implications (MCP / HTTP)

This section names what the standards require *of the protocol surface* without re-spec'ing it; the actual implementation work belongs to `BI-MCP-7E53D1`.

**MCP server projection (the portal as MCP server to other clients).**

| Standard | Requirement | Current state | Target state |
|----------|-------------|---------------|--------------|
| GAID §11.4 | `gaid` and `aidoc_ref` SHOULD be in connection metadata | not present | `/api/mcp/server-metadata` returns `{ gaid: gaid:priv:dpf.internal:portal-coworker-router, aidoc_ref: <internal URL>, authorization_classes: [...], exposure_state: "private", tool_surface_digest: <sha256> }` |
| MCP 2025-11-25 §authorization | OAuth 2.1 + RFC 9728 + RFC 8707 + PKCE-S256; no token passthrough | NextAuth session only | Add OAuth 2.1 authorization-code flow with `WWW-Authenticate` Protected Resource Metadata pointing to authentik (per [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md)); accept `resource` parameter; require `code_challenge_method=S256` |
| MCP 2025-11-25 client registration | Prefer Client ID Metadata Documents over DCR | none | When portal MCP is exposed externally, publish a Client ID Metadata Document; DCR (RFC 7591) accepted only as backwards-compat |
| GAID §11.6 | HTTP profile — `gaid` SHOULD be in request/message metadata; signatures bind identity to request | not present | New `X-DPF-Acting-Gaid` header on portal-emitted requests; `X-DPF-Acting-Principal` on receipts; W3C `traceparent` propagated |
| GAID §10 | Receipts on protocol boundary | partial via `ToolExecution` | Per-tool-call receipt object emitted alongside `ToolExecution`, carrying: `receipt_id`, `gaid`, `principal_ref` (pseudonymized as needed), `action_type`, `authorization_class`, `execution_mode`, `target_ref`, `request_hash`, `result_hash`, `trace_context`, `parent_receipt`, `evidence_refs`. v1 unsigned; v2 signed. |

**MCP client posture (the portal calling external MCP servers, e.g. browser-use).**

- browser-use is currently unauthenticated, on the Docker-internal network. That is acceptable as long as it remains internal. Once it (or any other MCP service) is exposed beyond `dpf_default`, the portal MUST become a proper MCP client: discovers AS via Protected Resource Metadata, performs OAuth 2.1 with PKCE, supplies the `resource` parameter.
- The portal MUST NOT pass through the user's token to upstream MCP servers (MCP 2025-11-25 explicit prohibition). Each upstream call uses the portal's own client credentials, with the acting `gaid` and `principal_ref` carried in receipts and W3C trace headers — *not* in the bearer token.

**ADP and other enterprise integrations.**

- DPF already follows the conduit-not-broker pattern: customer brings creds, mTLS OAuth client_credentials, no portal-side enrollment. This is correct under `GAID §10.5` (privacy/minimization) and the "DPF as integration conduit" principle. No change needed; the receipt envelope simply needs to capture the cross-boundary class.

### 5.11 Supervisor / operator observability for conformance

This is the substrate `BI-OBS-4B63F2` builds on.

**The supervisor view (TAK §14.1) requires a single page that, for any `(principal, agent, route)` selection, shows:**

1. The acting principal ref + GAID alias chain (resolved from `Principal` + `PrincipalAlias`)
2. Effective permissions = capability × tool grant ∩ route context (already in the `EffectivePermissionsPanel`)
3. The agent's current `operatingProfileFingerprint` and `validationState` (new from §5.3)
4. Active oversight tier — `Agent.hitlTierDefault` displayed against the TAK 0/1/2/3 ladder
5. Pending proposals (queryable from `AgentActionProposal` where `decidedAt IS NULL`) — not just counts, but actionable list with Approve/Reject buttons
6. Recent actions (already in the journal/ledger)
7. Memory health for this principal: facts count, fact extraction success ratio, semantic recall hit rate, archival-overdue count
8. Provider budget and queue state — the inference-queue and rate-budget surfaces TAK §8.5 / §14.1 require. *DPF has `ProviderRateBudget` and queue tables in schema; observability is the missing piece.*
9. Recent receipts: the structured receipt envelope (§5.10), filterable by `gaid` and date

The view does not need to be a new top-level route. The existing `/platform/audit/authority` workspace is the right home — it already hosts effective permissions, the authority matrix, and the delegation chain. `BI-OBS-4B63F2` extends it.

**For the user/operator (per `BI-OBS-4B63F2` user story):** the view answers "Can this user × this agent × this route do X right now? With what evidence? With what oversight?"

For the auditor: the view exports the receipt stream for `gaid` over a date range, including parent-child receipt relationships and trace context. The receipt structure (§5.10 v1) already serializes cleanly to JSON.

**For the agent itself:** no change. The standards require visibility *to operators*, not to the agent. The agent reads its grants and operating state; it does not read its own conformance evidence at runtime.

## Cross-Spec Coherence

The four sibling specs and this one form a coherent whole. The boundaries:

- **[2026-04-22 Enterprise auth, directory, federation](2026-04-22-enterprise-auth-directory-federation-design.md)** owns Layer 1 (auth), the LDAP/SCIM/OIDC edge, ADP integration mechanics, manager scope, and downstream app federation. It already names projection markers (`gaid`, `takProfileFingerprint`, `takValidationStatus`) — this spec defines what those markers actually mean and how they are computed.
- **[2026-04-23 A2A-aligned coworker runtime](2026-04-23-a2a-aligned-coworker-runtime-design.md)** owns the canonical `TaskRun` envelope, `TaskMessage`, `TaskArtifact`, internal `AgentCard`, and the governance envelope structure. This spec's `principalId` propagation, GAID alias, AIDoc resolver, portable authorization class, and receipt object are *carried* by that envelope — they are content, not container.
- **[2026-04-25 Governed MCP backlog-surface](2026-04-25-governed-mcp-backlog-surface-design.md)** owns the new tool-catalog surface. This spec defines the auth-and-identity contract any MCP surface in DPF must satisfy; the catalog is one consumer.
- **[2026-04-18 TAK + GAID standards-family meta-spec](2026-04-18-tak-gaid-standards-family-design.md)** is the parent; this spec is the conformance assessment + alignment plan it asked for.

There is no overlap to merge or refactor. There is alignment to enforce — primarily by giving the four sibling backlog items concrete acceptance criteria that reference *this* spec's section numbers.

## Recommended Execution Order

Across the seeded backlog items, the dependency order is:

1. **`BI-GAID-8D72B4` (this spec §5.1–§5.4 + §5.6)** — principal projection for customers, internal AIDoc resolver, operating-profile fingerprint, portable authorization classes, exposure-state column. **Lands first** because every other item references its outputs.

2. **`BI-MEM-5A41C7` (this spec §5.7–§5.9)** — five memory classes, freshness/revalidation rules, the `gateMemoryForAction` helper, fact-extraction and recall metrics. **Lands second** because the revalidation gate consumes the operating-state fingerprint (to invalidate cached facts when material change happens) and because it's the highest-leverage TAK §12 work.

3. **`BI-OBS-4B63F2` (this spec §5.11 + the conformance doc in §5.5)** — extends `/platform/audit/authority` with operating-state, validation, memory-health, queue-state, receipt-stream surfaces; ships the conformance appendix. **Lands third** because it makes the prior two visible. Without it the work is invisible to operators.

4. **`BI-MCP-7E53D1` (this spec §5.10)** — MCP server-metadata endpoint, OAuth 2.1 + RFC 9728 + RFC 8707 + PKCE for external MCP exposure, `X-DPF-Acting-Gaid` propagation, structured receipt object. **Lands last in this batch** because it depends on AIDoc + authorization classes + receipt structure all being defined. Note this is *not* the same as the separate governed MCP backlog-surface spec, which is implementing a tool catalog using the same auth contract.

Total span: ~3–6 weeks of focused work depending on how many test surfaces (Phase 12 coworker QA, fresh-install run) are exercised between phases.

This order is a **recommendation**, not a commitment. Each item's actual landing depends on production pressure, the federation rollout cadence, and any in-flight hive contributions that touch these surfaces.

## Confirmed-vs-Proposed Summary

**What is already true in DPF (verified in code on 2026-04-25):**

- `Principal` + `PrincipalAlias` substrate exists; 67 + 72 rows live; `kind` includes `human`, `agent`; alias types include `gaid`
- Private GAID minter `buildPrivateAgentGaid()` produces `gaid:priv:dpf.internal:<id>` and `syncAgentPrincipal()` creates the alias automatically
- Effective-permission intersection (`PERMISSIONS × AgentToolGrant`) is implemented and exercised (354 grants)
- `EffectivePermissionsPanel` already renders the (user role × agent) inspector
- Audit substrate: `ToolExecution` (91 rows), `AgentActionProposal` schema present, `AuthorizationDecisionLog` live (2 rows), `audit-classes.ts` taxonomy committed
- `taskRunId` propagation across `AgentActionProposal`, `ToolExecution`, `AgentMessage` (2026-04-24 migration)
- `UserFact` four-category memory with supersession chain (6 rows)
- Qdrant `AGENT_MEMORY` + `PLATFORM_KNOWLEDGE` collections
- Delegation runtime: depth-4 limit, loop detection, narrowing-only authority
- `AgentGovernanceProfile.hitlPolicy` carries the autonomy-tier intent
- "Obfuscated, not anonymous" hive contribution identity (`dpf-agent-<shortId>`)
- The standards docs themselves are strengthened with non-normative pseudocode for runtime trust, governed memory, audit, transparency, AIDoc, authorization-class mapping, MCP projection, and receipt issuance

**What is missing or partial:**

- `syncCustomerPrincipal()` does not exist
- `principalId` is not yet in `DpfSession` or in `ToolExecution.actingPrincipalId`
- No internal AIDoc resolver; no operating-profile fingerprint; no exposure-state column
- No portable authorization-class mapping (Layer 4 declarative classes)
- Memory has no policy class column; no revalidation gate; no effectiveness counters surfaced
- `BacklogItem.stalenessDetectedAt` exists in schema but is unwired
- No MCP server-metadata endpoint; no OAuth 2.1 / RFC 9728 / RFC 8707 / PKCE-S256 for external MCP exposure
- No `X-DPF-Acting-Gaid` / W3C `traceparent` propagation in outbound calls
- No structured receipt object beyond `ToolExecution` (no parent-receipt linkage, no `request_hash` / `result_hash` digests, no `authorization_class` in the row)
- No supervisor-facing pending-proposal queue (proposals show only inline in coworker chat)
- Provider budget / inference queue observability is at infra-metric level, not agent-action level

**What is intentionally deferred:**

- Public `GAID-Public` issuance, transparency log, accredited issuer model
- Cryptographic signing of receipts (RFC 9421 / JOSE / COSE)
- LDAP / SCIM endpoints (owned by [2026-04-22](2026-04-22-enterprise-auth-directory-federation-design.md), authentik edge)
- A2A external endpoints (owned by [2026-04-23](2026-04-23-a2a-aligned-coworker-runtime-design.md) Phase 2)
- MFA / step-up authentication (different epic)

## Risks

1. **Drift between this spec and the federation/runtime sibling specs.** Mitigation: the `BI-*` items reference this spec's section numbers as acceptance criteria; the conformance doc (§5.5) is a forcing function.
2. **Memory revalidation gate over-blocks.** A consequential action might be denied because a fact is "stale" even when the current world agrees with the cached fact. Mitigation: revalidation re-reads the source-of-truth and proceeds with the live value (per the GAID/TAK pseudocode pattern); the deny-path only fires on genuine mismatch.
3. **Operating-profile fingerprint churn.** Many edits to `agent_registry.json` would generate fingerprint churn. Mitigation: distinguish *material* fields (model binding, tool grants, prompt class refs) from *cosmetic* fields (display name, description) in the fingerprint computation.
4. **Customer-principal rollout breaks the customer auth path.** Mitigation: backfill is idempotent and runs ahead of the session change; the session JWT change is additive (`principalId` joins the existing claims).
5. **The receipt object becomes another schema entity that nobody fills in.** Mitigation: phase-1 derives the receipt at audit-write time from existing `ToolExecution` + `AuthorizationDecisionLog` joins; it is a projection, not a new write path. Phase-2 adds direct receipt rows when signing arrives.

## Open Questions

1. Should `principalId` be added to the JWT, or kept server-side and resolved on each request? (JWT keeps round-trips down; server-side keeps the JWT smaller and avoids revocation drift.)
2. Should the operating-profile fingerprint include the prompt template version (which is DB-backed via `PromptTemplate` + `PromptLoader`)? Material-change argument says yes; churn argument says only the prompt *class*, not every template revision.
3. For the revalidation gate, what is the right `request.action_risk` taxonomy? The spec proposes deriving it from the portable authorization class; the alternative is an explicit `consequenceTier` field on each tool definition.
4. Should `Agent.exposureState` flip live in v0 (with controls), or stay default-`private` until federated/public issuance lands? This spec recommends the latter — column exists, no flip path.

## Review Ask

This spec proposes:

1. A layered model (auth → principal+GAID → local authorization → portable classes → TAK runtime) that integrates the recent identity changes with the existing TAK/GAID standards.
2. A repo-grounded current-state assessment with exact file paths and line numbers.
3. Five memory classes (`core`, `user_fact`, `semantic_recall`, `archival_knowledge`, `audit_evidence`) with freshness rules and revalidation gates for consequential action.
4. A clear separation between governed runtime memory, user/team knowledge vaults, and primary system-of-record data — with three rules that prevent drift.
5. Applicability assessments for Letta-style memory blocks, mem0/OpenMemory, Anthropic memory tool, and "open brain"/personal-wiki — adopting vocabulary and patterns where appropriate, rejecting agent-self-edited core memory and runtime-control-plane misuse of personal wikis.
6. Protocol-facing alignment for MCP/HTTP per the 2025-11-25 MCP authorization direction (OAuth 2.1, RFC 9728, RFC 8707, PKCE-S256), W3C trace context, and structured receipts.
7. A conformance/observability target on the existing `/platform/audit/authority` workspace.
8. A recommended execution order across the four implementation backlog items.

The review ask is whether the layered model and the five memory classes are the right primitives, and whether the recommended execution order matches the project's near-term pressure.
