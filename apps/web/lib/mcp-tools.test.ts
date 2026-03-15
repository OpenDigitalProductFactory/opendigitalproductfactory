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
});
