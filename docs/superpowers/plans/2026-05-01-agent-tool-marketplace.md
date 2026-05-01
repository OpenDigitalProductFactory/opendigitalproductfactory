# Agent Tool Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a governed marketplace/readiness layer for DPF-known agent tools so humans and coworkers can see which tools exist, what they unlock, and what setup or grants are missing.

**Architecture:** Start with a read model over existing tables rather than a new canonical table. Refactor native integration descriptors into one shared module, add a server-side readiness resolver, expose it through a new `search_tool_marketplace` platform tool, and update `/platform/tools/catalog` to show readiness and next actions.

**Tech Stack:** Next.js 16 app router, TypeScript, Prisma, Vitest, server actions, existing DPF MCP tool definitions, DPF CSS custom properties.

---

## File Structure

- Create `apps/web/lib/tools/native-integration-catalog.ts`: shared descriptors for native integrations currently hardcoded in catalog and integration pages.
- Create `apps/web/lib/tools/tool-marketplace-readiness.ts`: server-side resolver and types for marketplace entries/readiness.
- Create `apps/web/lib/tools/tool-marketplace-readiness.test.ts`: focused resolver tests.
- Modify `apps/web/lib/actions/connection-catalog.ts`: replace local native descriptor list with shared catalog and pass readiness fields through.
- Modify `apps/web/lib/actions/connection-catalog.test.ts`: update expected counts/readiness fields.
- Modify `apps/web/lib/mcp-tools.ts`: add `search_tool_marketplace` tool definition and execution handler.
- Modify `apps/web/lib/mcp-tools-integrations.test.ts`: add marketplace tool tests beside `search_integrations`.
- Modify `apps/web/lib/tak/agent-grants.ts`: add grant mapping for `search_tool_marketplace`.
- Modify `apps/web/app/(shell)/platform/tools/catalog/page.tsx`: rename presentation from connection catalog to agent tool marketplace and display readiness badges/next action.
- Modify `apps/web/app/(shell)/platform/tools/catalog/page.test.tsx`: assert readiness UI.
- Modify `apps/web/lib/actions/agent-coworker.ts`: replace broad unavailable-service prompt hint with demand-relevant marketplace guidance.
- Test command for all source changes: `pnpm --filter web exec vitest run lib/tools/tool-marketplace-readiness.test.ts lib/actions/connection-catalog.test.ts lib/mcp-tools-integrations.test.ts app/(shell)/platform/tools/catalog/page.test.tsx`.
- Typecheck command before commit: `pnpm --filter web typecheck`.

---

### Task 1: Shared Native Integration Catalog

**Files:**
- Create: `apps/web/lib/tools/native-integration-catalog.ts`
- Modify: `apps/web/lib/actions/connection-catalog.ts`
- Test: `apps/web/lib/actions/connection-catalog.test.ts`

- [ ] **Step 1: Write the shared descriptor module**

Create `apps/web/lib/tools/native-integration-catalog.ts`:

```ts
export type NativeIntegrationId =
  | "adp"
  | "quickbooks"
  | "stripe"
  | "microsoft365"
  | "hubspot"
  | "google"
  | "facebook"
  | "mailchimp";

export type NativeIntegrationDescriptor = {
  id: NativeIntegrationId;
  integrationId: string;
  provider: NativeIntegrationId;
  name: string;
  description: string;
  href: string;
  category: string;
  pricingModel: "paid";
  model: "native";
  tags: string[];
  enables: string[];
  relevantAgentIds: string[];
  requiredGrantKeys: string[];
};

export const NATIVE_INTEGRATIONS: NativeIntegrationDescriptor[] = [
  {
    id: "adp",
    integrationId: "adp-workforce-now",
    provider: "adp",
    name: "ADP Workforce Now",
    description: "Payroll and workforce anchor using the dedicated ADP runtime and enterprise credential custody.",
    href: "/platform/tools/integrations/adp",
    category: "hr",
    pricingModel: "paid",
    model: "native",
    tags: ["hr", "payroll", "workforce", "workers", "pay statements"],
    enables: ["Worker lookup", "Pay statement context", "Time card context", "Deduction questions", "Payroll guidance"],
    relevantAgentIds: ["finance-controller", "hr-specialist", "coo"],
    requiredGrantKeys: ["consumer_read"],
  },
  {
    id: "quickbooks",
    integrationId: "quickbooks-online-accounting",
    provider: "quickbooks",
    name: "QuickBooks Online",
    description: "Finance anchor for company, customer, and invoice context on the native integration substrate.",
    href: "/platform/tools/integrations/quickbooks",
    category: "finance",
    pricingModel: "paid",
    model: "native",
    tags: ["finance", "accounting", "invoices", "customers", "ledger"],
    enables: ["Company context", "Customer context", "Invoice context", "Accounting previews"],
    relevantAgentIds: ["finance-controller", "coo"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "stripe",
    integrationId: "stripe-billing-payments",
    provider: "stripe",
    name: "Stripe Billing & Payments",
    description: "Payments anchor for balance, customer, invoice, and payment-intent context on the enterprise substrate.",
    href: "/platform/tools/integrations/stripe",
    category: "payments",
    pricingModel: "paid",
    model: "native",
    tags: ["payments", "billing", "stripe", "invoices"],
    enables: ["Payment balance context", "Customer payment context", "Payment-intent context"],
    relevantAgentIds: ["finance-controller", "customer-advisor", "coo"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "microsoft365",
    integrationId: "microsoft365-communications",
    provider: "microsoft365",
    name: "Microsoft 365 Communications",
    description: "Communications anchor for inbox, calendar, Teams, channels, and recent message context.",
    href: "/platform/tools/integrations/microsoft365-communications",
    category: "communications",
    pricingModel: "paid",
    model: "native",
    tags: ["email", "calendar", "teams", "communications"],
    enables: ["Inbox context", "Calendar context", "Teams context", "Channel context"],
    relevantAgentIds: ["admin-assistant", "coo", "ops-coordinator"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "hubspot",
    integrationId: "hubspot-crm-marketing",
    provider: "hubspot",
    name: "HubSpot CRM & Marketing",
    description: "Marketing and CRM anchor for account details, contacts, and lead-capture forms.",
    href: "/platform/tools/integrations/hubspot",
    category: "marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["crm", "marketing", "contacts", "leads"],
    enables: ["Account context", "Contact context", "Lead form context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "google",
    integrationId: "google-marketing-intelligence",
    provider: "google",
    name: "Google Marketing Intelligence",
    description: "Read-first GA4 and Search Console anchor for traffic, conversions, and search visibility.",
    href: "/platform/tools/integrations/google-marketing-intelligence",
    category: "marketing-intelligence",
    pricingModel: "paid",
    model: "native",
    tags: ["google", "analytics", "search console", "traffic"],
    enables: ["Traffic context", "Conversion context", "Search visibility context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "facebook",
    integrationId: "facebook-lead-ads",
    provider: "facebook",
    name: "Facebook Lead Ads",
    description: "Localized lead-capture anchor for page forms, recent submissions, and downstream CRM follow-up.",
    href: "/platform/tools/integrations/facebook-lead-ads",
    category: "lead-capture",
    pricingModel: "paid",
    model: "native",
    tags: ["facebook", "lead ads", "leads", "forms"],
    enables: ["Lead form context", "Recent submission context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "mailchimp",
    integrationId: "mailchimp-marketing",
    provider: "mailchimp",
    name: "Mailchimp Marketing",
    description: "Email marketing anchor for audiences, recent campaigns, and approved customer outreach context.",
    href: "/platform/tools/integrations/mailchimp",
    category: "email-marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["email", "marketing", "campaigns", "audiences"],
    enables: ["Audience context", "Campaign context", "Outreach context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
];

export function getNativeIntegrationIds(): NativeIntegrationId[] {
  return NATIVE_INTEGRATIONS.map((integration) => integration.id);
}
```

- [ ] **Step 2: Run the existing catalog tests before wiring**

Run: `pnpm --filter web exec vitest run lib/actions/connection-catalog.test.ts`

Expected: PASS before the refactor, confirming the baseline behavior.

- [ ] **Step 3: Update connection catalog imports**

In `apps/web/lib/actions/connection-catalog.ts`, remove the local `NativeIntegrationId`, `NativeIntegrationDescriptor`, and `NATIVE_INTEGRATIONS` definitions. Add:

```ts
import {
  NATIVE_INTEGRATIONS,
  getNativeIntegrationIds,
  type NativeIntegrationId,
} from "@/lib/tools/native-integration-catalog";
```

Change the native credential query to:

```ts
prisma.integrationCredential.findMany({
  where: { provider: { in: getNativeIntegrationIds() } },
  select: { provider: true, status: true },
}),
```

- [ ] **Step 4: Verify the connection catalog test still passes**

Run: `pnpm --filter web exec vitest run lib/actions/connection-catalog.test.ts`

Expected: PASS. If the count changes from 4 to 10 because all native descriptors are now included, update the test expectation in the next step.

- [ ] **Step 5: Update the test expectations for all native descriptors**

In `apps/web/lib/actions/connection-catalog.test.ts`, change:

```ts
expect(result.totalCount).toBe(4);
expect(result.counts).toEqual({ mcp: 1, native: 2, builtIn: 1 });
```

to:

```ts
expect(result.totalCount).toBe(10);
expect(result.counts).toEqual({ mcp: 1, native: 8, builtIn: 1 });
```

Keep the ADP and QuickBooks assertions to prove configured/error state still maps correctly.

- [ ] **Step 6: Run focused verification**

Run: `pnpm --filter web exec vitest run lib/actions/connection-catalog.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/tools/native-integration-catalog.ts apps/web/lib/actions/connection-catalog.ts apps/web/lib/actions/connection-catalog.test.ts
git commit -s -m "refactor: share native integration catalog descriptors"
```

---

### Task 2: Tool Marketplace Readiness Resolver

**Files:**
- Create: `apps/web/lib/tools/tool-marketplace-readiness.ts`
- Create: `apps/web/lib/tools/tool-marketplace-readiness.test.ts`
- Modify: `apps/web/lib/actions/connection-catalog.ts`

- [ ] **Step 1: Write resolver tests**

Create `apps/web/lib/tools/tool-marketplace-readiness.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: { findMany: vi.fn() },
    mcpIntegration: { findMany: vi.fn() },
    mcpServer: { findMany: vi.fn() },
    mcpServerTool: { findMany: vi.fn() },
    modelProvider: { findMany: vi.fn() },
    taskRequirement: { findUnique: vi.fn() },
    agent: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/actions/built-in-tools", () => ({
  getBuiltInToolsOverview: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { listToolMarketplaceEntries } from "./tool-marketplace-readiness";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.integrationCredential.findMany).mockResolvedValue([
    { provider: "adp", status: "connected" },
    { provider: "quickbooks", status: "error" },
  ] as never);
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
    {
      id: "mcp-1",
      slug: "stripe",
      name: "Stripe MCP",
      vendor: "Stripe",
      shortDescription: "Payments MCP",
      category: "finance",
      pricingModel: "paid",
      isVerified: true,
      documentationUrl: "https://example.com",
      tags: ["payments"],
      status: "active",
    },
  ] as never);
  vi.mocked(prisma.mcpServer.findMany).mockResolvedValue([
    { id: "server-1", serverId: "stripe", integrationId: "mcp-1", status: "active", healthStatus: "healthy" },
  ] as never);
  vi.mocked(prisma.mcpServerTool.findMany).mockResolvedValue([
    { toolName: "create_payment", description: "Create payment", server: { serverId: "stripe", integrationId: "mcp-1", status: "active", healthStatus: "healthy" } },
  ] as never);
  vi.mocked(prisma.agent.findFirst).mockResolvedValue({
    agentId: "finance-controller",
    slugId: "finance-controller",
    toolGrants: [{ grantKey: "registry_read" }],
  } as never);
  vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([
    { providerId: "anthropic", name: "Anthropic", status: "active", supportsToolUse: true, capabilityTier: "frontier", modelProfiles: [{ modelId: "claude-sonnet", friendlyName: "Claude Sonnet", modelStatus: "active", supportsToolUse: true }] },
  ] as never);
  vi.mocked(getBuiltInToolsOverview).mockResolvedValue({
    tools: [{ id: "brave-search", name: "Brave Search", description: "Public web search", model: "built-in", configKey: "brave_search_api_key", configured: false, capability: "search_public_web" }],
    keyData: { brave_search_api_key: { configured: false, currentValue: null } },
  });
});

describe("listToolMarketplaceEntries", () => {
  it("marks native integrations as ready or needing attention from credential state", async () => {
    const entries = await listToolMarketplaceEntries({ query: "payroll", agentId: "finance-controller" });
    const adp = entries.find((entry) => entry.id === "native:adp");

    expect(adp).toMatchObject({
      name: "ADP Workforce Now",
      kind: "native_integration",
      readiness: "configured_not_granted",
    });
    expect(adp?.readinessReason).toContain("missing grant");
  });

  it("includes activated MCP runtime tools as ready when healthy", async () => {
    const entries = await listToolMarketplaceEntries({ query: "payment", agentId: "finance-controller" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp-tool:stripe:create_payment",
          kind: "mcp_runtime",
          readiness: "ready",
        }),
      ]),
    );
  });

  it("marks built-in tools that need local config as needs_setup", async () => {
    const entries = await listToolMarketplaceEntries({ query: "search" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "built-in:brave-search",
          readiness: "needs_setup",
        }),
      ]),
    );
  });

  it("includes Build Studio model capability readiness", async () => {
    const entries = await listToolMarketplaceEntries({ taskType: "code-gen" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "model-capability:code-gen",
          readiness: "ready",
        }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/tools/tool-marketplace-readiness.test.ts`

Expected: FAIL because `tool-marketplace-readiness.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/web/lib/tools/tool-marketplace-readiness.ts`:

```ts
import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { NATIVE_INTEGRATIONS } from "./native-integration-catalog";

export type ToolMarketplaceKind =
  | "mcp_catalog"
  | "mcp_runtime"
  | "native_integration"
  | "built_in"
  | "model_capability";

export type ToolMarketplaceReadiness =
  | "available"
  | "needs_setup"
  | "needs_grant"
  | "configured_not_granted"
  | "granted_unavailable"
  | "ready"
  | "unsupported"
  | "retired";

export type ToolMarketplaceEntry = {
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
  nextAction: string;
  enables: string[];
  trustPosture: {
    source: "native" | "official_registry" | "approved_registry" | "built_in" | "model_catalog";
    verified: boolean;
    audit: string[];
    riskBand?: string;
  };
};

export type ToolMarketplaceQuery = {
  query?: string;
  category?: string;
  agentId?: string;
  kind?: ToolMarketplaceKind;
  readiness?: ToolMarketplaceReadiness;
  taskType?: string;
  limit?: number;
};

function includesQuery(entry: ToolMarketplaceEntry, query?: string): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return [
    entry.name,
    entry.description,
    entry.category,
    entry.provider ?? "",
    entry.tags.join(" "),
    entry.enables.join(" "),
  ].join(" ").toLowerCase().includes(q);
}

async function getAgentGrants(agentId?: string): Promise<Set<string>> {
  if (!agentId) return new Set();
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId }, { slugId: agentId }] },
    select: { toolGrants: { select: { grantKey: true } } },
  });
  return new Set(agent?.toolGrants.map((grant) => grant.grantKey) ?? []);
}

function hasRequiredGrant(requiredGrantKeys: string[], grants: Set<string>): boolean {
  if (requiredGrantKeys.length === 0) return true;
  return requiredGrantKeys.some((grant) => grants.has(grant));
}

function nativeReadiness(status: string | undefined, requiredGrantKeys: string[], grants: Set<string>, scopedToAgent: boolean) {
  if (status !== "connected") {
    return {
      readiness: "needs_setup" as const,
      readinessReason: status === "error" ? "Connection exists but needs operator attention." : "Integration credentials are not configured.",
      nextAction: "Configure the native integration.",
    };
  }
  if (scopedToAgent && !hasRequiredGrant(requiredGrantKeys, grants)) {
    return {
      readiness: "configured_not_granted" as const,
      readinessReason: `Integration is configured, but this coworker is missing grant ${requiredGrantKeys.join(" or ")}.`,
      nextAction: "Review the coworker grants or authority binding.",
    };
  }
  return {
    readiness: "ready" as const,
    readinessReason: "Integration is configured and ready for this context.",
    nextAction: "Use the integration from the relevant coworker flow.",
  };
}

async function nativeEntries(query: ToolMarketplaceQuery, grants: Set<string>): Promise<ToolMarketplaceEntry[]> {
  const credentials = await prisma.integrationCredential.findMany({
    where: { provider: { in: NATIVE_INTEGRATIONS.map((entry) => entry.provider) } },
    select: { provider: true, status: true },
  });
  const statusByProvider = new Map(credentials.map((credential) => [credential.provider, credential.status]));

  return NATIVE_INTEGRATIONS.map((integration) => {
    const readiness = nativeReadiness(
      statusByProvider.get(integration.provider),
      integration.requiredGrantKeys,
      grants,
      Boolean(query.agentId),
    );
    return {
      id: `native:${integration.id}`,
      kind: "native_integration",
      name: integration.name,
      description: integration.description,
      category: integration.category,
      tags: integration.tags,
      provider: integration.provider,
      setupHref: integration.href,
      relevantAgentIds: integration.relevantAgentIds,
      requiredGrantKeys: integration.requiredGrantKeys,
      requiredCapabilities: [],
      enables: integration.enables,
      trustPosture: { source: "native", verified: true, audit: ["IntegrationCredential", "IntegrationToolCallLog"] },
      ...readiness,
    } satisfies ToolMarketplaceEntry;
  });
}

async function builtInEntries(): Promise<ToolMarketplaceEntry[]> {
  const overview = await getBuiltInToolsOverview();
  return overview.tools.map((tool) => ({
    id: `built-in:${tool.id}`,
    kind: "built_in",
    name: tool.name,
    description: tool.description,
    category: "built-in",
    tags: [tool.id, tool.capability],
    setupHref: "/platform/tools/built-ins",
    relevantAgentIds: [],
    requiredGrantKeys: [],
    requiredCapabilities: [tool.capability],
    readiness: tool.configured ? "ready" : "needs_setup",
    readinessReason: tool.configured ? "Built-in tool is configured." : "Built-in tool requires local configuration.",
    nextAction: tool.configured ? "Use the built-in tool." : "Configure the built-in tool.",
    enables: [tool.description],
    trustPosture: { source: "built_in", verified: true, audit: ["ToolExecution"] },
  }));
}

async function mcpEntries(): Promise<ToolMarketplaceEntry[]> {
  const [catalogRows, runtimeTools] = await Promise.all([
    prisma.mcpIntegration.findMany({
      where: { status: "active" },
      select: {
        id: true,
        slug: true,
        name: true,
        vendor: true,
        shortDescription: true,
        category: true,
        pricingModel: true,
        isVerified: true,
        documentationUrl: true,
        tags: true,
      },
      take: 100,
    }),
    prisma.mcpServerTool.findMany({
      where: { isEnabled: true, server: { status: "active", healthStatus: "healthy" } },
      select: {
        toolName: true,
        description: true,
        server: { select: { serverId: true, integrationId: true, status: true, healthStatus: true } },
      },
      take: 100,
    }),
  ]);
  const activeIntegrationIds = new Set(runtimeTools.map((tool) => tool.server.integrationId).filter(Boolean));
  const catalogEntries = catalogRows.map((row) => ({
    id: `mcp:${row.slug}`,
    kind: "mcp_catalog" as const,
    name: row.name,
    description: row.shortDescription ?? "MCP catalog integration.",
    category: row.category,
    tags: row.tags,
    provider: row.vendor ?? undefined,
    docsHref: row.documentationUrl ?? undefined,
    relevantAgentIds: [],
    requiredGrantKeys: [],
    requiredCapabilities: [],
    readiness: activeIntegrationIds.has(row.id) ? "ready" as const : "available" as const,
    readinessReason: activeIntegrationIds.has(row.id) ? "An active healthy MCP service exists." : "Catalog entry is available but not activated.",
    nextAction: activeIntegrationIds.has(row.id) ? "Use the activated MCP service." : "Activate this MCP service.",
    enables: [row.shortDescription ?? row.name],
    trustPosture: { source: "official_registry" as const, verified: row.isVerified, audit: ["McpIntegration", "McpServer"] },
  }));
  const toolEntries = runtimeTools.map((tool) => ({
    id: `mcp-tool:${tool.server.serverId}:${tool.toolName}`,
    kind: "mcp_runtime" as const,
    name: `${tool.server.serverId} / ${tool.toolName}`,
    description: tool.description ?? `Runtime MCP tool from ${tool.server.serverId}.`,
    category: "mcp-runtime",
    tags: [tool.server.serverId, tool.toolName],
    provider: tool.server.serverId,
    relevantAgentIds: [],
    requiredGrantKeys: [],
    requiredCapabilities: [],
    readiness: "ready" as const,
    readinessReason: "MCP server is active, healthy, and tool is enabled.",
    nextAction: "Use this runtime MCP tool where granted.",
    enables: [tool.description ?? tool.toolName],
    trustPosture: { source: "approved_registry" as const, verified: true, audit: ["McpServerTool", "ToolExecution"] },
  }));
  return [...catalogEntries, ...toolEntries];
}

async function modelCapabilityEntries(query: ToolMarketplaceQuery): Promise<ToolMarketplaceEntry[]> {
  const taskType = query.taskType ?? (query.query?.toLowerCase().includes("build") ? "code-gen" : undefined);
  if (!taskType) return [];
  const providers = await prisma.modelProvider.findMany({
    where: { status: { in: ["active", "degraded"] } },
    select: {
      providerId: true,
      name: true,
      capabilityTier: true,
      supportsToolUse: true,
      modelProfiles: {
        where: { modelStatus: "active" },
        select: { modelId: true, supportsToolUse: true },
      },
    },
  });
  const hasEligible = providers.some((provider) =>
    provider.capabilityTier === "frontier" &&
    (provider.supportsToolUse || provider.modelProfiles.some((profile) => profile.supportsToolUse === true)),
  );
  return [{
    id: `model-capability:${taskType}`,
    kind: "model_capability",
    name: taskType === "code-gen" ? "Build Studio code-generation model readiness" : `${taskType} model readiness`,
    description: "Model/provider readiness for high-fidelity agent work.",
    category: "ai-provider",
    tags: ["model", "provider", taskType, "frontier", "tool-use"],
    setupHref: "/platform/ai/assignments",
    relevantAgentIds: ["build-specialist"],
    requiredGrantKeys: [],
    requiredCapabilities: ["frontier", "toolUse"],
    readiness: hasEligible ? "ready" : "needs_setup",
    readinessReason: hasEligible ? "A frontier, tool-capable active model is available." : "No active frontier, tool-capable model was found.",
    nextAction: hasEligible ? "Use Build Studio normally." : "Configure or assign a frontier, tool-capable model.",
    enables: ["Build Studio implementation", "Code generation", "Tool-action workflows"],
    trustPosture: { source: "model_catalog", verified: hasEligible, audit: ["ModelProvider", "ModelProfile", "AgentModelConfig"] },
  }];
}

export async function listToolMarketplaceEntries(query: ToolMarketplaceQuery = {}): Promise<ToolMarketplaceEntry[]> {
  const grants = await getAgentGrants(query.agentId);
  const entries = [
    ...(await nativeEntries(query, grants)),
    ...(await builtInEntries()),
    ...(await mcpEntries()),
    ...(await modelCapabilityEntries(query)),
  ];

  return entries
    .filter((entry) => !query.kind || entry.kind === query.kind)
    .filter((entry) => !query.readiness || entry.readiness === query.readiness)
    .filter((entry) => !query.category || entry.category === query.category)
    .filter((entry) => includesQuery(entry, query.query))
    .slice(0, Math.min(Math.max(query.limit ?? 20, 1), 100));
}
```

- [ ] **Step 4: Run resolver tests**

Run: `pnpm --filter web exec vitest run lib/tools/tool-marketplace-readiness.test.ts`

Expected: PASS.

- [ ] **Step 5: Add readiness fields to connection catalog entries**

In `apps/web/lib/actions/connection-catalog.ts`, import:

```ts
import { listToolMarketplaceEntries } from "@/lib/tools/tool-marketplace-readiness";
```

Add `readiness`, `readinessReason`, and `nextAction` to non-MCP catalog entry types. In `getConnectionCatalog`, call:

```ts
const readinessEntries = await listToolMarketplaceEntries({ query, limit: 100 });
const readinessById = new Map(readinessEntries.map((entry) => [entry.id, entry]));
```

When building native entries, merge:

```ts
const readiness = readinessById.get(`native:${integration.id}`);
```

and add:

```ts
readiness: readiness?.readiness ?? statusLabel,
readinessReason: readiness?.readinessReason ?? "",
nextAction: readiness?.nextAction ?? "",
```

For built-ins use `built-in:${tool.id}`.

- [ ] **Step 6: Run connection catalog tests and adjust mocks**

Run: `pnpm --filter web exec vitest run lib/actions/connection-catalog.test.ts`

Expected: It may fail because `listToolMarketplaceEntries` is not mocked. Add this mock at the top of `connection-catalog.test.ts`:

```ts
vi.mock("@/lib/tools/tool-marketplace-readiness", () => ({
  listToolMarketplaceEntries: vi.fn().mockResolvedValue([]),
}));
```

Run again and expect PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/tools/tool-marketplace-readiness.ts apps/web/lib/tools/tool-marketplace-readiness.test.ts apps/web/lib/actions/connection-catalog.ts apps/web/lib/actions/connection-catalog.test.ts
git commit -s -m "feat: add tool marketplace readiness resolver"
```

---

### Task 3: Platform Tool and Coworker Query Path

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-integrations.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Add failing test for `search_tool_marketplace`**

In `apps/web/lib/mcp-tools-integrations.test.ts`, add a mock:

```ts
vi.mock("@/lib/tools/tool-marketplace-readiness", () => ({
  listToolMarketplaceEntries: vi.fn(),
}));
```

Import after existing imports:

```ts
import { listToolMarketplaceEntries } from "@/lib/tools/tool-marketplace-readiness";
```

Add:

```ts
describe("executeTool — search_tool_marketplace", () => {
  it("returns readiness-aware marketplace results", async () => {
    vi.mocked(listToolMarketplaceEntries).mockResolvedValue([
      {
        id: "native:adp",
        kind: "native_integration",
        name: "ADP Workforce Now",
        description: "Payroll and workforce anchor",
        category: "hr",
        tags: ["payroll"],
        provider: "adp",
        setupHref: "/platform/tools/integrations/adp",
        relevantAgentIds: ["finance-controller"],
        requiredGrantKeys: ["consumer_read"],
        requiredCapabilities: [],
        readiness: "needs_setup",
        readinessReason: "Integration credentials are not configured.",
        nextAction: "Configure the native integration.",
        enables: ["Pay statement context"],
        trustPosture: { source: "native", verified: true, audit: ["IntegrationCredential"] },
      },
    ]);

    const result = await executeTool("search_tool_marketplace", { query: "payroll", agentId: "finance-controller" }, "user-1");
    const data = result.data as { results: Array<{ id: string; readiness: string }> } | undefined;

    expect(result.success).toBe(true);
    expect(data?.results[0]).toMatchObject({ id: "native:adp", readiness: "needs_setup" });
    expect(listToolMarketplaceEntries).toHaveBeenCalledWith(expect.objectContaining({ query: "payroll", agentId: "finance-controller" }));
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter web exec vitest run lib/mcp-tools-integrations.test.ts`

Expected: FAIL because `search_tool_marketplace` is not defined/executed.

- [ ] **Step 3: Add tool definition**

In `apps/web/lib/mcp-tools.ts`, near `search_integrations`, add:

```ts
{
  name: "search_tool_marketplace",
  description: "Search the governed agent tool marketplace across MCP catalog entries, native integrations, built-in tools, and model/provider readiness. Use when the user asks what a coworker can do, what tools are available, or what setup/grant is missing for a task.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Business task or tool need, e.g. payroll, invoices, Build Studio, web search." },
      category: { type: "string", description: "Optional category filter." },
      agentId: { type: "string", description: "Optional coworker id or slug for grant-aware readiness." },
      kind: { type: "string", enum: ["mcp_catalog", "mcp_runtime", "native_integration", "built_in", "model_capability"] },
      readiness: { type: "string", enum: ["available", "needs_setup", "needs_grant", "configured_not_granted", "granted_unavailable", "ready", "unsupported", "retired"] },
      taskType: { type: "string", description: "Optional routing task type, e.g. code-gen or tool-action." },
      limit: { type: "number", description: "Max results to return. Default 10." },
    },
    required: ["query"],
  },
  requiredCapability: null,
  executionMode: "immediate",
  sideEffect: false,
},
```

- [ ] **Step 4: Add grant mapping**

In `apps/web/lib/tak/agent-grants.ts`, near `search_integrations`, add:

```ts
search_tool_marketplace: ["external_registry_search", "registry_read"],
```

- [ ] **Step 5: Add execution handler**

In `apps/web/lib/mcp-tools.ts` near the `search_integrations` handler, add:

```ts
case "search_tool_marketplace": {
  const { listToolMarketplaceEntries } = await import("@/lib/tools/tool-marketplace-readiness");
  const results = await listToolMarketplaceEntries({
    query: String(params["query"] ?? ""),
    category: typeof params["category"] === "string" ? params["category"] : undefined,
    agentId: typeof params["agentId"] === "string" ? params["agentId"] : undefined,
    kind: typeof params["kind"] === "string" ? params["kind"] as any : undefined,
    readiness: typeof params["readiness"] === "string" ? params["readiness"] as any : undefined,
    taskType: typeof params["taskType"] === "string" ? params["taskType"] : undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : 10,
  });
  return { success: true, message: `Found ${results.length} marketplace tool(s).`, data: { results } };
}
```

- [ ] **Step 6: Replace broad prompt hint with focused marketplace hint**

In `apps/web/lib/actions/agent-coworker.ts`, replace the `availableResources` block with:

```ts
const marketplaceSignal = /\b(tool|integration|connector|payroll|invoice|billing|payment|build studio|model|provider|can you|can finance|available)\b/i.test(trimmedContent);
if (marketplaceSignal) {
  try {
    const { listToolMarketplaceEntries } = await import("@/lib/tools/tool-marketplace-readiness");
    const marketplaceEntries = await listToolMarketplaceEntries({
      query: trimmedContent,
      agentId: input.agentId,
      taskType: input.routeContext.startsWith("/build") ? "code-gen" : undefined,
      limit: 5,
    });
    if (marketplaceEntries.length > 0) {
      const hints = marketplaceEntries.map((entry) =>
        `- ${entry.name} (${entry.kind}, ${entry.readiness}): ${entry.readinessReason} Next: ${entry.nextAction}`
      ).join("\n");
      populatedPrompt += [
        "",
        "",
        "TOOL MARKETPLACE CONTEXT — use this to explain available, unconfigured, ungranted, or unavailable tools without inventing integrations:",
        hints,
      ].join("\n");
    }
  } catch (err) {
    console.warn("[agent-coworker] marketplace guidance unavailable:", err);
  }
}
```

If `input.agentId` is not available in the local type, use `agent.agentId` from the resolved route agent.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter web exec vitest run lib/mcp-tools-integrations.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-integrations.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/actions/agent-coworker.ts
git commit -s -m "feat: expose tool marketplace search to coworkers"
```

---

### Task 4: Marketplace UI Readiness Badges

**Files:**
- Modify: `apps/web/app/(shell)/platform/tools/catalog/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/catalog/page.test.tsx`

- [ ] **Step 1: Update the page test fixture**

In `apps/web/app/(shell)/platform/tools/catalog/page.test.tsx`, add readiness fields to native and built-in mock entries:

```ts
readiness: "ready",
readinessReason: "Integration is configured and ready for this context.",
nextAction: "Use the integration from the relevant coworker flow.",
```

For Brave Search:

```ts
readiness: "needs_setup",
readinessReason: "Built-in tool requires local configuration.",
nextAction: "Configure the built-in tool.",
```

Add expectations:

```ts
expect(html).toContain("Agent Tool Marketplace");
expect(html).toContain("Ready");
expect(html).toContain("Needs setup");
expect(html).toContain("Configure the built-in tool.");
```

- [ ] **Step 2: Run the page test to verify failure**

Run: `pnpm --filter web exec vitest run "app/(shell)/platform/tools/catalog/page.test.tsx"`

Expected: FAIL because the page still renders "Connection Catalog" and does not show readiness.

- [ ] **Step 3: Add readiness helpers**

In `apps/web/app/(shell)/platform/tools/catalog/page.tsx`, add:

```ts
function readinessLabel(value: string | undefined) {
  switch (value) {
    case "ready": return "Ready";
    case "needs_setup": return "Needs setup";
    case "needs_grant": return "Needs grant";
    case "configured_not_granted": return "Needs grant";
    case "granted_unavailable": return "Unavailable";
    case "available": return "Available";
    case "unsupported": return "Unsupported";
    case "retired": return "Retired";
    default: return "Available";
  }
}
```

- [ ] **Step 4: Update `ConnectionCard` markup**

In `ConnectionCard`, replace `entry.statusLabel` badge text with:

```tsx
{readinessLabel("readiness" in entry ? entry.readiness : undefined)}
```

After the metric grid, add:

```tsx
{"readinessReason" in entry && entry.readinessReason ? (
  <p className="mt-4 text-xs text-[var(--dpf-muted)]">{entry.readinessReason}</p>
) : null}
{"nextAction" in entry && entry.nextAction ? (
  <p className="mt-1 text-xs font-medium text-[var(--dpf-text)]">{entry.nextAction}</p>
) : null}
```

- [ ] **Step 5: Rename page copy**

Change the `<h1>` text from `Connection Catalog` to `Agent Tool Marketplace`.

Change the subtitle to:

```tsx
{catalog.totalCount.toLocaleString()} known agent tools across MCP, native integrations, and built-in capabilities
```

Update the intro box to say:

```tsx
Use this marketplace to discover what DPF can connect to, what coworkers can use, and what setup or grant is still missing.
```

- [ ] **Step 6: Run page test**

Run: `pnpm --filter web exec vitest run "app/(shell)/platform/tools/catalog/page.test.tsx"`

Expected: PASS.

- [ ] **Step 7: Run all focused tests**

Run:

```bash
pnpm --filter web exec vitest run lib/tools/tool-marketplace-readiness.test.ts lib/actions/connection-catalog.test.ts lib/mcp-tools-integrations.test.ts "app/(shell)/platform/tools/catalog/page.test.tsx"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/(shell)/platform/tools/catalog/page.tsx apps/web/app/(shell)/platform/tools/catalog/page.test.tsx
git commit -s -m "feat: show tool marketplace readiness in catalog"
```

---

### Task 5: Final Verification

**Files:**
- No new files. Verify all touched source.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter web exec vitest run lib/tools/tool-marketplace-readiness.test.ts lib/actions/connection-catalog.test.ts lib/mcp-tools-integrations.test.ts "app/(shell)/platform/tools/catalog/page.test.tsx"
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter web typecheck
```

Expected: zero TypeScript errors. If unrelated pre-existing errors appear, capture exact errors and fix if they are in touched files.

- [ ] **Step 3: Run production build if UI/source changes are implemented**

Run:

```bash
cd apps/web
pnpm exec next build
```

Expected: build completes with exit code 0. If the build fails on a known unrelated environmental issue, capture the exact error and do not claim production verification.

- [ ] **Step 4: Manual UX verification**

Run the app through the configured Docker-served URL and visit `/platform/tools/catalog`.

Verify:

- Search for `payroll` shows ADP.
- ADP shows readiness and setup path.
- Built-in tools show `Needs setup` when Brave Search is unconfigured.
- Readiness text uses theme variables and no hardcoded colors were added.

- [ ] **Step 5: Final commit if verification changed docs/tests**

If verification required any fixes:

```bash
git status --short
git add apps/web/lib/tools/tool-marketplace-readiness.ts apps/web/lib/tools/tool-marketplace-readiness.test.ts apps/web/lib/actions/connection-catalog.ts apps/web/lib/actions/connection-catalog.test.ts apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-integrations.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/actions/agent-coworker.ts "apps/web/app/(shell)/platform/tools/catalog/page.tsx" "apps/web/app/(shell)/platform/tools/catalog/page.test.tsx"
git commit -s -m "fix: complete tool marketplace verification"
```

---

## Spec Coverage Review

- Marketplace surface: Task 4.
- Unconfigured/ungranted/unavailable states: Task 2 and Task 4.
- Coworker query path: Task 3.
- Refactoring budget: Task 1.
- Build Studio model readiness: Task 2.
- Theme-aware UI: Task 4.
- Verification: Task 5.

No implementation table migration is planned in this slice; the plan intentionally starts with a read model over current runtime tables and shared descriptors.
