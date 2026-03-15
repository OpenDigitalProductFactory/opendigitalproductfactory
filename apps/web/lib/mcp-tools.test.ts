import { describe, expect, it } from "vitest";
import { getAvailableTools } from "./mcp-tools";

describe("mcp tools", () => {
  const adminUser = {
    userId: "user-1",
    platformRole: "HR-000",
    isSuperuser: false,
  };

  it("hides external tools when external access is off", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });

    expect(tools.some((tool) => tool.name === "search_public_web")).toBe(false);
    expect(tools.some((tool) => tool.name === "fetch_public_website")).toBe(false);
    expect(tools.some((tool) => tool.name === "analyze_public_website_branding")).toBe(false);
  });

  it("shows external tools when external access is on", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: true });

    expect(tools.some((tool) => tool.name === "search_public_web")).toBe(true);
    expect(tools.some((tool) => tool.name === "fetch_public_website")).toBe(true);
    expect(tools.some((tool) => tool.name === "analyze_public_website_branding")).toBe(true);
  });

  it("includes build tools for platform users", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("update_feature_brief");
    expect(toolNames).toContain("register_digital_product_from_build");
    expect(toolNames).toContain("create_build_epic");
  });

  it("update_feature_brief requires view_platform capability", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "update_feature_brief");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_platform");
  });

  it("register_digital_product_from_build requires manage_capabilities", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "register_digital_product_from_build");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("manage_capabilities");
  });
});
