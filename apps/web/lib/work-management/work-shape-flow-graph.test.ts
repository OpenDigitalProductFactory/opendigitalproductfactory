// The flow graph's new home (BI-8875C9DF, GPP Phase 3c PR-3c-1). Plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, work-shape-flow-graph.ts): a move, not a rewrite; interpreter.ts
// re-exports the moved names; and the module's only import, element-ids.ts,
// has no runtime dependency on the compiler.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as interpreter from "@/lib/gpp/shape-language/interpreter";

import * as flowGraph from "@dpf/validators/workroom/flow-graph";

const KERNEL = join(__dirname, "..", "..", "..", "..", "packages", "validators", "src");

/** The module specifiers a source file imports at runtime (type-only imports excluded). */
function runtimeImports(relativePath: string): string[] {
  const source = readFileSync(join(KERNEL, relativePath), "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((match) => match[1]!);
}

describe("work-shape-flow-graph.ts", () => {
  it("interpreter.ts re-exports the moved functions as the very same objects", () => {
    expect(interpreter.buildShapeFlowGraph).toBe(flowGraph.buildShapeFlowGraph);
    expect(interpreter.forwardReach).toBe(flowGraph.forwardReach);
    expect(interpreter.backwardReach).toBe(flowGraph.backwardReach);
  });

  it("imports only element-ids, whose runtime dependencies are plain constants: no schema, resolver or design rule", () => {
    expect(runtimeImports("workroom/flow-graph.ts")).toEqual(["../gpp/element-ids.js"]);
    expect(runtimeImports("gpp/element-ids.ts")).toEqual(["./diagnostics.js"]);
    expect(runtimeImports("gpp/diagnostics.ts")).toEqual(["./executable-constructs.js"]);
    expect(runtimeImports("gpp/executable-constructs.ts")).toEqual([]);
  });
});
