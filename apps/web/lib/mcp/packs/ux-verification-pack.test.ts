import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mint: vi.fn(), retire: vi.fn(), parse: vi.fn(value => value) }));
vi.mock("@/lib/govern/automation-sign-in", () => ({ mintAutomationSignIn: mocks.mint }));
vi.mock("@/lib/govern/automation-fixture", () => ({ retireFixtureRun: mocks.retire, parseFixtureRequest: mocks.parse }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: () => "https://portal.test" }));
import { uxVerificationPack } from "./ux-verification-pack";
const call = uxVerificationPack.handlers.issue_ux_verification_sign_in;
const context = { agentId: "agent", apiTokenId: "connection", authSource: "oauth" as const, taskRunId: "task" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mint.mockResolvedValue({ issued: true, url: "https://portal.test/one-time", path: "/", expiresAt: "later", runId: "run" });
});
it("uses authenticated context rather than caller-declared ownership", async () => {
  const fixture = { runId: "run", profile: "developer", slot: 0 };
  const result = await call({ fixture, userId: "impostor", agentId: "impostor" }, "human", context);
  expect(mocks.mint).toHaveBeenCalledWith(expect.objectContaining({ fixture, actor: { userId: "human", ...context } }));
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject({ runId: "run" });
  expect(result.message).not.toContain("https://portal.test/one-time");
});
it("keeps pending cleanup visible without issuing a new sign-in", async () => {
  mocks.retire.mockResolvedValue({ retired: false, pendingTaskIds: ["pending"] });
  const result = await call({ retireRunId: "run" }, "human", context);
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ pendingTaskIds: ["pending"] });
  expect(mocks.mint).not.toHaveBeenCalled();
});
it("rejects a mixed retirement and issuance request", async () => {
  const result = await call({ retireRunId: "run", fixture: {} }, "human", context);
  expect(result.success).toBe(false);
  expect(mocks.retire).not.toHaveBeenCalled();
  expect(mocks.mint).not.toHaveBeenCalled();
});
