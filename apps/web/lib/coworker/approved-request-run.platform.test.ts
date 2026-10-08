// Approval convergence A3 (BI-C8EC05C9, spec D3): the platform runner.
//
// An approved envelope whose park row carries the `_approvalResume` marker runs
// its exact call once, through the governed executor, as the person and
// coworker who made it, with the marker's source (AC-RUN at the runner,
// AC-DISPATCH, AC-RERAISE). Everything without the marker falls through
// unchanged (AC-INERT).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async (userId: string) => ({ userId, platformRole: "HR-000", isSuperuser: true }),
}));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [] }));

import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

import { runApprovedPlatformRequest } from "./approved-request-run";

const NOW = new Date("2026-10-07T12:00:00Z");
const PARAMS = { trigger: "cadence" };
const MARKER = {
  v: 1, source: "agentic-loop", coworkerReadBaseline: false, coworkerAuthorizedSurfaceBaseline: true,
  authorizedSurfaceMode: "background", proposeBoundary: true, workroomId: null, featureBuildId: null,
  externalAccess: { workroomId: null, standingGrantAgentId: "AGT-OPS" },
};

function fixtures(over: {
  envelope?: Record<string, unknown>;
  park?: Record<string, unknown> | null;
  recorded?: Record<string, unknown> | null;
  result?: Record<string, unknown>;
} = {}) {
  const envelope = {
    id: "ENV-1", status: "approved", taskRunId: "TR-SCHED-1", expiresAt: new Date(NOW.getTime() + 60_000),
    delegatingUserId: "user-1", coworkerAgentId: "AGT-OPS", manifestActionId: "run_discovery_triage", threadId: "thread-1",
    argsJson: {
      approvalBinding: { taskRunId: "TR-SCHED-1", routeContext: "/platform/ops", chainId: null, inputFingerprint: fingerprintCoworkerInput(PARAMS) },
      proposeBoundary: true,
    },
    ...over.envelope,
  };
  const park = over.park === null ? null : {
    parameters: { ...PARAMS, _approvalResume: MARKER },
    result: { success: false, error: "approval_required", data: { envelopeId: "ENV-1" } },
    threadId: "thread-1",
    ...over.park,
  };
  const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
    if ("success" in args.where && args.where.success === false && "apiTokenId" in args.where) return park;
    return over.recorded ?? null;
  });
  const db = {
    coworkerActionEnvelope: { findUnique: vi.fn(async () => envelope) },
    toolExecution: { findFirst },
    agentMessage: { create: vi.fn(async () => ({ id: "msg-1" })) },
  };
  const execute = vi.fn(async () => over.result ?? { success: true, message: "Triage ran.", entityId: "TRIAGE-1" });
  const resolveRoom = vi.fn(async () => ({ roomAuthority: { workroomId: "WC-1" }, externalAccessEnabled: true }));
  const resolveStandingAccess = vi.fn(async () => true);
  return { db, execute, findFirst, resolveRoom, resolveStandingAccess };
}

function run(f: ReturnType<typeof fixtures>) {
  return runApprovedPlatformRequest("ENV-1", {
    db: f.db as never, execute: f.execute as never, now: NOW,
    resolveRoom: f.resolveRoom, resolveStandingAccess: f.resolveStandingAccess,
  });
}

describe("runApprovedPlatformRequest", () => {
  it("runs the exact approved call once, with the marker's source and the replayed identity", async () => {
    const f = fixtures();
    await expect(run(f)).resolves.toEqual({ status: "executed", message: "Triage ran.", entityId: "TRIAGE-1" });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledWith({
      toolName: "run_discovery_triage",
      rawParams: PARAMS,
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: "HR-000", isSuperuser: true },
      context: {
        agentId: "AGT-OPS", threadId: "thread-1", taskRunId: "TR-SCHED-1", routeContext: "/platform/ops",
        proposeBoundary: true, approvalCompletion: "platform",
        coworkerAuthorizedSurfaceBaseline: true,
        authorizedSurfaceContext: { mode: "background", route: "/platform/ops" },
        externalAccessEnabled: true,
      },
      source: "agentic-loop",
    });
    expect(f.resolveStandingAccess).toHaveBeenCalledWith("AGT-OPS");
    expect(f.db.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-1", role: "system", content: "run_discovery_triage completed successfully. Triage ran.", agentId: "AGT-OPS" },
    });
  });

  it("re-resolves room authority and external access from the recorded room", async () => {
    const f = fixtures({ park: { parameters: { ...PARAMS, _approvalResume: { ...MARKER, workroomId: "WC-1", externalAccess: { workroomId: "WC-1", standingGrantAgentId: "AGT-OPS" } } } } });
    await run(f);
    expect(f.resolveRoom).toHaveBeenCalledWith({ agentId: "AGT-OPS", workroomId: "WC-1" });
    expect(f.execute.mock.calls[0]![0]).toMatchObject({
      context: { roomAuthority: { workroomId: "WC-1" }, externalAccessEnabled: true, authorizedSurfaceContext: { workroomId: "WC-1" } },
    });
  });

  it("a second call returns the recorded outcome as settled and runs nothing", async () => {
    const f = fixtures({
      envelope: { status: "executed" },
      recorded: { result: { success: true, message: "Triage ran.", entityId: "TRIAGE-1" }, success: true },
    });
    await expect(run(f)).resolves.toEqual({ status: "settled", outcome: "executed", message: "Triage ran.", entityId: "TRIAGE-1" });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("an identical call the gate already settled is reported as settled", async () => {
    const f = fixtures({ result: { success: true, message: "already ran", governance: { approvalReplayOf: "ENV-0" } } });
    await expect(run(f)).resolves.toMatchObject({ status: "settled", outcome: "executed" });
  });

  it("refuses to run arguments it cannot prove are the approved ones", async () => {
    const f = fixtures({ park: { parameters: { trigger: "volume", _approvalResume: MARKER } } });
    await expect(run(f)).resolves.toMatchObject({ status: "not-run", reason: "arguments-not-provable" });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not run an expired approval", async () => {
    const f = fixtures({ envelope: { expiresAt: new Date(NOW.getTime() - 1) } });
    await expect(run(f)).resolves.toMatchObject({ status: "not-run", reason: "expired" });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("reports a failed run and writes the failure to the thread", async () => {
    const f = fixtures({ result: { success: false, error: "triage_unavailable", message: "No source." } });
    await expect(run(f)).resolves.toEqual({ status: "failed", message: "No source." });
    expect(f.db.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: "run_discovery_triage failed: triage_unavailable" }),
    });
  });

  it("falls through unchanged when the park row has no marker or no park row exists (AC-INERT)", async () => {
    await expect(run(fixtures({ park: { parameters: PARAMS } }))).resolves.toBeNull();
    await expect(run(fixtures({ park: null }))).resolves.toBeNull();
    const f = fixtures();
    await run(f);
    expect(f.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { success: false, toolName: "run_discovery_triage", userId: "user-1", apiTokenId: null },
    });
  });

  it("AC-DISPATCH: a TaskRun-bound converted envelope runs the call itself (the external runner would resume the task)", async () => {
    const f = fixtures();
    await expect(run(f)).resolves.toMatchObject({ status: "executed" });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]![0]).toMatchObject({ context: { taskRunId: "TR-SCHED-1" } });
  });

  it("AC-RERAISE: after Ask again the copied park row says executionMode proposal; the run uses the marker's source, once", async () => {
    const f = fixtures({
      envelope: { id: "ENV-2", argsJson: { approvalBinding: { taskRunId: "TR-SCHED-1", routeContext: "/platform/ops", chainId: null, inputFingerprint: fingerprintCoworkerInput(PARAMS) }, proposeBoundary: true, reraisedFrom: "ENV-1" } },
      park: { executionMode: "proposal", envelopeId: null, result: { success: false, error: "approval_required", data: { envelopeId: "ENV-2" } } },
    });
    await runApprovedPlatformRequest("ENV-2", {
      db: f.db as never, execute: f.execute as never, now: NOW, resolveRoom: f.resolveRoom, resolveStandingAccess: f.resolveStandingAccess,
    });
    expect(f.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { OR: [{ envelopeId: "ENV-2" }, { result: { path: ["data", "envelopeId"], equals: "ENV-2" } }] },
    });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]![0]).toMatchObject({ source: "agentic-loop" });
  });
});
