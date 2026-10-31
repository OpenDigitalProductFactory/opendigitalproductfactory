import { describe, expect, it, vi } from "vitest";

import { withEngagementFulfillment } from "./coworker-service-catalog-pack";
import { TOOL_PACK_REGISTRY } from "../pack-registry";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const adapter = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, data: { status: "accepted" } }));
vi.mock("@/lib/mcp/external-coworker-task-adapter", () => ({ fulfillCoworkerEngagement: adapter }));

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

it("binds the supported fulfillment port without exposing a caller-selected executor", async () => {
  const fulfill = vi.fn().mockResolvedValue({ success: true, data: { status: "accepted" } });
  const pack = withEngagementFulfillment(fulfill);
  const context = { agentId: "AGT-EXT-CODEX" };
  await expect(pack.handlers.request_coworker_engagement({ engagementId: "CE-724328D6" }, "operator", context)).resolves.toMatchObject({ success: true });
  expect(fulfill).toHaveBeenCalledExactlyOnceWith("CE-724328D6", undefined, "operator", context, { engagementId: "CE-724328D6" });
  await expect(pack.handlers.request_coworker_engagement({ engagementId: "CE-724328D6", requestedOutcome: "replacement" }, "operator", context)).resolves.toMatchObject({ success: false, error: "invalid_engagement_resume" });
  expect(fulfill).toHaveBeenCalledTimes(1);
});
it("the runtime registry binds fulfillment to the governed adapter", async () => {
  const handler = TOOL_PACK_REGISTRY.getHandler("request_coworker_engagement")!;
  const context = { agentId: "AGT-EXT-CODEX" };
  await expect(handler({ engagementId: "CE-724328D6" }, "operator", context)).resolves.toMatchObject({ success: true });
  expect(adapter).toHaveBeenCalledExactlyOnceWith("CE-724328D6", undefined, "operator", context, undefined, { engagementId: "CE-724328D6" });
});
