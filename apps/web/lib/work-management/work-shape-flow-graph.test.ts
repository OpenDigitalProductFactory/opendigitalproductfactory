// The flow graph's new home (BI-8875C9DF, GPP Phase 3c PR-3c-1). Plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, work-shape-flow-graph.ts): a move, not a rewrite; interpreter.ts
// re-exports the moved names; and the module's only import, element-ids.ts,
// has no runtime dependency on the compiler.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as interpreter from "@/lib/gpp/shape-language/interpreter";

import * as flowGraph from "./work-shape-flow-graph";

const WEB = join(__dirname, "..", "..");

/** The module specifiers a source file imports at runtime (type-only imports excluded). */
function runtimeImports(relativePath: string): string[] {
  const source = readFileSync(join(WEB, relativePath), "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((match) => match[1]!);
}

describe("work-shape-flow-graph.ts", () => {
  it("interpreter.ts re-exports the moved functions as the very same objects", () => {
    expect(interpreter.buildShapeFlowGraph).toBe(flowGraph.buildShapeFlowGraph);
    expect(interpreter.forwardReach).toBe(flowGraph.forwardReach);
    expect(interpreter.backwardReach).toBe(flowGraph.backwardReach);
  });

  it("imports only element-ids, whose runtime dependencies are plain constants: no schema, resolver or design rule", () => {
    expect(runtimeImports("lib/work-management/work-shape-flow-graph.ts")).toEqual(["@/lib/gpp/shape-language/element-ids"]);
    expect(runtimeImports("lib/gpp/shape-language/element-ids.ts")).toEqual(["./diagnostics"]);
    expect(runtimeImports("lib/gpp/shape-language/diagnostics.ts")).toEqual(["./executable-constructs"]);
    expect(runtimeImports("lib/gpp/shape-language/executable-constructs.ts")).toEqual([]);
  });
});
