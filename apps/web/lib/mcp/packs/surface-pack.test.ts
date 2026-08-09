import { describe, expect, it } from "vitest";

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

import { surfacePack } from "./surface-pack";

const NAMES = [
  "surface_list",
  "surface_open",
  "surface_snapshot",
  "surface_query",
  "surface_act",
  "surface_close",
];

describe("Authorized Surface MCP pack", () => {
  it("publishes exactly the compact generic protocol with matching handlers and grants", () => {
    expect(surfacePack.definitions.map((definition) => definition.name)).toEqual(NAMES);
    expect(Object.keys(surfacePack.handlers)).toEqual(NAMES);
    for (const name of NAMES) {
      expect(surfacePack.grants[name]).toBeDefined();
      expect(isToolAllowedByGrants(name, [...surfacePack.grants[name]!])).toBe(true);
    }
  });

  it("keeps read operations read-only and surface_act as the sole domain-effect operation", () => {
    for (const definition of surfacePack.definitions) {
      if (definition.name === "surface_act") {
        expect(definition.sideEffect).toBe(true);
        continue;
      }
      expect(definition.sideEffect).toBe(false);
      expect(definition.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("fails closed when a caller has no acting coworker identity", async () => {
    const result = await surfacePack.handlers.surface_list({}, "user-1", {
      userContext: { platformRole: "HR-000", isSuperuser: true },
    });
    expect(result).toMatchObject({ success: false, error: "surface_not_authorized" });
  });
});
