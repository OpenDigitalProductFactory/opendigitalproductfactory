import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCoworkerRecord } from "@/lib/coworker-record/load-record";
import { evaluateLifecycleGate } from "@/lib/coworker-lifecycle/lifecycle-gate";

const prismaMocks = vi.hoisted(() => ({
  agentModelConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  modelProvider: {
    findMany: vi.fn().mockResolvedValue([
      {
        providerId: "openai",
        name: "OpenAI",
        modelProfiles: [
          {
            modelId: "gpt-tool",
            friendlyName: "Tool model",
            supportsToolUse: true,
          },
        ],
      },
    ]),
  },
  skillAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  skillDefinition: { findMany: vi.fn().mockResolvedValue([]) },
  organization: { findFirst: vi.fn().mockResolvedValue(null) },
  $queryRaw: vi.fn().mockResolvedValue([]),
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMocks }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u1", platformRole: "admin", isSuperuser: true },
  }),
}));

vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  can: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/coworker-record/load-record", () => ({
  loadCoworkerRecord: vi.fn(),
}));

vi.mock("@/lib/coworker-record/corpus-signals", () => ({
  loadFamilyCorpusSignals: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/decision-perspective/install-variant-context", () => ({
  resolveInstallVariantContext: vi.fn().mockResolvedValue({ archetype: null }),
}));

vi.mock("@/lib/actions/golden-triangle", () => ({
  getCoworkerPostureInheritance: vi
    .fn()
    .mockResolvedValue({ hasOwnOverride: false }),
}));

vi.mock("@/lib/coworker-self-assessment/review-service", () => ({
  getCoworkerCapabilityNeedReview: vi.fn().mockResolvedValue({
    summary: { total: 0, byStatus: {}, bySeverity: {}, byKind: {} },
    filterOptions: { statuses: [], severities: [], kinds: [] },
    needs: [],
  }),
}));

vi.mock("@/lib/tak/work-pattern-read-model", () => ({
  getWorkPatternReadModel: vi.fn().mockResolvedValue({
    generatedAt: new Date("2026-07-30T00:00:00.000Z"),
    window: {
      since: new Date("2026-07-01T00:00:00.000Z"),
      until: new Date("2026-07-30T00:00:00.000Z"),
    },
    summary: {
      totalPatterns: 0,
      totalObservedRuns: 0,
      openNeedCount: 0,
      readyForReviewCount: 0,
      candidateOnlyCount: 0,
    },
    patterns: [],
  }),
}));

vi.mock("@/lib/coworker-service-catalog/route-readiness", () => ({
  loadCoworkerRoutingReadinessSnapshot: vi.fn().mockResolvedValue({
    endpoints: [],
    policyRules: [],
    overrides: [],
    capacityByProvider: new Map(),
    localOnlyInference: false,
  }),
  projectCoworkerRouteReadiness: vi.fn().mockResolvedValue({
    ready: true,
    reason: "A configured route satisfies this coworker's requirements.",
    providerId: "openai",
    modelId: "gpt-ready",
  }),
  parseCoworkerServiceReadinessProbe: (
    metadata: Record<string, unknown> | null,
  ) => metadata?.readinessProbe ?? null,
}));

vi.mock("@/lib/coworker-lifecycle/lifecycle-gate", () => ({
  evaluateLifecycleGate: vi.fn(),
}));

vi.mock("@/lib/tak/agent-grants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tak/agent-grants")>()),
  knownGrantKeys: () => [],
}));

vi.mock("@/components/platform/AgentModelRoutingCard", () => ({
  AgentModelRoutingCard: () => null,
}));
vi.mock("@/components/platform/coworker-record/CapabilitiesEditor", () => ({
  CapabilitiesEditor: () => null,
}));
vi.mock("@/components/platform/coworker-record/RecordActionsMenu", () => ({
  RecordActionsMenu: () => null,
}));
vi.mock("@/components/golden-triangle/CoworkerPriorityControl", () => ({
  CoworkerPriorityControl: () => null,
}));
vi.mock(
  "@/components/platform/coworker-record/CoworkerProactivityNote",
  () => ({ CoworkerProactivityNote: () => null }),
);
vi.mock("@/components/platform/coworker-record/CoworkerRecordTabs", () => ({
  CoworkerRecordTabs: () => null,
}));
vi.mock("@/components/platform/coworker-record/panels", () => ({
  OverviewPanel: () => null,
  ProfessionPanel: () => null,
  CapabilitiesPanel: () => null,
  PriorityPanel: () => null,
  GovernancePanel: () => null,
  PerformancePanel: () => null,
  DecisionsPanel: () => null,
}));
vi.mock("@/components/platform/coworker-record/NeedsAndPlaybooksPanel", () => ({
  NeedsAndPlaybooksPanel: () => null,
}));
vi.mock("@/components/platform/coworker-record/CooConversationalNameCard", () => ({
  CooConversationalNameCard: () => null,
}));
vi.mock("@/components/agent/AskCoworkerButton", () => ({
  AskCoworkerButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("@/components/platform/coworker-record/OwnerCoworkerPanels", () => ({
  AdvancedDetail: () => null,
  AvailabilityPanel: () => null,
  HeaderChip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  OwnerStatus: ({
    label,
    value,
    detail,
  }: {
    label: string;
    value: string;
    detail: string;
  }) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <dd>{detail}</dd>
    </div>
  ),
  WorkHighlights: () => null,
  WorkOfferedPanel: () => null,
}));

type Service = {
  serviceId: string;
  providerAgentId: string;
  name: string;
  summary: string;
  status: string;
  hitlTier: number;
  authorityBoundary: string;
  availabilityScope: string;
  personas: string[];
  archetypes: string[];
  backingSkillIds: string[];
  backingToolNames: string[];
  backingGrantKeys: string[];
  metadata: Record<string, unknown>;
  portfolio: { slug: string; name: string };
};

const marketingService = {
  serviceId: "svc-marketing-campaign-execution",
  providerAgentId: "marketing-specialist",
  name: "Marketing campaign execution",
  summary: "Plans and runs campaigns.",
  status: "active",
  hitlTier: 2,
  authorityBoundary: "proposal-only",
  availabilityScope: "external",
  personas: ["customer"],
  archetypes: ["food-hospitality"],
  backingSkillIds: [],
  backingToolNames: ["create_marketing_campaign", "get_campaign_plan"],
  backingGrantKeys: ["marketing_read", "marketing_write"],
  metadata: {
    aggregate: true,
    readinessProbe: {
      taskType: "tool-action",
      prompt: "Create a draft restaurant promotion campaign.",
      requiresToolUse: true,
    },
  },
  portfolio: {
    slug: "products_and_services_sold",
    name: "Products and services sold",
  },
} satisfies Service;

function coworkerRecord({
  agentId,
  displayName,
  kind,
  description,
  hitlTier,
  sensitivity,
  services,
  grants = [],
}: {
  agentId: string;
  displayName: string;
  kind: string;
  description: string;
  hitlTier: number;
  sensitivity: string;
  services: Service[];
  grants?: string[];
}) {
  const runtimeAgentId =
    agentId === "AGT-WS-MARKETING"
      ? "marketing-specialist"
      : "customer-advisor";
  return {
    agent: {
      id: `db-${agentId}`,
      agentId,
      slugId: runtimeAgentId,
      displayName,
      name: displayName,
      kind,
      tier: 2,
      lifecycleStage: "production",
      description,
      sensitivity,
      hitlTierDefault: hitlTier,
      governanceProfile: null,
    },
    runtime: {
      id: `runtime-${runtimeAgentId}`,
      agentId: runtimeAgentId,
      slugId: runtimeAgentId,
      assignedSkillIds: [],
      heldGrantKeys: grants,
    },
    gaid: null,
    profession: { family: null, profile: null, profileId: null, coverage: null },
    voice: null,
    decisions: { total: 0, byOutcome: {}, deferRate: 0 },
    services,
    installAvailability: {
      install: { archetypeId: "restaurant", category: "food-hospitality" },
      installResolutionReason: "The storefront business type was resolved.",
    },
  } as never;
}

describe("AgentDetailPage readiness actions", () => {
  beforeEach(() => {
    vi.mocked(loadCoworkerRecord).mockReset();
    vi.mocked(evaluateLifecycleGate).mockResolvedValue({
      allowed: true,
      reason: "Lifecycle policy allows dispatch.",
    } as never);
  });

  it("shows a named Ask Marketing action when a campaign service is ready", async () => {
    vi.mocked(loadCoworkerRecord).mockResolvedValue(
      coworkerRecord({
        agentId: "AGT-WS-MARKETING",
        displayName: "Marketing",
        kind: "specialist",
        description: "Plans and runs customer-facing campaigns.",
        hitlTier: 2,
        sensitivity: "internal",
        services: [marketingService],
        grants: ["marketing_read", "marketing_write"],
      }),
    );

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({ agentId: "AGT-WS-MARKETING" }),
      }),
    );

    expect(html).toContain("Available for your business type");
    expect(html).toContain("Ask Marketing");
    expect(html).toContain("Ready work: Marketing campaign execution");
    expect(html).toContain("Interaction for currently available work.");
    expect(html).not.toContain("Ask this coworker");
    expect(
      prismaMocks.$queryRaw.mock.calls.some((call) =>
        call.includes("marketing-specialist"),
      ),
    ).toBe(true);
  });

  it("withholds Ask Customer Advisor while its declaration is incomplete", async () => {
    vi.mocked(loadCoworkerRecord).mockResolvedValue(
      coworkerRecord({
        agentId: "AGT-WS-CUSTOMER-ADVISOR",
        displayName: "Customer Advisor",
        kind: "advisor",
        description: "Handles customer inquiries and service requests.",
        hitlTier: 1,
        sensitivity: "confidential",
        services: [
          {
            ...marketingService,
            serviceId: "svc-customer-sales-intake",
            providerAgentId: "customer-advisor",
            name: "Customer sales and service intake",
            summary: "Handles customer inquiry and service-request triage.",
            archetypes: [],
            backingSkillIds: ["customer-intake-triage"],
            backingToolNames: ["create_customer_case"],
            backingGrantKeys: ["consumer_read", "backlog_write"],
          },
        ],
      }),
    );

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          agentId: "AGT-WS-CUSTOMER-ADVISOR",
        }),
      }),
    );

    expect(html).toContain("Coverage not defined");
    expect(html).toContain(
      "Interaction declared for this coworker&#x27;s best-matching work.",
    );
    expect(html).not.toContain("Interaction for currently available work.");
    expect(html).not.toContain("Ask Customer Advisor");
  });

  it("preserves the filtered roster return path when setup opens Capabilities", async () => {
    vi.mocked(loadCoworkerRecord).mockResolvedValue(
      coworkerRecord({
        agentId: "AGT-WS-MARKETING",
        displayName: "Marketing",
        kind: "specialist",
        description: "Plans and runs customer-facing campaigns.",
        hitlTier: 2,
        sensitivity: "internal",
        services: [
          {
            ...marketingService,
            backingSkillIds: ["marketing-campaign-planning"],
            backingToolNames: ["create_marketing_campaign"],
          },
        ],
        grants: ["marketing_read", "marketing_write"],
      }),
    );

    const returnTo =
      "/platform/ai/overview?area=products_and_services_sold";
    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({ agentId: "AGT-WS-MARKETING" }),
        searchParams: Promise.resolve({ returnTo }),
      }),
    );

    expect(html).toContain("Review capabilities");
    expect(html).not.toContain("Ask Marketing");
    expect(html).toContain(
      `/platform/ai/agent/AGT-WS-MARKETING?returnTo=${encodeURIComponent(returnTo)}#capabilities`,
    );
  });

  it("withholds Ask when strict lifecycle certification blocks dispatch", async () => {
    vi.mocked(evaluateLifecycleGate).mockResolvedValue({
      allowed: false,
      reason: "Certification failed in strict lifecycle mode.",
    } as never);
    vi.mocked(loadCoworkerRecord).mockResolvedValue(
      coworkerRecord({
        agentId: "AGT-WS-MARKETING",
        displayName: "Marketing",
        kind: "specialist",
        description: "Plans and runs customer-facing campaigns.",
        hitlTier: 2,
        sensitivity: "internal",
        services: [marketingService],
        grants: ["marketing_read", "marketing_write"],
      }),
    );

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({ agentId: "AGT-WS-MARKETING" }),
      }),
    );

    expect(html).toContain("Needs attention");
    expect(html).toContain("Certification failed in strict lifecycle mode.");
    expect(html).toContain("Review certification");
    expect(html).toContain(
      'href="/admin/scheduled-jobs#scheduled-job-coworker-certification"',
    );
    expect(html).not.toContain("Ask Marketing");
  });
});
