import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPhaseRouteOptions, BUILD_PHASE_ROUTE_OPTIONS } from "./build-phase-route-options";

describe("buildPhaseRouteOptions (BI-F84887FF)", () => {
  it("never demands token streaming", () => {
    expect(BUILD_PHASE_ROUTE_OPTIONS.requiresStreaming).toBe(false);
    expect(buildPhaseRouteOptions().requiresStreaming).toBe(false);
  });

  it("keeps per-call extras and still turns streaming off", () => {
    const o = buildPhaseRouteOptions({ budgetClass: "minimize_cost", buildId: "FB-1", requiresStreaming: true });
    expect(o.budgetClass).toBe("minimize_cost");
    expect(o.buildId).toBe("FB-1");
    expect(o.requiresStreaming).toBe(false);
  });
});

// BI-77029256: BI-F84887FF fixed four phases and missed the rest. On 2026-09-24
// FB-1FAAA146's ideate research was skipped — "5 of 5 endpoints ... Missing
// required capability: streaming" — because ideate-dispatch.ts called
// routeAndCall with a hand-built options object and engine selection had picked
// codex. Every non-interactive Build Studio routeAndCall must state the demand.
describe("every Build Studio phase call states requiresStreaming:false (BI-77029256)", () => {
  const PHASE_FILES = [
    "ideate-dispatch.ts",
    "ideate-on-approval.ts",
    "plan-on-approval.ts",
    "propose-decomposition.ts",
    "phase-compaction.ts",
    "change-narrative.ts",
    "coding-agent.ts",
    // BI-77029256 follow-up: engine selection previews the route BEFORE any
    // phase call. After #5615 shipped, FB-1FAAA146 still logged "no eligible
    // endpoints task=code-gen" — this preview was the first wall.
    "build-engine-selection-runtime.ts",
  ];

  function routeAndCallArgs(source: string): string[] {
    const calls: string[] = [];
    let from = 0;
    for (;;) {
      const match = /\b(routeAndCall|previewRoute)\(/g;
      match.lastIndex = from;
      const found = match.exec(source);
      if (!found) return calls;
      const at = found.index;
      let depth = 0;
      let end = at + found[1].length;
      for (; end < source.length; end++) {
        if (source[end] === "(") depth++;
        else if (source[end] === ")" && --depth === 0) break;
      }
      calls.push(source.slice(at, end + 1));
      from = end;
    }
  }

  it.each(PHASE_FILES)("%s", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    const calls = routeAndCallArgs(source);
    expect(calls.length).toBeGreaterThan(0);
    const missing = calls.filter((call) => !/BUILD_PHASE_ROUTE_OPTIONS|buildPhaseRouteOptions\(/.test(call));
    expect(missing).toEqual([]);
  });
});
