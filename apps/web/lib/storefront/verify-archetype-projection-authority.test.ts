import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), can: vi.fn(), environment: vi.fn(), transaction: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.user }));
vi.mock("@/lib/govern/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: mocks.environment }));
import { verifyArchetypeProjectionTool } from "./verify-archetype-projection";
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({}); mocks.can.mockReturnValue(true); });
it("refuses business identity overrides before accessing data", async () => {
  await expect(verifyArchetypeProjectionTool({ organizationId: "business" }, "user")).rejects.toThrow("no business identities");
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("refuses missing current authority before any fixture write", async () => {
  mocks.can.mockReturnValue(false);
  await expect(verifyArchetypeProjectionTool({}, "user")).rejects.toThrow("permission");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("refuses production even for a platform manager", async () => {
  mocks.environment.mockResolvedValue({ environmentClass: "production" });
  await expect(verifyArchetypeProjectionTool({}, "user")).rejects.toThrow("development or test");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
