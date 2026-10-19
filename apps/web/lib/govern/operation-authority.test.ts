import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ currentUserContext: vi.fn() }));
vi.mock("./current-user-context", () => mocks);
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [
  { name: "promote_to_build_studio", requiredCapability: "manage_backlog" },
  { name: "start_build", requiredCapability: "view_platform" },
  { name: "deploy_feature", requiredCapability: "manage_capabilities" },
] }));
import { currentOperationAuthority } from "./operation-authority";

beforeEach(() => vi.resetAllMocks());
describe("shared human operation policy", () => {
  it.each([
    ["HR-200", "start_build", true], ["HR-200", "promote_to_build_studio", false],
    ["HR-500", "promote_to_build_studio", true], ["HR-500", "deploy_feature", false],
    ["HR-000", "deploy_feature", true], ["HR-600", "start_build", false],
  ])("checks %s against %s using the MCP operation capability", async (platformRole, operation, allowed) => {
    mocks.currentUserContext.mockResolvedValue({ userId: "human", platformRole, isSuperuser: false });
    expect(Boolean(await currentOperationAuthority("human", operation))).toBe(allowed);
  });
  it("does not let a stale login or unknown operation authorize work", async () => {
    mocks.currentUserContext.mockResolvedValue(null);
    expect(await currentOperationAuthority("human", "start_build")).toBeNull();
    mocks.currentUserContext.mockResolvedValue({ userId: "human", platformRole: null, isSuperuser: true });
    expect(await currentOperationAuthority("human", "unknown_operation")).toBeNull();
  });
});
