import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "@/lib/mcp-tools";

import { adviseHeldBackTools, buildAdvisePromptSuffix, filterToolsForCoworkerRuntime } from "./coworker-tool-filter";

const tool = (over: Partial<ToolDefinition> & { name: string }): ToolDefinition =>
  ({
    description: `${over.name} description`,
    inputSchema: { type: "object", properties: {}, required: [] },
    ...over,
  }) as ToolDefinition;

const READ = tool({ name: "list_backlog_items" });
const WRITE = tool({ name: "create_backlog_item", sideEffect: true });
const PROVISION = tool({ name: "manage_coworker_tool_grant", sideEffect: true });
const ARTIFACT = tool({ name: "save_marketing_review", sideEffect: true, coworkerArtifact: true });
// Coworker→coworker delegation: side-effecting but advise-safe coordination.
const REQUEST_PEER = tool({ name: "request_coworker", sideEffect: true, adviseCoordination: true });
const SUMMON_PEER = tool({ name: "summon_coworker", sideEffect: true, adviseCoordination: true });

const MERGED = [READ, WRITE, PROVISION, ARTIFACT];

describe("filterToolsForCoworkerRuntime — advise rule", () => {
  it("strips side-effect tools but keeps reads and coworker artifacts in advise mode", () => {
    const kept = filterToolsForCoworkerRuntime(MERGED, { coworkerMode: "advise", activeBuildPhase: null }).map((t) => t.name);
    expect(kept).toEqual(["list_backlog_items", "save_marketing_review"]);
  });

  it("keeps coworker→coworker delegation in advise mode but still strips destructive writes", () => {
    // BI-7EB4AE2C: an advise-mode coworker must be able to hand a scoped sub-task
    // to a named peer (coordination), while a genuinely destructive write stays muzzled.
    const merged = [READ, WRITE, REQUEST_PEER, SUMMON_PEER];
    const kept = filterToolsForCoworkerRuntime(merged, {
      coworkerMode: "advise",
      activeBuildPhase: null,
    }).map((t) => t.name);
    expect(kept).toContain("request_coworker");
    expect(kept).toContain("summon_coworker");
    // The destructive write is still stripped — the exemption is targeted, not blanket.
    expect(kept).not.toContain("create_backlog_item");
    expect(kept).toEqual(["list_backlog_items", "request_coworker", "summon_coworker"]);
  });

  it("does not list delegation tools as advise-held-back (they are not muzzled)", () => {
    const held = adviseHeldBackTools([WRITE, REQUEST_PEER, SUMMON_PEER]).map((t) => t.name);
    expect(held).toEqual(["create_backlog_item"]);
  });

  it("keeps everything in act mode", () => {
    const kept = filterToolsForCoworkerRuntime(MERGED, { coworkerMode: "act", activeBuildPhase: null }).map((t) => t.name);
    expect(kept).toEqual(["list_backlog_items", "create_backlog_item", "manage_coworker_tool_grant", "save_marketing_review"]);
  });

  it("KEEPS side-effect tools in advise mode when surfaceAsProposals is on (BI-867263F4)", () => {
    // Advise now proposes: the tools stay so the loop can capture each call as an
    // approval card, instead of stripping them and describing in prose.
    const kept = filterToolsForCoworkerRuntime(MERGED, {
      coworkerMode: "advise",
      surfaceAsProposals: true,
      activeBuildPhase: null,
    }).map((t) => t.name);
    expect(kept).toEqual(["list_backlog_items", "create_backlog_item", "manage_coworker_tool_grant", "save_marketing_review"]);
  });

  it("still strips in advise mode when surfaceAsProposals is off (default unchanged)", () => {
    const kept = filterToolsForCoworkerRuntime(MERGED, {
      coworkerMode: "advise",
      surfaceAsProposals: false,
      activeBuildPhase: null,
    }).map((t) => t.name);
    expect(kept).toEqual(["list_backlog_items", "save_marketing_review"]);
  });
});

describe("adviseHeldBackTools", () => {
  it("returns exactly the side-effect, non-artifact tools the advise rule removes", () => {
    const held = adviseHeldBackTools(MERGED).map((t) => t.name);
    expect(held).toEqual(["create_backlog_item", "manage_coworker_tool_grant"]);
  });

  it("is the complement of the advise-filtered set (held-back = merged − kept, minus artifacts)", () => {
    const kept = new Set(
      filterToolsForCoworkerRuntime(MERGED, { coworkerMode: "advise", activeBuildPhase: null }).map((t) => t.name),
    );
    const held = adviseHeldBackTools(MERGED);
    // Nothing held back is also kept, and every held-back tool is a stripped side-effect tool.
    for (const t of held) {
      expect(kept.has(t.name)).toBe(false);
      expect(t.sideEffect).toBe(true);
      expect(t.coworkerArtifact).toBeFalsy();
    }
  });

  it("returns empty when the coworker holds no side-effecting authority", () => {
    expect(adviseHeldBackTools([READ, ARTIFACT])).toEqual([]);
  });
});

describe("buildAdvisePromptSuffix (BI-867263F4)", () => {
  it("tells the coworker its recommendations become approval cards when surfacing proposals", () => {
    const suffix = buildAdvisePromptSuffix({ coworkerMode: "advise", surfaceAsProposals: true, mergedTools: MERGED });
    expect(suffix).toContain("YOUR RECOMMENDATIONS BECOME APPROVAL CARDS");
    expect(suffix).toContain("do NOT just describe them in prose");
    // It must NOT use the old muzzle framing that held the tools back.
    expect(suffix).not.toContain("AUTHORITY HELD BACK");
  });

  it("falls back to the held-back muzzle note in advise mode without surfacing", () => {
    const suffix = buildAdvisePromptSuffix({ coworkerMode: "advise", surfaceAsProposals: false, mergedTools: MERGED });
    expect(suffix).toContain("AUTHORITY HELD BACK");
    expect(suffix).toContain("create_backlog_item");
  });

  it("returns empty for act mode", () => {
    expect(buildAdvisePromptSuffix({ coworkerMode: "act", mergedTools: MERGED })).toBe("");
  });

  it("returns empty when advise mode holds no side-effecting authority (nothing to muzzle)", () => {
    expect(buildAdvisePromptSuffix({ coworkerMode: "advise", surfaceAsProposals: false, mergedTools: [READ, ARTIFACT] })).toBe("");
  });
});
