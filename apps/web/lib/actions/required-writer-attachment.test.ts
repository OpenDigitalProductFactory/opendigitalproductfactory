import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-EC82C48B — a governed review run must never be dispatched without the tools
// it is required to call.
//
// TIER-0 CROWDING, WITH THE REAL NUMBERS. routeContext on both runs was
// "/build", whose route-context map declares 43 domainTools. resolveAutonomousWorkTools
// put those 43, plus all 6 AUTHORIZED_SURFACE_TOOL_NAMES, plus the run's 2
// required names into ONE tier-0 set — 51 names competing for cap=15 slots,
// ordered by an intent-relevance heuristic. The required writer had no
// guaranteed place; whether it survived was decided by how its description
// scored against "review", "read", "source", "record", "evidence" relative to
// reviewDesignDoc, saveBuildEvidence, read_project_file, search_knowledge and
// forty others. Downstream, narrowInitiativeReviewTools filters the ATTACHED set
// to exactly the required names — dropping load_tools too, since it is not one —
// so losing that heuristic does not degrade the run, it EMPTIES it.
//
// Honest limit: the portal log records counts (attached=15), not names, so
// attachment on those two specific runs is not directly proven. What is proven
// is that the writer's survival was decided by a relevance heuristic over a
// 51-name tier-0 set, which is not a property a governed gate may depend on.
//
// Sibling incident, same class at a different cap: autonomous-work-run.test.ts
// "keeps the cliff cap when the local probe could not read a window (BI-A8BFEFCE)".

vi.mock("@dpf/db", () => {
  const prisma = { taskRun: { create: vi.fn(), findFirst: vi.fn() }, taskMessage: { create: vi.fn() } };
  return { prisma: { ...prisma, $transaction: vi.fn(async (cb) => cb(prisma)) } };
});
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: vi.fn(),
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
}));
vi.mock("@/lib/tak/agent-grants", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentToolGrantsAsync: vi.fn(async () => ["initiative_design_review"]),
}));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({
  resolveLocalServingPosture: vi.fn(async () => ({
    servedContextTokens: 24_576,
    presence: "present" as const,
  })),
}));
vi.mock("@/lib/routing/local-tool-fidelity", () => ({
  resolveLocalToolFidelityCeiling: vi.fn(async () => null),
}));

const REQUIRED = ["record_initiative_design_review", "read_source_at_version"] as const;

const fakeTool = (name: string) => ({
  name,
  description: `${name} does ${name.replace(/_/g, " ")}`,
  inputSchema: { type: "object", properties: {} },
  requiredCapability: null,
  sideEffect: false,
  executionMode: "immediate",
});

const userContext = { userId: "user-1", platformRole: "admin", isSuperuser: true };

describe("resolveAutonomousWorkTools — required writer attachment (BI-EC82C48B)", () => {
  beforeEach(async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockImplementation((ts: unknown[]) => ts as never);
  });

  it("attaches required tools against the real /build tier-0 crowd at cap 15", async () => {
    const tools = await import("@/lib/mcp-tools");
    const { resolveRouteContext } = await import("@/lib/tak/route-context-map");
    const { AUTHORIZED_SURFACE_TOOL_NAMES } = await import(
      "@/lib/coworker/authorized-surface-coworker-contract"
    );
    // The live composition: every /build domain tool and every surface tool is
    // authorized and lands in tier 0 alongside the 2 required names.
    const routeDomain = resolveRouteContext("/build").domainTools ?? [];
    const surface = [
      ...routeDomain.map(fakeTool),
      ...[...AUTHORIZED_SURFACE_TOOL_NAMES].map(fakeTool),
      ...Array.from({ length: 57 }, (_, i) => fakeTool(`tool_${i}`)),
      ...REQUIRED.map(fakeTool),
    ];
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("@/lib/tak/autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "AGT-WS-REVIEW",
      mode: "act",
      routeContext: "/build",
      intentQuery:
        "independently address spec-approval using record_initiative_design_review",
      requiredToolNames: [...REQUIRED],
    });

    const attached = result.tools.map((t) => t.name);
    for (const name of REQUIRED) {
      expect(attached, `${name} must be attached, not deferred`).toContain(name);
    }
    // The cap still binds — required tools take PRIORITY inside it, not exemption
    // from it (BI-95D74DE9), so local serving is not disqualified.
    expect(result.tools.length).toBeLessThanOrEqual(15);
    // Authority is untouched: the long tail is deferred, not revoked.
    expect(result.tools.some((t) => t.name === "load_tools")).toBe(true);
  });

  it("[wiring guard] still attaches them when a measured ceiling tightens the cap", async () => {
    const ceiling = await import("@/lib/routing/local-tool-fidelity");
    vi.mocked(ceiling.resolveLocalToolFidelityCeiling).mockResolvedValueOnce(7 as never);

    const tools = await import("@/lib/mcp-tools");
    const surface = [
      ...Array.from({ length: 106 }, (_, i) => fakeTool(`tool_${i}`)),
      ...REQUIRED.map(fakeTool),
    ];
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("@/lib/tak/autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "AGT-WS-REVIEW",
      mode: "act",
      intentQuery: "independently address spec-approval",
      requiredToolNames: [...REQUIRED],
    });

    const attached = result.tools.map((t) => t.name);
    for (const name of REQUIRED) {
      expect(attached, `${name} must survive a tightened cap`).toContain(name);
    }
  });
});

// The genuine proof: at the selector level, with the real authorized surface and
// route domain tools crowding tier 0 and the required names NOT favoured by
// intent relevance, the pre-fix ranking defers them. This test fails on the
// unfixed tree and passes on the fixed one.
describe("selectCoworkerToolBudget — required tools outrank the generic surface (BI-EC82C48B)", () => {
  it("keeps required tools when the tier-0 set alone exceeds the cap", async () => {
    const { selectCoworkerToolBudget, LOAD_TOOLS_TOOL_NAME } = await import("./coworker-tool-budget");
    const { AUTHORIZED_SURFACE_TOOL_NAMES } = await import(
      "@/lib/coworker/authorized-surface-coworker-contract"
    );
    const surface = [...AUTHORIZED_SURFACE_TOOL_NAMES];
    const routeDomain = ["add_provider", "get_queue_status", "list_positions", "query_employees"];

    const tools = [
      ...surface.map(fakeTool),
      ...routeDomain.map(fakeTool),
      ...REQUIRED.map(fakeTool),
    ];

    const { attached } = selectCoworkerToolBudget({
      tools: tools as never,
      // Exactly how resolveAutonomousWorkTools composed tier 0 before the fix.
      pageActionNames: new Set([...routeDomain, ...surface, ...REQUIRED]),
      alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
      requiredNames: new Set(REQUIRED),
      roleGrants: ["initiative_design_review"],
      cap: 7,
      // No intent query: the live objective happens to name the writer, but a
      // required tool must not depend on that to survive the cap.
    });

    const attachedNames = attached.map((t) => t.name);
    for (const name of REQUIRED) {
      expect(attachedNames, `${name} must outrank the generic surface`).toContain(name);
    }
    expect(attached.length).toBeLessThanOrEqual(7);
  });
});
