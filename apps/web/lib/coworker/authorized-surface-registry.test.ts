import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import {
  ALL_SURFACE_DEFINITIONS,
  AUTHORIZED_SURFACE_CATALOG,
} from "./authorized-surface-registry";

describe("Authorized Surface fleet conformance", () => {
  it("compiles every definition into one deterministic catalog with no executable/browser-only metadata", () => {
    expect(AUTHORIZED_SURFACE_CATALOG.definitions).toHaveLength(ALL_SURFACE_DEFINITIONS.length);
    expect(AUTHORIZED_SURFACE_CATALOG.digest).toMatch(/^[a-f0-9]{64}$/);
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(() => JSON.stringify(definition)).not.toThrow();
      expect(JSON.stringify(definition)).not.toMatch(/\b(window|document|HTMLElement|onClick)\b/);
    }
  });

  it("requires every persistent surface action to bind a real side-effect tool with grant metadata", () => {
    const tools = new Map(PLATFORM_TOOLS.map((tool) => [tool.name, tool]));
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      for (const action of definition.actions.filter((candidate) => candidate.actionClass === "domain")) {
        expect(action.tool, `${definition.surfaceId}:${action.actionId}`).toBeTruthy();
        expect(tools.get(action.tool!)?.sideEffect, action.tool).toBe(true);
        expect(TOOL_TO_GRANTS[action.tool!], action.tool).toBeDefined();
      }
    }
  });

  it("keeps stable surface/node/action ids unique across the fleet", () => {
    const surfaceIds = new Set<string>();
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(surfaceIds.has(definition.surfaceId)).toBe(false);
      surfaceIds.add(definition.surfaceId);
      expect(new Set(definition.nodes.map((node) => node.nodeId)).size).toBe(definition.nodes.length);
      expect(new Set(definition.actions.map((action) => action.actionId)).size).toBe(definition.actions.length);
    }
  });
});
