import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn(), authority: vi.fn(), execute: vi.fn(), lowLevel: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: { featureBuild: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/govern/operation-authority", () => ({ currentOperationAuthority: mocks.authority }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mocks.execute }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: mocks.lowLevel }));
import { prepareBuildRelease } from "./build-release";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "human", isSuperuser: true } });
  mocks.findUnique.mockResolvedValue({ createdById: "human" });
  mocks.execute.mockResolvedValue({ success: true });
});
describe("portal release authority", () => {
  it("refuses an owned build when current human permission was removed after login", async () => {
    mocks.authority.mockResolvedValue(null);
    await expect(prepareBuildRelease("FB-OWNED")).rejects.toThrow("permission");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.lowLevel).not.toHaveBeenCalled();
  });
  it("passes the current human through the governed execution boundary", async () => {
    const userContext = { userId: "human", platformRole: "HR-000", isSuperuser: false };
    mocks.authority.mockResolvedValue(userContext);
    await prepareBuildRelease("FB-OWNED");
    expect(mocks.authority).toHaveBeenCalledWith("human", "deploy_feature");
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "deploy_feature", rawParams: { buildId: "FB-OWNED" }, userId: "human", userContext,
    }));
    expect(mocks.lowLevel).not.toHaveBeenCalled();
  });
  it("keeps build ownership separate from operation permission", async () => {
    mocks.findUnique.mockResolvedValue({ createdById: "other-human" });
    await expect(prepareBuildRelease("FB-FOREIGN")).rejects.toThrow("Forbidden");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
