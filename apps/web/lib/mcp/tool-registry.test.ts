import { describe, expect, it } from "vitest";

import { DELIBERATION_TOOLS } from "@/lib/mcp-tools-deliberation";
import { SIEM_TOOLS } from "@/lib/mcp-tools-siem";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { deliberationSiemPack } from "./packs/deliberation-siem-pack";
import { runtimeCoordinationPack } from "./packs/runtime-coordination-pack";
import { workCapsulesPack } from "./packs/work-capsules-pack";
import { workbooksPack } from "./packs/workbooks-pack";
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

describe("runtime-coordination tool pack", () => {
  it("bundles its five runtime tools, each with a (lazy) handler", () => {
    expect(runtimeCoordinationPack.definitions.map((t) => t.name).sort()).toEqual([
      "get_runtime_coordination_map",
      "heartbeat_runtime_target",
      "record_runtime_verification",
      "register_runtime_target",
      "release_runtime_target",
    ]);
    for (const def of runtimeCoordinationPack.definitions) {
      expect(runtimeCoordinationPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(runtimeCoordinationPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of runtimeCoordinationPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("work-capsules tool pack", () => {
  it("has a (lazy) handler for every definition", () => {
    for (const def of workCapsulesPack.definitions) {
      expect(workCapsulesPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(workCapsulesPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of workCapsulesPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("workbooks tool pack", () => {
  it("has a (lazy) handler for every definition", () => {
    for (const def of workbooksPack.definitions) {
      expect(workbooksPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(workbooksPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of workbooksPack.definitions) {
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

  it("composes all four real packs without collision", () => {
    const registry = composeToolPacks([
      deliberationSiemPack,
      runtimeCoordinationPack,
      workCapsulesPack,
      workbooksPack,
    ]);
    expect(registry.definitions).toHaveLength(
      deliberationSiemPack.definitions.length +
        runtimeCoordinationPack.definitions.length +
        workCapsulesPack.definitions.length +
        workbooksPack.definitions.length,
    );
    expect(registry.getHandler("register_runtime_target")).toBeTypeOf("function");
    expect(registry.getHandler("create_work_capsule")).toBeTypeOf("function");
    expect(registry.getHandler("workbook_list_tables")).toBeTypeOf("function");
  });

  it("rejects the same tool name claimed by two packs", () => {
    expect(() => composeToolPacks([deliberationSiemPack, deliberationSiemPack])).toThrow(
      /Duplicate tool/,
    );
  });
});
