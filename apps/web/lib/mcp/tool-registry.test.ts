import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { DELIBERATION_TOOLS } from "@/lib/mcp-tools-deliberation";
import { SIEM_TOOLS } from "@/lib/mcp-tools-siem";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { deliberationSiemPack } from "./packs/deliberation-siem-pack";
import { runtimeCoordinationPack } from "./packs/runtime-coordination-pack";
import { workCapsulesPack } from "./packs/work-capsules-pack";
import { workbooksPack } from "./packs/workbooks-pack";
import { feedbackPack } from "./packs/feedback-pack";
import { activityRoutingPack } from "./packs/activity-routing-pack";
import { selfUpgradePack } from "./packs/self-upgrade-pack";
import { composeToolPacks } from "./tool-registry";
// The inline-case ratchet's extractor lives in the CI guard (scripts/), kept as
// the single source of truth so this test and the guard can never disagree.
import { extractInlineCaseNames } from "../../../../scripts/check-mcp-tool-pack.mjs";

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

describe("feedback tool pack", () => {
  it("bundles its three feedback tools, each with a handler", () => {
    expect(feedbackPack.definitions.map((t) => t.name).sort()).toEqual([
      "escalate_feedback_upstream",
      "register_tech_debt",
      "report_quality_issue",
    ]);
    for (const def of feedbackPack.definitions) {
      expect(feedbackPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(feedbackPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of feedbackPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("activity-routing tool pack", () => {
  it("bundles the harness confidence approval acknowledgement tool", () => {
    expect(activityRoutingPack.definitions.map((t) => t.name)).toEqual([
      "activity_harness_confidence_override",
    ]);
    for (const def of activityRoutingPack.definitions) {
      expect(activityRoutingPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(activityRoutingPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of activityRoutingPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("self-upgrade tool pack", () => {
  it("bundles the governed self-upgrade request tool", () => {
    expect(selfUpgradePack.definitions.map((t) => t.name)).toEqual([
      "request_self_upgrade",
    ]);
    for (const def of selfUpgradePack.definitions) {
      expect(selfUpgradePack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(selfUpgradePack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of selfUpgradePack.definitions) {
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

  it("composes all five real packs without collision", () => {
    const registry = composeToolPacks([
      deliberationSiemPack,
      runtimeCoordinationPack,
      workCapsulesPack,
      workbooksPack,
      feedbackPack,
      selfUpgradePack,
    ]);
    expect(registry.definitions).toHaveLength(
      deliberationSiemPack.definitions.length +
        runtimeCoordinationPack.definitions.length +
        workCapsulesPack.definitions.length +
        workbooksPack.definitions.length +
        feedbackPack.definitions.length +
        selfUpgradePack.definitions.length,
    );
    expect(registry.getHandler("register_runtime_target")).toBeTypeOf("function");
    expect(registry.getHandler("create_work_capsule")).toBeTypeOf("function");
    expect(registry.getHandler("workbook_list_tables")).toBeTypeOf("function");
    expect(registry.getHandler("report_quality_issue")).toBeTypeOf("function");
    expect(registry.getHandler("request_self_upgrade")).toBeTypeOf("function");
  });

  it("rejects the same tool name claimed by two packs", () => {
    expect(() => composeToolPacks([deliberationSiemPack, deliberationSiemPack])).toThrow(
      /Duplicate tool/,
    );
  });
});

// BI-OPT-RATCHETS: inline executeTool `case` arms in mcp-tools.ts are a frozen
// set that may only SHRINK. New MCP tools must land in a pack, not the switch.
// The CI guard (scripts/check-mcp-tool-pack.mjs) enforces this against
// scripts/mcp-tool-pack-baseline.json; this test asserts the same invariant in
// the unit suite so it fails fast in the same run as the pack tests above.
describe("executeTool inline-case ratchet", () => {
  // tool-registry.test.ts -> mcp -> lib -> web -> apps -> <repo root>.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const mcpToolsSource = readFileSync(join(repoRoot, "apps/web/lib/mcp-tools.ts"), "utf8");
  const baseline: string[] = JSON.parse(
    readFileSync(join(repoRoot, "scripts/mcp-tool-pack-baseline.json"), "utf8"),
  );
  const inlineCases = extractInlineCaseNames(mcpToolsSource);

  it("locates the switch body and extracts a plausible number of inline cases", () => {
    // Guards against a refactor that silently breaks the extractor (e.g. the
    // switch is renamed) and makes the ratchet vacuously pass.
    expect(inlineCases.length).toBeGreaterThan(100);
    expect(new Set(inlineCases).size).toBe(inlineCases.length); // no duplicate arms
  });

  it("adds no inline case beyond the frozen baseline (new tools go in a pack)", () => {
    const baselineSet = new Set(baseline);
    const added = inlineCases.filter((name) => !baselineSet.has(name));
    expect(added, `new inline executeTool cases — register these in a pack instead: ${added.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps the baseline in sync — no stale entries once a tool is extracted", () => {
    const currentSet = new Set(inlineCases);
    const removed = baseline.filter((name) => !currentSet.has(name));
    expect(
      removed,
      `baseline lists tools no longer inline — run \`node scripts/check-mcp-tool-pack.mjs --update\`: ${removed.join(", ")}`,
    ).toEqual([]);
  });
});
