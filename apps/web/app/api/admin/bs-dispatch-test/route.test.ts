import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ token: vi.fn(), reset: vi.fn(), plan: vi.fn(), build: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  mcpApiToken: { findFirst: m.token, findUnique: m.token }, featureBuild: { update: m.reset },
} }));
vi.mock("@/lib/build/build-dispatch-effect.server", () => ({ requestBuildDispatch: m.build }));
vi.mock("@/lib/build/plan-on-approval", () => ({ dispatchPlanForApprovedBuild: m.plan }));

import { POST } from "./route";

const now = new Date("2026-11-25T12:00:00Z");
const operator = { kind: "operator", userId: "test-user", revokedAt: null, expiresAt: null };
const call = (authorization: string, phase: "plan" | "build" = "build") => POST(new Request("http://localhost/api/admin/bs-dispatch-test", {
  method: "POST", headers: { authorization, "content-type": "application/json" },
  body: JSON.stringify({ buildId: "FB-FIXTURE", phase, resetPlan: true }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  m.build.mockResolvedValue({ kind: "owed" });
  m.plan.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe("legacy test dispatch credential boundary without client hooks", () => {
  it.each([
    ["S5 room credential", { kind: "workroom_session_scoped" }, "dpfroom_fixture"],
    ["legacy room credential", { kind: "workroom_session" }, "dpfroom_fixture"],
    ["another MCP kind", { kind: "ephemeral_ship" }, "dpfmcp_fixture"],
    ["revoked operator PAT", { revokedAt: now }, "dpfmcp_fixture"],
    ["expired operator PAT", { expiresAt: new Date(now.getTime() - 1) }, "dpfmcp_fixture"],
    ["operator PAT at expiry equality", { expiresAt: now }, "dpfmcp_fixture"],
  ] as const)("refuses %s without resetting or dispatching a build", async (_name, changes, token) => {
    m.token.mockResolvedValue({ ...operator, ...changes });
    expect((await call(`Bearer ${token}`)).status).toBe(401);
    expect(m.reset).not.toHaveBeenCalled();
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.build).not.toHaveBeenCalled();
  });

  it.each(["plan", "build"] as const)("accepts a current operator PAT for %s", async phase => {
    m.token.mockResolvedValue({ ...operator, expiresAt: new Date(now.getTime() + 1) });
    expect((await call("Bearer dpfmcp_fixture", phase)).status).toBe(phase === "plan" ? 200 : 202);
    expect(m.reset).toHaveBeenCalledOnce();
    expect(phase === "plan" ? m.plan : m.build).toHaveBeenCalledWith({ buildId: "FB-FIXTURE", userId: "test-user" });
  });
});
