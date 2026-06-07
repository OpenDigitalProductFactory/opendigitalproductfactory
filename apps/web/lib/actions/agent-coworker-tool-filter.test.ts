import { describe, it, expect } from "vitest";
import { filterToolsForCoworkerRuntime } from "./coworker-tool-filter";
import type { ToolDefinition } from "../mcp-tools";

function tool(name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: null,
    ...overrides,
  };
}

describe("filterToolsForCoworkerRuntime", () => {
  it("keeps read-only tools in advise mode", () => {
    const tools = [tool("get_marketing_summary", { sideEffect: false })];
    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "advise", activeBuildPhase: null });
    expect(out.map((t) => t.name)).toEqual(["get_marketing_summary"]);
  });

  it("strips side-effect tools in advise mode", () => {
    const tools = [tool("publish_landing_page", { sideEffect: true })];
    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "advise", activeBuildPhase: null });
    expect(out).toEqual([]);
  });

  it("keeps coworkerArtifact tools in advise mode even when side-effect", () => {
    const tools = [
      tool("save_marketing_review", { sideEffect: true, coworkerArtifact: true }),
      tool("create_marketing_campaign_brief", { sideEffect: true, coworkerArtifact: true }),
      tool("create_marketing_asset_task", { sideEffect: true, coworkerArtifact: true }),
      tool("record_marketing_kpi_checkpoint", { sideEffect: true, coworkerArtifact: true }),
      tool("create_marketing_automation_candidate", { sideEffect: true, coworkerArtifact: true }),
      tool("publish_landing_page", { sideEffect: true }),
    ];
    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "advise", activeBuildPhase: null });
    expect(out.map((t) => t.name).sort()).toEqual([
      "create_marketing_asset_task",
      "create_marketing_automation_candidate",
      "create_marketing_campaign_brief",
      "record_marketing_kpi_checkpoint",
      "save_marketing_review",
    ]);
  });

  it("keeps side-effect tools in act mode", () => {
    const tools = [
      tool("save_marketing_review", { sideEffect: true, coworkerArtifact: true }),
      tool("publish_landing_page", { sideEffect: true }),
    ];
    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "act", activeBuildPhase: null });
    expect(out.map((t) => t.name).sort()).toEqual(["publish_landing_page", "save_marketing_review"]);
  });

  it("filters by build phase when active phase is set", () => {
    const tools = [
      tool("ideate_only", { sideEffect: false, buildPhases: ["ideate"] }),
      tool("plan_only", { sideEffect: false, buildPhases: ["plan"] }),
      tool("no_phase_tool", { sideEffect: false }),
    ];
    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "act", activeBuildPhase: "ideate" });
    expect(out.map((t) => t.name)).toEqual(["ideate_only"]);
  });

  it("keeps only terminal-build recovery and navigation tools for abandoned builds", () => {
    const tools = [
      tool("saveBuildEvidence", { sideEffect: false, buildPhases: ["ideate", "plan", "build", "review", "ship"] }),
      tool("reviewBuildPlan", { sideEffect: false, buildPhases: ["plan"] }),
      tool("get_build_progress_visibility", { sideEffect: false, buildPhases: ["ideate", "plan", "build", "review", "ship"] }),
      tool("screen_select_entity", { sideEffect: true }),
      tool("screen_navigate", { sideEffect: true }),
      tool("create_backlog_item", { sideEffect: true }),
      tool("search_project_files", { sideEffect: false }),
    ];

    const out = filterToolsForCoworkerRuntime(tools, { coworkerMode: "act", activeBuildPhase: "abandoned" });

    expect(out.map((t) => t.name).sort()).toEqual([
      "get_build_progress_visibility",
      "screen_navigate",
      "screen_select_entity",
    ]);
  });
});
