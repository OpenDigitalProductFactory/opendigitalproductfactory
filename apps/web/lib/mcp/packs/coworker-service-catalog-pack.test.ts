import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

describe("coworker service catalog MCP surface", () => {
  it("exposes governed discovery and engagement tools", () => {
    const names = PLATFORM_TOOLS.map((tool) => tool.name);

    expect(names).toContain("list_coworker_services");
    expect(names).toContain("list_coworker_offers");
    expect(names).toContain("get_coworker_offer");
    expect(names).toContain("resolve_coworker_offer_agent_card");
    expect(names).toContain("request_coworker_engagement");
    expect(names).toContain("analyze_coworker_engagement_refinement");
  });

  it("maps catalog tools to explicit coworker catalog grants", () => {
    expect(TOOL_TO_GRANTS.list_coworker_services).toEqual(["coworker_catalog_read"]);
    expect(TOOL_TO_GRANTS.list_coworker_offers).toEqual(["coworker_catalog_read"]);
    expect(TOOL_TO_GRANTS.get_coworker_offer).toEqual(["coworker_catalog_read"]);
    expect(TOOL_TO_GRANTS.resolve_coworker_offer_agent_card).toEqual(["coworker_catalog_read"]);
    expect(TOOL_TO_GRANTS.request_coworker_engagement).toEqual(["coworker_engagement_write"]);
    expect(TOOL_TO_GRANTS.analyze_coworker_engagement_refinement).toEqual(["coworker_catalog_read"]);
  });
});
