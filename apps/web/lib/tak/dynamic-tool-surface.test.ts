import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tools";
import { recompileDynamicToolSurface } from "./dynamic-tool-surface";

const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  inputSchema: {},
  requiredCapability: null,
  executionMode: "immediate",
  sideEffect: name === "promote_to_build_studio",
});

describe("recompileDynamicToolSurface", () => {
  it("keeps TR-SCHED-FEB9C7ED at the 15-tool local ceiling by replacing lower-ranked tools", () => {
    const initial = [tool("load_tools"), ...Array.from({ length: 14 }, (_, index) => tool(`attached_${index + 1}`))];
    const loaded = [tool("get_backlog_item"), tool("promote_to_build_studio"), tool("get_build_progress_visibility")];

    const result = recompileDynamicToolSurface({ active: initial, requested: loaded, ceiling: 15 });

    expect(result.active).toHaveLength(15);
    expect(result.active.map(({ name }) => name)).toEqual(expect.arrayContaining(loaded.map(({ name }) => name)));
    expect(result.displaced.map(({ name }) => name)).toEqual(["attached_12", "attached_13", "attached_14"]);
    expect(result.unattached).toEqual([]);
  });
});
