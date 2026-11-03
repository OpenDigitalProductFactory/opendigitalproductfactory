import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), recovery: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.find } } }));
vi.mock("@/lib/change-review/semantic-review-recovery-readback", () => ({ readSemanticReviewRecovery: mocks.recovery }));
import { GET } from "./route";
const row = { id: "private-row-id", userId: "owner", taskRunId: "TR-OWN", a2aMetadata: { gateKind: "semantic-review" },
  messages: [], artifacts: [] };
const context = { params: Promise.resolve({ taskId: "TR-OWN" }) };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner", isSuperuser: false } });
  mocks.find.mockResolvedValue(row); mocks.recovery.mockResolvedValue({ details: { authority: { state: "denied", reason: "saved-token-scope-denied" } } }); });
it("adds safe recovery diagnosis to the admitted original owner's existing task route", async () => {
  const response = await GET(new Request("https://example.test/api/internal/tasks/TR-OWN"), context);
  expect((await response.json()).task.recovery.details.authority).toEqual({ state: "denied", reason: "saved-token-scope-denied" });
  expect(mocks.recovery).toHaveBeenCalledWith(row, "owner");
  expect(mocks.find.mock.calls[0][0].where).toEqual({ taskRunId: "TR-OWN", userId: "owner" });
});
it("does not grant an administrator another owner's diagnostic detail", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "admin", isSuperuser: true } });
  const response = await GET(new Request("https://example.test"), context);
  expect((await response.json()).task.recovery).toBeUndefined();
  expect(mocks.recovery).not.toHaveBeenCalled();
});
it("refuses an unsigned caller before any task or authority observation", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET(new Request("https://example.test"), context)).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.recovery).not.toHaveBeenCalled();
});
it("keeps unrelated task families out of semantic authority diagnosis", async () => {
  mocks.find.mockResolvedValue({ ...row, a2aMetadata: { gateKind: "other" } });
  expect((await (await GET(new Request("https://example.test"), context)).json()).task.recovery).toBeUndefined();
  expect(mocks.recovery).not.toHaveBeenCalled();
});
