# EP-GOVERN-003: Agent RBAC, Action Audit & Authority Visualization

**Status:** Draft (2026-03-26)
**Predecessor:** EP-GOVERN-002 (Tool Evaluation Pipeline), EP-PROCESS-001 (Process Observer), Unified MCP Coworker Design (2026-03-16)

## Problem Statement

The platform has 45 agents across 8 value streams with declarative `tool_grants` in `agent_registry.json`, 6 human roles with authority domains in `role_registry.json`, and a governance profile system (`AgentGovernanceProfile`, `DelegationGrant`). But three critical gaps make this governance framework incomplete:

1. **Tool grants are documentation, not enforcement.** `getAvailableTools()` in `mcp-tools.ts:997` filters by USER `platformRole` only. All agent personas share the same tool pool. AGT-190 (Security Auditor) can invoke `create_backlog_item` — a tool outside its declared grants. The `tool_grants` array in `agent_registry.json` is never loaded or checked at runtime.

2. **Immediate tool calls leave no audit trail.** Only proposals (`executionMode: "proposal"`) create `AgentActionProposal` records. When an agent executes an immediate tool (e.g., `query_backlog`, `create_backlog_item`, `search_public_web`), the call happens in `agentic-loop.ts:336-348`, is held in memory, and is discarded after the response. No database record is created. Impossible queries: "What did AGT-190 do last week?" or "Who created backlog items via agents?"

3. **Humans cannot understand the authority model.** The `/platform/ai` page shows agents with capability classes and autonomy levels, but not their individual tool grants, HITL tiers, escalation paths, or how user roles intersect with agent capabilities to produce effective permissions. There is no "who can do what" matrix, no delegation chain visualization, and no way to see what agents HAVE done vs. what they CAN do.

### What Already Exists

- **Agent Governance** — `AgentGovernanceProfile` model with `capabilityClassId`, `autonomyLevel`, `hitlPolicy`, `maxDelegationRiskBand`
- **Delegation Grants** — `DelegationGrant` model with grantor, grantee, scope, risk band, expiry, use count
- **Action Proposals** — `AgentActionProposal` model tracking proposed/approved/rejected/executed actions
- **Route Decision Log** — `/platform/ai/routing` with detailed scoring, candidates, exclusion reasons
- **Action History** — `/platform/ai/history` with filterable proposal table and expandable details
- **Governance Overview** — `GovernanceOverviewPanel` showing teams, governed agents, active grants, pending approvals
- **Permissions System** — `CapabilityKey` type with 24 keys, `can()` function, `PERMISSIONS` record mapping roles to capabilities
- **Role Registry** — 6 human roles (HR-000 through HR-500) with authority domains, HITL tiers, escalation SLAs
- **Agent Registry** — 45 agents with `tool_grants`, `hitl_tier_default`, `delegates_to`, `escalates_to`, `human_supervisor_id`
- **Platform Tool Registry** — ~55 tools in `PLATFORM_TOOLS` with `requiredCapability`, `executionMode`, `sideEffect`

---

## Design

### Section 1: ToolExecution Model (Action Audit)

Every tool call — not just proposals — must be recorded. A new `ToolExecution` table captures the complete audit trail.

```typescript
// Prisma model
model ToolExecution {
  id              String    @id @default(cuid())
  threadId        String
  agentId         String                          // Which agent persona made the call
  userId          String                          // Which human triggered the conversation
  toolName        String                          // Platform tool name
  parameters      Json                            // Tool input parameters
  result          Json                            // ToolResult (success, error, entityId, message)
  success         Boolean                         // Quick filter: did it succeed?
  executionMode   String                          // "immediate" | "proposal"
  routeContext    String?                         // Page context (e.g., "/ops", "/platform")
  durationMs      Int?                            // Execution time
  createdAt       DateTime  @default(now())

  @@index([agentId, createdAt])
  @@index([userId, createdAt])
  @@index([toolName, createdAt])
  @@index([threadId])
}
```

**Integration point:** Insert in `agentic-loop.ts` immediately after `executeTool()` returns (line ~339):

```typescript
const toolResult = await executeTool(tc.name, tc.arguments, userId, context);

// NEW: Persist every tool execution for audit trail
prisma.toolExecution.create({
  data: {
    threadId,
    agentId: context.agentId ?? "unknown",
    userId,
    toolName: tc.name,
    parameters: tc.arguments as Prisma.InputJsonValue,
    result: toolResult as unknown as Prisma.InputJsonValue,
    success: toolResult.success,
    executionMode: tool?.sideEffect ? "proposal" : "immediate",
    routeContext: context.routeContext,
    durationMs: Date.now() - startMs,
  },
}).catch(() => {}); // Fire-and-forget, never blocks response
```

This is the same fire-and-forget pattern used by `logBuildActivity()` (`mcp-tools.ts:1027`) and `storeConversationMemory()`.

---

### Section 2: Agent-Scoped Tool Filtering (RBAC Enforcement)

`getAvailableTools()` must filter by **both** user role AND agent tool grants, producing **effective permissions** — the intersection of what the user is allowed to do and what the agent is allowed to do.

**Change to `getAvailableTools()` in `mcp-tools.ts`:**

```typescript
export async function getAvailableTools(
  userContext: UserContext,
  options?: {
    externalAccessEnabled?: boolean;
    mode?: "advise" | "act";
    unifiedMode?: boolean;
    agentId?: string;              // NEW: agent identity for tool_grants filtering
  },
): Promise<ToolDefinition[]> {
  let platformTools = PLATFORM_TOOLS.filter(
    (tool) =>
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );

  // NEW: Agent-scoped filtering
  if (options?.agentId) {
    const agentGrants = await getAgentToolGrants(options.agentId);
    if (agentGrants) {
      platformTools = platformTools.filter(
        (tool) => agentGrants.includes(toolToGrant(tool.name)),
      );
    }
  }

  // ... existing MCP server tool loading ...
}
```

**Tool grant mapping:** Platform tool names (e.g., `create_backlog_item`) must map to agent grant names (e.g., `backlog_write`). A mapping table bridges the two naming conventions:

```typescript
const TOOL_TO_GRANT: Record<string, string> = {
  create_backlog_item: "backlog_write",
  update_backlog_item: "backlog_write",
  query_backlog: "backlog_read",
  create_digital_product: "registry_write",
  report_quality_issue: "backlog_write",
  search_public_web: "web_search",
  evaluate_tool: "tool_evaluation_create",
  // ... complete mapping for all ~55 platform tools
};

function toolToGrant(toolName: string): string {
  return TOOL_TO_GRANT[toolName] ?? toolName;
}
```

**Agent grant loading:** Read from `agent_registry.json` (cached):

```typescript
import agentRegistry from "@dpf/db/data/agent_registry.json";

const grantCache = new Map<string, string[]>();

export function getAgentToolGrants(agentId: string): string[] | null {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;
  const agent = agentRegistry.agents.find((a) => a.agent_id === agentId);
  if (!agent) return null;
  const grants = agent.config_profile.tool_grants;
  grantCache.set(agentId, grants);
  return grants;
}
```

**Caller change in `agent-coworker.ts`:** Pass `agentId` when calling `getAvailableTools()`:

```typescript
const tools = await getAvailableTools(
  { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
  { externalAccessEnabled, mode, unifiedMode, agentId: agent.agentId },
);
```

---

### Section 3: Effective Permissions Computation

The intersection of user capabilities and agent tool grants produces **effective permissions** — what can actually happen in a given conversation context.

```typescript
type EffectivePermission = {
  toolName: string;
  toolDescription: string;
  userAllowed: boolean;           // User's role grants this capability
  agentAllowed: boolean;          // Agent's tool_grants include this
  effective: boolean;             // Both allowed = can execute
  executionMode: "immediate" | "proposal";
  requiresHitl: boolean;         // HITL tier requires human approval
};

export function computeEffectivePermissions(
  userContext: UserContext,
  agentId: string,
): EffectivePermission[] {
  const agentGrants = getAgentToolGrants(agentId);

  return PLATFORM_TOOLS.map((tool) => {
    const userAllowed = tool.requiredCapability === null
      || can(userContext, tool.requiredCapability);
    const agentAllowed = !agentGrants
      || agentGrants.includes(toolToGrant(tool.name));

    return {
      toolName: tool.name,
      toolDescription: tool.description,
      userAllowed,
      agentAllowed,
      effective: userAllowed && agentAllowed,
      executionMode: tool.sideEffect ? "proposal" : "immediate",
      requiresHitl: tool.sideEffect === true,
    };
  });
}
```

---

### Section 4: Authority Dashboard — "Who Can Do What"

A new page at `/platform/ai/authority` with three views:

#### View 1: Authority Matrix (Heatmap)

A grid where **rows = agents** and **columns = tool categories**, cells color-coded by access level:

| | Backlog | Registry | Architecture | Finance | Compliance | Security | Deployment |
|---|---|---|---|---|---|---|---|
| **AGT-ORCH-000** (COO) | read | read/write | read | read | - | - | - |
| **AGT-112** (Gap Analysis) | read | read | - | - | - | search | - |
| **AGT-190** (Security Auditor) | read | - | - | - | - | scan/audit | - |
| **AGT-131** (SBOM Mgmt) | read | - | - | - | - | - | sandbox |

Color coding:
- Dark green = read + write + execute
- Light green = read only
- Yellow = requires HITL approval
- Gray = no access
- Red outline = grant exists but user role blocks it (mismatch)

**Interaction:** Click any cell to see the specific tools and their effective permission status. Filter by value stream, tier, or role.

#### View 2: Delegation Chain Graph

Interactive visualization showing:
- Human roles (HR-000 through HR-500) as top-level nodes
- Orchestrator agents as mid-level nodes
- Specialist agents as leaf nodes
- Edges labeled with: HITL tier, escalation SLA, delegation risk band
- Color-coded by autonomy level (full, supervised, governance-pending)

Pattern: Teleport's visual RBAC graph — interactive, zoomable, click-to-inspect.

#### View 3: Effective Permissions Inspector

Select a **user role + agent persona** combination and see:
- All tools the combination CAN access (green)
- Tools the USER can access but the AGENT cannot (yellow — "user blocked by agent scope")
- Tools the AGENT has grants for but the USER's role doesn't include (orange — "agent blocked by user role")
- Tools neither can access (gray)

This is the AWS IAM Access Analyzer pattern applied to the human+agent authority model.

---

### Section 5: Action Audit Dashboard — "Who Did What"

Extend the existing `/platform/ai/history` page with two new tabs:

#### Tab 1: Action History (existing)
The current `ProposalHistoryClient` — proposals with status, filtering, expandable details.

#### Tab 2: Tool Execution Log (new)
All tool calls from `ToolExecution` table:
- Filterable by: agent, user, tool, time range, success/failure
- Columns: Time, Agent, User, Tool, Success, Duration, Route Context
- Expandable rows showing: parameters (JSON), result (JSON), linked proposal (if any)
- Summary stats: Total calls, Success rate, Avg duration, Most active agent, Most used tool

#### Tab 3: Authority Timeline (new)
Chronological view of authority-related events:
- Delegation grants created/revoked
- Permission changes (role assignments)
- HITL approvals/rejections
- Tool evaluation approvals
- Agent governance profile changes

Pattern: Langfuse trace timeline with span-based display.

---

### Section 6: Agent Identity Card Enhancement

Extend the existing `AgentGovernanceCard` on `/platform/ai` to show:

**Currently shown:** capability class, autonomy level, owning team, active grant count, portfolio assignment

**Add:**
- **Tool grants badge** — count of granted tools, clickable to expand full list
- **HITL tier indicator** — visual level (0=executive, 1=manager, 2=auto, 3=info)
- **Escalation path** — "Escalates to: HR-300 (Enterprise Architect) — 24h SLA"
- **Supervisor link** — clickable link to the supervising human role
- **Recent activity summary** — "12 tool calls in last 24h, 2 proposals pending"
- **Effective permission count** — "Can use 8 of 55 platform tools" (scoped to a selected user role)

---

### Section 7: Proposal Validation Enhancement

When an agent creates a proposal, validate that the agent's `tool_grants` include the proposed action:

```typescript
// In agent-coworker.ts, proposal creation flow:
const agentGrants = getAgentToolGrants(agent.agentId);
if (agentGrants && !agentGrants.includes(toolToGrant(tc.name))) {
  // Agent is proposing a tool outside its grants
  // Log violation, still create proposal but flag it
  await prisma.toolExecution.create({
    data: {
      ...baseData,
      toolName: tc.name,
      success: false,
      result: { error: "agent_grant_violation", message: `Agent ${agent.agentId} lacks grant for ${tc.name}` },
    },
  });
}
```

This doesn't block the proposal (the human approver may still have authority), but creates an audit record of the violation for governance review.

---

### Section 8: Research & Benchmarking

Per AGENTS.md design research requirements:

**Open-source:**
- **Langfuse** (MIT) — Agent trace visualization with span-based timelines, tool call rendering. Adopted: timeline pattern for Authority Timeline tab. Not adopted: full observability stack (overkill for this scope).
- **Mission Control** (MIT, builderz-labs) — AI agent dashboard with RBAC (viewer/operator/admin), 31 panels. Adopted: role-scoped dashboard views. Differentiator: our system handles mixed human+agent authority, not just agent-only.
- **Tremor** (Apache 2.0) — React dashboard components with Tailwind. Adopted: heatmap and chart patterns for Authority Matrix.

**Commercial:**
- **AWS IAM Access Analyzer** — Effective permissions as intersection of all policies, unused permission detection. Adopted: effective permissions computation model (Section 3). Differentiator: IAM is identity-only; ours combines identity (user role) + agent scope (tool grants).
- **Teleport Visual RBAC Graph** — Interactive graph rendering complex role bindings. Adopted: delegation chain visualization pattern (Section 4 View 2). Differentiator: Teleport is infrastructure-focused; ours visualizes human-to-agent delegation.
- **AptlyDone Delegation of Authority** — Authority matrix with thresholds and escalation for mixed human+agent systems. Adopted: delegation chain concept with risk bands. Differentiator: ours integrates with IT4IT value streams and Diversity of Thought framework.
- **Kovrr AI Governance Suite** — Multi-panel dashboard (Apps Snapshot, Assets Chart, Risk Scenarios). Adopted: summary panel layout for governance overview.
- **AvePoint AgentPulse** — Unified agent discovery with risk flagging. Adopted: real-time risk badge pattern for agent cards.

**Key differentiator:** No existing tool computes effective permissions as the intersection of human RBAC + agent tool grants + HITL tier requirements. This is the novel contribution — visualizing what can happen when a specific human talks to a specific agent, accounting for both authority systems.

---

## New & Modified Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `apps/web/lib/tool-execution-data.ts` | ToolExecution Prisma queries, effective permissions computation |
| Create | `apps/web/lib/agent-grants.ts` | Agent grant loading, tool-to-grant mapping, effective permissions |
| Create | `apps/web/app/(shell)/platform/ai/authority/page.tsx` | Authority Dashboard server component |
| Create | `apps/web/components/platform/AuthorityMatrixPanel.tsx` | Heatmap grid: agents x tool categories |
| Create | `apps/web/components/platform/DelegationChainGraph.tsx` | Interactive delegation/escalation graph |
| Create | `apps/web/components/platform/EffectivePermissionsInspector.tsx` | Role + agent effective permissions view |
| Create | `apps/web/components/platform/ToolExecutionLogClient.tsx` | Filterable tool execution audit log |
| Create | `apps/web/components/platform/AuthorityTimelineClient.tsx` | Chronological authority event timeline |
| Modify | `packages/db/prisma/schema.prisma` | Add `ToolExecution` model |
| Modify | `apps/web/lib/agentic-loop.ts` | Insert `ToolExecution` record after every `executeTool()` call |
| Modify | `apps/web/lib/mcp-tools.ts` | Add `agentId` parameter to `getAvailableTools()`, agent-scoped filtering |
| Modify | `apps/web/lib/actions/agent-coworker.ts` | Pass `agentId` to `getAvailableTools()`, proposal grant validation |
| Modify | `apps/web/components/platform/AgentGovernanceCard.tsx` | Add tool grants badge, HITL tier, escalation path, recent activity |
| Modify | `apps/web/app/(shell)/platform/ai/history/page.tsx` | Add Tool Execution Log and Authority Timeline tabs |

---

## Acceptance Criteria

1. `ToolExecution` table records every tool call with agentId, userId, parameters, result, and timestamp
2. `getAvailableTools()` accepts `agentId` and filters by agent `tool_grants` from `agent_registry.json`
3. Effective permissions computed as intersection of user capabilities AND agent tool grants
4. Agent proposals for tools outside their grants are flagged (logged, not blocked)
5. Authority Matrix heatmap renders agents x tool categories with color-coded access levels
6. Delegation Chain Graph shows human roles → orchestrators → specialists with HITL tiers and SLAs
7. Effective Permissions Inspector shows combined view for any user role + agent pair
8. Tool Execution Log is filterable by agent, user, tool, time range, success/failure
9. Authority Timeline shows delegation grants, permission changes, HITL approvals chronologically
10. Agent Governance Card shows tool grant count, HITL tier, escalation path, recent activity
11. Queries answerable: "What did AGT-190 do last week?", "What did HR-300 approve?", "Which agents can create backlog items?"
12. Fire-and-forget audit recording never blocks the response path
13. No regression in existing proposal flow or action history page

---

## End-to-End Flow

```text
User (HR-200, Digital Product Manager) opens /ops page
  → AI Coworker resolves: Scrum Master agent
  → User asks: "Create a backlog item for the login bug"

1. getAvailableTools({ platformRole: "HR-200" }, { agentId: "AGT-OPS-SM" })
   → USER filter: HR-200 can manage_backlog ✓
   → AGENT filter: AGT-OPS-SM has "backlog_write" grant ✓
   → create_backlog_item is in effective permissions ✓

2. Agent calls create_backlog_item (immediate tool)
   → executeTool() runs → backlog item created
   → ToolExecution record created (fire-and-forget):
     { agentId: "AGT-OPS-SM", userId: "usr_123", toolName: "create_backlog_item",
       parameters: { title: "Login bug" }, success: true, durationMs: 45 }

3. Later, HR-300 (Enterprise Architect) opens /platform/ai/authority
   → Authority Matrix shows AGT-OPS-SM row with green cells for backlog tools
   → Clicks AGT-OPS-SM row → sees 8 granted tools, HITL tier 2, escalates to HR-200
   → Switches to Tool Execution Log tab
   → Filters by agentId = AGT-OPS-SM, last 7 days
   → Sees: 47 tool calls, 45 successful, 2 failed, most used: query_backlog (28x)

4. HR-300 opens Effective Permissions Inspector
   → Selects: User Role = HR-400 (ITFM Director), Agent = AGT-190 (Security Auditor)
   → Sees: 3 effective tools (tool_evaluation_read, vulnerability_scan, finding_create)
   → Notes: AGT-190 has "credential_scan" grant but HR-400 lacks "manage_tool_evaluations"
     → Orange cell: "agent blocked by user role"
   → This confirms: ITFM Director cannot trigger security scans — only HR-300 can
```
