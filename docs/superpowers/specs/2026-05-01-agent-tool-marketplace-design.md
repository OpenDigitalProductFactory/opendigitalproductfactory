# Agent Tool Marketplace and Readiness Guidance

**Date:** 2026-05-01
**Status:** Draft
**Author:** Mark Bodman + Codex
**Backlog:** No exact live epic found. Adjacent live epic: `EP-TAK-3F9A21` for TAK/GAID, agent identity, governed memory, and MCP auth alignment.

---

## Problem Statement

DPF already has many pieces of an agent tool ecosystem:

- `/platform/tools/catalog` combines MCP catalog entries, native integrations, and built-in tools.
- `/platform/tools/integrations` exposes native integrations such as ADP, QuickBooks, Stripe, Microsoft 365, HubSpot, Google, Facebook Lead Ads, and Mailchimp.
- `/platform/ai/agent/[agentId]` exposes coworker-specific grants, skills, governance, degradation, and execution settings.
- `McpServer`, `McpServerTool`, `McpIntegration`, `IntegrationCredential`, `ModelProvider`, `ModelProfile`, `AgentToolGrant`, `ToolExecution`, and `TaskRequirement` already model major parts of the runtime.

The gap is not basic eligibility. The gap is the standard marketplace experience for AI-agent-usable tools: users and coworkers need to see what is available, what it does, whether it is ready, and what must happen before a coworker can use it. This includes tools that are not configured, tools that are configured but not granted to a coworker, and tools that are known to the platform but currently unavailable.

Today that information is spread across pages, hardcoded descriptors, runtime tables, and prompt hints. A coworker can be told about a few unavailable external services, but the guidance is not driven by the same catalog the human sees. As a result, a user asking about payroll may not get a clean "ADP is the native DPF integration, but it still needs setup or grant X" answer. A user asking about Build Studio may not get consistent guidance that code-generation/tool-action tasks require a frontier, tool-capable model when current assignment only clears a lower tier.

---

## Research and Benchmarking

### Open and Standard Patterns

1. **OpenAI Apps SDK and app directory**

   OpenAI's Apps SDK positions apps as MCP-based integrations with both tool logic and user interface, and it supports a submission/directory model for discovering apps. The pattern to adopt is not just "tool list"; it is "app/tool card with behavior, UI, backend connection, safety, privacy, and directory metadata."

2. **Official MCP Registry**

   The official registry establishes MCP server discovery as a first-class public catalog pattern. DPF should sync, curate, or reference public MCP entries, but the local DPF marketplace must also include native integrations and built-in tools that are not public MCP registry entries.

3. **Anthropic / Model Context Protocol**

   MCP frames servers as the standard way for models to connect to tools and data. DPF should preserve MCP semantics for MCP servers while avoiding the mistake of forcing every useful DPF integration to masquerade as public MCP. Native integrations can still appear in the same marketplace as agent-usable capabilities.

### Commercial and Enterprise Patterns

1. **DeployStack**

   DeployStack separates the global MCP catalog from team access and team installations. It explicitly describes the catalog as the store and installations as the purchased/configured items. DPF should adopt this separation: catalog entry, organization/install readiness, coworker grant readiness, and actual runtime tool instances are separate states.

2. **JFrog MCP Registry / AI Catalog**

   JFrog treats MCP servers, skills, models, and agentic assets as governed supply-chain artifacts with centralized discovery, policy, scanning, and conversational management. DPF should adopt the system-of-record pattern, but keep it local to the DPF install and tied to TAK/GAID, ToolExecution, IntegrationCredential, and authority bindings.

3. **Private enterprise app stores**

   The common enterprise pattern is a browsable marketplace with approved apps, ownership, categories, request/enable actions, and per-user or per-team readiness. DPF's difference is that the "buyer" is often a coworker workflow rather than only a human. The surface must answer both "Can I enable this?" and "Can this coworker use this for this job?"

### Adopted Patterns

- Marketplace cards with category, owner/source, trust posture, setup status, and what the tool enables.
- Separate catalog availability from installation/configuration and coworker grant readiness.
- Conversational discovery: coworkers can query known tools and recommend enablement.
- Policy and audit as part of the catalog record, not an afterthought.

### Rejected Patterns

- A plain internal permissions grid as the primary surface. DPF already has agent eligibility views; this feature is the purchasing/discovery layer.
- Treating all tools as MCP servers. Native integrations and model/provider capabilities need first-class representation.
- Letting coworkers infer tool availability from prompt text alone. The recommendation path must use a resolver that reads current runtime state.
- Adding another isolated catalog table before consolidating existing catalog sources.

### Sources

- OpenAI Apps SDK: <https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk>
- OpenAI app submission/directory guidance: <https://developers.openai.com/apps-sdk/deploy/submission>
- Model Context Protocol introduction: <https://modelcontextprotocol.io/docs/getting-started/intro>
- Official MCP Registry: <https://modelcontextprotocol.tools/>
- DeployStack MCP catalog and installation model: <https://docs.deploystack.io/general/mcp-catalog>, <https://docs.deploystack.io/mcp-installation>
- JFrog MCP Registry overview: <https://docs.jfrog.com/ai-ml/docs/mcp-registry-overview>

---

## Goals

1. Present a marketplace-style surface for DPF-known, agent-usable tools.
2. Include MCP catalog entries, active MCP services and tools, native integrations, built-in tools, and model/provider capabilities.
3. Show clear readiness states: `available`, `needs_setup`, `needs_grant`, `configured_not_granted`, `granted_unavailable`, `ready`, `unsupported`, and `retired`.
4. Let coworkers query the same marketplace when a user's task implies missing or useful functionality.
5. Provide next actions: configure integration, activate MCP service, request grant, assign frontier model, or run tool evaluation.
6. Preserve existing authority and grant systems as the source of truth for execution permission.
7. Reserve roughly 20 percent of the first implementation slice for refactoring the current hardcoded catalog descriptors into reusable shared descriptors.

## Non-Goals

1. Rebuild `/platform/ai/agent/[agentId]` or the effective-permissions surface.
2. Auto-grant tools to coworkers.
3. Auto-connect external systems or collect credentials through chat without human review.
4. Add unvetted public tools directly to runtime use. External tools still pass the Tool Evaluation Pipeline.
5. Replace `ToolExecution`, `IntegrationToolCallLog`, or existing audit records.

---

## Current Repo Evidence

| Area | Current state | Design implication |
|---|---|---|
| Connection catalog | `apps/web/lib/actions/connection-catalog.ts` merges MCP, native, and built-in entries | Use as the starting read model, but refactor descriptors into shared registry data |
| Human catalog UI | `/platform/tools/catalog` renders MCP, native, and built-in sections | Evolve this into the marketplace surface instead of adding another top-level page |
| Native integrations | `/platform/tools/integrations` and `IntegrationCredential` track configured/error states | Native tools must appear beside MCP entries with setup and readiness badges |
| Agent detail | `/platform/ai/agent/[agentId]` includes `toolGrants`, skills, governance, and execution config | Keep as authority detail; link to it from marketplace readiness explanations |
| Grants | `apps/web/lib/tak/agent-grants.ts` maps tool names to grant keys | Resolver must use this mapping instead of duplicating client-side logic |
| MCP runtime tools | `apps/web/lib/tak/mcp-server-tools.ts` discovers enabled tools from active healthy MCP servers | Marketplace must distinguish "catalog entry exists" from "runtime tool is executable" |
| Coworker prompts | `apps/web/lib/actions/agent-coworker.ts` injects unavailable model provider service hints | Replace narrow prompt hints with catalog resolver output |
| Routing requirements | `apps/web/lib/routing/task-requirements.ts` marks code-gen and tool-action as frontier | Marketplace must expose model/provider readiness alongside business tools |

---

## Product Design

### Surface Model

The primary human surface remains:

```text
/platform/tools/catalog
```

It should evolve from a connection catalog into an agent tool marketplace. The page should retain dense operational usability rather than becoming a marketing page:

- Search by task, category, provider, coworker, grant, and readiness.
- Tabs or segmented filters for `All`, `Ready`, `Needs setup`, `Needs grant`, `MCP`, `Native`, `Built-in`, and `Models`.
- Cards or table rows that show the actual product/tool name, provider, source type, trust posture, readiness, and next action.
- A details drawer for "what this unlocks", "which coworkers can use it", "what is missing", "audit posture", and "setup path".

For an entry such as ADP Workforce Now, the page should say:

- Category: HR / Payroll
- Kind: Native integration
- Enables: worker lookup, pay statements, time cards, deductions, payroll guidance
- Readiness: needs setup, configured, needs grant, or ready
- Setup path: `/platform/tools/integrations/adp`
- Coworker relevance: Finance Controller, HR Director, COO
- Runtime controls: mTLS, PII redaction, audit log, HITL requirements

For Build Studio model readiness, the page should say:

- Category: AI provider / model capability
- Enables: code generation, tool-action workflows, Build Studio implementation
- Requirement: frontier tier plus tool use
- Readiness: ready if an active eligible endpoint satisfies the requirement; otherwise needs provider/model assignment
- Setup path: `/platform/ai/assignments` and provider setup pages

### Coworker Experience

Coworkers should use the same catalog in two situations:

1. **User asks what is available**

   Example: "Can finance issue payroll checks?"

   The coworker should answer from catalog truth:

   - ADP Workforce Now is the native DPF payroll/workforce integration.
   - Current readiness: configured/needs setup/needs grant.
   - What it can and cannot do now.
   - The next enablement step.

2. **Task requires missing capability**

   Example: "Build this in Build Studio" with no frontier model available.

   The coworker should explain the blocker:

   - Build Studio requires a frontier, tool-capable model for code-generation/tool-action paths.
   - Current model assignment only clears the lower tier or lacks tool use.
   - The setup path is model assignment/provider configuration, not a generic failure.

Coworker answers must not invent integrations. If no catalog entry fits, they should say no approved DPF integration is currently known and offer to create a backlog item or start tool evaluation.

---

## Architecture

### Canonical Read Model

Add a reusable resolver:

```text
apps/web/lib/tools/tool-marketplace-readiness.ts
```

Initial API:

```ts
type ToolMarketplaceKind =
  | "mcp_catalog"
  | "mcp_runtime"
  | "native_integration"
  | "built_in"
  | "model_capability";

type ToolMarketplaceReadiness =
  | "available"
  | "needs_setup"
  | "needs_grant"
  | "configured_not_granted"
  | "granted_unavailable"
  | "ready"
  | "unsupported"
  | "retired";

type ToolMarketplaceEntry = {
  id: string;
  kind: ToolMarketplaceKind;
  name: string;
  description: string;
  category: string;
  tags: string[];
  provider?: string;
  setupHref?: string;
  docsHref?: string;
  relevantAgentIds: string[];
  requiredGrantKeys: string[];
  requiredCapabilities: string[];
  readiness: ToolMarketplaceReadiness;
  readinessReason: string;
  enables: string[];
  trustPosture: {
    source: "native" | "official_registry" | "approved_registry" | "built_in" | "model_catalog";
    verified: boolean;
    audit: string[];
    riskBand?: string;
  };
};
```

This read model joins existing data rather than replacing it:

- `McpIntegration` for public/catalog MCP entries.
- `McpServer` and `McpServerTool` for activated runtime MCP tools.
- `IntegrationCredential` plus a shared native integration descriptor registry for native integrations.
- Built-in tool overview for built-in tools.
- `ModelProvider`, `ModelProfile`, `AgentModelConfig`, and `TaskRequirement` for model capability readiness.
- `Agent`, `AgentToolGrant`, and `TOOL_TO_GRANTS` for coworker readiness.
- User capabilities and authority bindings when a user context is available.

### Refactoring Budget

The first implementation slice should spend about 20 percent of effort on refactoring that directly serves this feature:

1. Move hardcoded native integration descriptors out of `connection-catalog.ts` into a shared module:

   ```text
   apps/web/lib/tools/native-integration-catalog.ts
   ```

   This module should be imported by `/platform/tools/catalog`, `/platform/tools/integrations`, tests, and the readiness resolver.

2. Avoid duplicating `TOOL_TO_GRANTS` in client components. The current client-side `EffectivePermissionsPanel` mirrors grant logic. This feature should not add a third copy. If client rendering needs grant logic, expose a serialized read model from server code.

3. Keep catalog presentation components small. The first UI pass should extract reusable marketplace cards/rows only when they reduce duplication between sections.

### Coworker Tool Interface

Extend or replace `search_integrations` with a broader tool:

```text
search_tool_marketplace
```

Parameters:

- `query`
- `category`
- `agentId`
- `kind`
- `readiness`
- `taskType`
- `limit`

Return:

- matching entries
- readiness state
- next action
- setup link
- missing grants or missing configuration
- whether the current coworker can use it now

`search_integrations` can remain as a backwards-compatible alias for MCP-only or integration-only searches, but new coworker guidance should use the broader marketplace resolver.

### Prompt Injection

Replace the narrow unavailable-service prompt injection in `agent-coworker.ts` with a demand-driven strategy:

- For general chat, do not inject the full catalog.
- When the user asks about tools, integrations, providers, payroll, finance, Build Studio, model capability, external systems, or "can you do X", call or retrieve a small top-N marketplace result set.
- If the model lacks the required tool call or capability to query the resolver, inject a compact summary only for task-relevant entries.

This avoids bloating every coworker prompt while still letting the local model provide useful guidance.

---

## UX Requirements

1. Use DPF theme variables only: `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and accent variables.
2. No hardcoded text colors or hex colors in new UI.
3. Use compact operational layouts, not a landing page.
4. Keep cards to 8px radius or match the local component pattern if already established.
5. Show actual product/tool names as first-viewport signals.
6. Readiness badges must be understandable at a glance:

   | Badge | Meaning |
   |---|---|
   | Ready | Coworker and user context can use it now |
   | Needs setup | Catalog entry exists, but credentials/service/provider are missing |
   | Needs grant | Tool is configured but coworker lacks grant |
   | Granted unavailable | Coworker has grant, but runtime is inactive/unhealthy |
   | Available | Can be enabled, not currently active |
   | Unsupported | Known but not currently supported by this install |
   | Retired | Kept for audit/history only |

7. Details drawer should include "what this unlocks" before technical metadata.
8. The setup action should go to the existing setup page whenever one exists.

---

## Governance and Security

- Execution permission remains governed by user role, agent grants, authority bindings, and tool execution mode.
- Marketplace readiness is advisory until an actual tool call is made.
- Side-effecting tools must still use proposal/approval or HITL policy.
- External tools not already present in DPF must go through the Tool Evaluation Pipeline before being added as ready-to-enable entries.
- Native integrations must preserve credential custody and audit boundaries. For ADP, this means customer-supplied ADP API Central credentials, mTLS posture, PII redaction, and integration audit logging remain explicit.
- MCP entries must keep source, version, trust, and transport posture visible. Stdio tools remain blocked or sandbox-routed according to existing runtime constraints.

---

## Data Model Stewardship

No new canonical tool tables are required for the first slice. The design should start with a read model over existing tables and shared descriptors.

Potential later schema only if the read model proves stable:

- `ToolMarketplaceEntry` for curated local overrides and product copy.
- `ToolMarketplaceRecommendation` for observed task-to-tool recommendation evidence.
- `AgentToolOpportunity` for persistent supervisor review of missing grants or setup blockers.

Do not add these tables in the first slice unless implementation evidence shows the read model cannot serve the UI and coworker query path.

---

## Implementation Slice 1

1. Create `native-integration-catalog.ts` with descriptors for the existing native integrations.
2. Create `tool-marketplace-readiness.ts` to merge native integrations, MCP catalog/runtime entries, built-ins, and model capability checks into one read model.
3. Update `connection-catalog.ts` to use the shared descriptors and readiness resolver.
4. Add `search_tool_marketplace` to platform tools, mapped to `external_registry_search` and/or `registry_read` as appropriate.
5. Update coworker guidance so tool/integration questions use `search_tool_marketplace`.
6. Update `/platform/tools/catalog` to show readiness badges and setup/grant next actions.
7. Add focused tests for:
   - native configured vs unconfigured states
   - configured but ungranted coworker state
   - granted but unhealthy MCP runtime state
   - Build Studio model requirement readiness
   - no invented tool when no catalog entry matches

---

## Acceptance Criteria

1. A user can search the catalog for "payroll" and see ADP as a native integration with readiness and setup path.
2. A coworker can answer whether a payroll-capable tool exists, whether it is configured, and what is missing.
3. A coworker can explain that Build Studio/code-generation requires a frontier, tool-capable model when current readiness does not satisfy that requirement.
4. The catalog distinguishes unconfigured, ungranted, unhealthy, and ready states.
5. Existing grant/authority logic remains the execution source of truth.
6. Native integrations are no longer hardcoded only inside `connection-catalog.ts`.
7. New UI follows DPF theme-aware styling rules.

---

## Open Questions

1. Should "request grant" create a backlog item, an authority-binding review item, or a dedicated supervisor action?
2. Should public MCP registry entries be shown only after Tool Evaluation, or can they appear as "discoverable but not approved" with no enable action?
3. Should model capability readiness live in the same catalog tab as tools, or a separate "AI Providers" filter with cross-links into `/platform/ai/assignments`?
4. Should native integrations expose per-tool operations in the marketplace before the dedicated MCP/native runtime exposes those operations to coworkers?

---

## Risks

1. **Catalog bloat in prompts.** Mitigation: query demand-driven top-N entries instead of injecting the whole catalog.
2. **Permission confusion.** Mitigation: label readiness as advisory and link to the existing agent/authority detail pages for execution truth.
3. **Hardcoded descriptor drift.** Mitigation: centralize native descriptors in one shared module and test catalog rendering against it.
4. **Security regression for MCP stdio.** Mitigation: keep existing sandbox/stdio restrictions and expose blocked posture as readiness, not as executable.
5. **Over-modeling too early.** Mitigation: start with a read model; add tables only after usage proves the shape.
