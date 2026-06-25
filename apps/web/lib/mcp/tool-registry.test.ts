import { describe, expect, it } from "vitest";

import { DELIBERATION_TOOLS } from "@/lib/mcp-tools-deliberation";
import { SIEM_TOOLS } from "@/lib/mcp-tools-siem";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { deliberationSiemPack } from "./packs/deliberation-siem-pack";
import { composeToolPacks } from "./tool-registry";

// BI-ARCH-TOOLPACKS parity guard: the first extracted pack must stay
// behaviourally identical to the inline registration it replaced.

describe("deliberation-siem tool pack", () => {
  it("bundles exactly the deliberation + SIEM definitions", () => {
    const expected = [...DELIBERATION_TOOLS, ...SIEM_TOOLS].map((t) => t.name).sort();
    expect(deliberationSiemPack.definitions.map((t) => t.name).sort()).toEqual(expected);
  });

  it("has a handler for every definition it owns", () => {
    for (const def of deliberationSiemPack.definitions) {
      expect(deliberationSiemPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(deliberationSiemPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of deliberationSiemPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("composeToolPacks", () => {
  it("composes definitions + handler/grant lookup from packs", () => {
    const registry = composeToolPacks([deliberationSiemPack]);
    expect(registry.definitions).toHaveLength(deliberationSiemPack.definitions.length);
    expect(registry.getHandler("deliberate_on")).toBeTypeOf("function");
    expect(registry.getHandler("not_a_tool")).toBeUndefined();
    expect(registry.getGrants("open_security_case")).toEqual(["siem_investigate"]);
  });

  it("rejects the same tool name claimed by two packs", () => {
    expect(() => composeToolPacks([deliberationSiemPack, deliberationSiemPack])).toThrow(
      /Duplicate tool/,
    );
  });
});
