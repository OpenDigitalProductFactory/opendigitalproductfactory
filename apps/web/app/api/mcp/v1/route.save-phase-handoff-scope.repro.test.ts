// REPRODUCTION (BI-BDB63485) — expected to FAIL on main until the fix lands.
//
// AC-HANDOFF-PHASE-SCOPE: calling save_phase_handoff for a build in `ship`
// over /api/mcp/v1 is refused and does not write `complete`.
//
// This drives the REAL external dispatch chain end to end:
//   POST /api/mcp/v1 (route.ts handleToolsCall)
//   -> governedExecuteTool (lib/mcp-governed-execute.ts, real; only its audit
//      and receipt writers are swapped through its own _setGovernanceForTests seam)
//   -> executeTool (lib/mcp-tools.ts, real; kernel gate + pack registry)
//   -> save_phase_handoff (lib/mcp/packs/build-evidence-extra-pack.ts, real)
//   -> checkBuildPhaseGate (real structural gate)
// Only Prisma, the token resolver, quiescence, the event bus and the terminal
// transition (so the test can observe whether `complete` would be written) are
// mocked. If any layer in that chain honoured the tool's
// `buildPhases: ["ideate","plan","build","review"]` tag, this test would pass.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  completeFeatureBuildTransition: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: vi.fn(async () => ({ level: "normal", runId: null, enteredAt: null })),
}));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { emit: m.emit } }));
vi.mock("@/lib/backlog/initiative-readiness/build-terminal-transition", () => ({
  completeFeatureBuildTransition: m.completeFeatureBuildTransition,
  assertFeatureBuildCompletion: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    featureBuild: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    phaseHandoff: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    buildActivity: { create: vi.fn() },
    taskRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    mcpToolSession: { findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { _setGovernanceForTests } from "@/lib/mcp-governed-execute";
import { POST } from "./route";

const db = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  featureBuild: Record<"findUnique" | "findFirst" | "update" | "updateMany", ReturnType<typeof vi.fn>>;
  phaseHandoff: Record<"create" | "update" | "findMany", ReturnType<typeof vi.fn>>;
  buildActivity: { create: ReturnType<typeof vi.fn> };
};

const SHIP_BUILD = {
  buildId: "FB-SHIP0001",
  createdById: "u1",
  phase: "ship",
  kind: "feature",
  threadId: null,
  designDoc: null, designReview: null, buildPlan: null, planReview: null,
  verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
  acceptanceMet: null, uxTestResults: null, uxVerificationStatus: "complete",
  brief: { acceptanceCriteria: ["a"] }, plan: { processSize: "small" },
};

function toolsCall(args: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: {
      Authorization: "Bearer dpfmcp_WRITE",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.1 (test)",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "save_phase_handoff", arguments: args },
    }),
  });
}

const auditRows: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  auditRows.length = 0;
  vi.mocked(resolveMcpApiToken).mockResolvedValue({
    tokenId: "tok_write",
    userId: "u1",
    agentId: null,
    scopes: ["backlog_write"],
    capability: "write",
    scope: "write",
  } as never);
  db.user.findUnique.mockResolvedValue({
    isSuperuser: true, isActive: true, groups: [{ platformRole: { roleId: "HR-000" } }],
  });
  db.featureBuild.findUnique.mockResolvedValue(SHIP_BUILD);
  db.featureBuild.update.mockResolvedValue({});
  db.phaseHandoff.create.mockResolvedValue({ id: "H1" });
  db.phaseHandoff.update.mockResolvedValue({});
  db.phaseHandoff.findMany.mockResolvedValue([]);
  db.buildActivity.create.mockResolvedValue({});
  // An initiative-ready build: the terminal transition would allow `complete`.
  // reconcileBuildCompletion would still refuse, because no ship fork is
  // terminal and the merged SHA is not deployed — this test never stubs
  // build-flow-state, so any path consulting it would see a non-ship-ready build.
  m.completeFeatureBuildTransition.mockResolvedValue({ ok: true });
  _setGovernanceForTests({
    toolExecutionCreate: async (data) => { auditRows.push(data); return { id: `TE-${auditRows.length}` }; },
    toolExecutionUpdate: async () => ({}),
    toolExecutionReceiptCreate: async () => ({ id: "R1" }),
    toolExecutionReceiptUpdate: async () => ({}),
  });
});

afterEach(() => {
  _setGovernanceForTests({});
});

describe("REPRO BI-BDB63485 AC-HANDOFF-PHASE-SCOPE — save_phase_handoff from `ship` over /api/mcp/v1", () => {
  it("is refused, and never writes `complete` (tool is tagged ideate..review only)", async () => {
    const res = await POST(toolsCall({ buildId: "FB-SHIP0001", summary: "shipped" }));
    const body = await res.json();
    const text = String(body?.result?.content?.[0]?.text ?? JSON.stringify(body));

    // Expected: the call is refused because the build is outside the tool's phase scope.
    expect.soft(body.result?.isError, `tool result was: ${text}`).toBe(true);
    // Expected: no terminal write was attempted.
    expect.soft(m.completeFeatureBuildTransition).not.toHaveBeenCalled();
    expect.soft(db.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phase: "complete" }) }),
    );
    expect.soft(text).not.toContain("Phase advanced: ship → complete");
  });
});
