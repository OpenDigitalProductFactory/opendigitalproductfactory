// BI-FCDCAE98: the interpreter and compatibility paths reach the same installed
// graph. Its pure identity/diagnostic dependency closure stays compiler-free.

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as interpreter from "@dpf/validators/gpp/interpreter";

import * as flowGraph from "@dpf/validators/workroom/flow-graph";

const KERNEL = join(__dirname, "..", "..", "..", "..", "packages", "validators", "src");

/** Runtime imports/re-exports, including the bridges that replaced local bodies. */
function runtimeImports(relativePath: string): string[] {
  const source = readFileSync(isAbsolute(relativePath) ? relativePath : join(KERNEL, relativePath), "utf8");
  return [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((match) => match[1]!);
}

describe("work-shape-flow-graph.ts", () => {
  it("interpreter.ts re-exports the moved functions as the very same objects", () => {
    expect(interpreter.buildShapeFlowGraph).toBe(flowGraph.buildShapeFlowGraph);
    expect(interpreter.forwardReach).toBe(flowGraph.forwardReach);
    expect(interpreter.backwardReach).toBe(flowGraph.backwardReach);
  });

  it("bridges to the installed graph whose identity closure has no schema, resolver or design rule", () => {
    const graph = "@opendigitalproductfactory/dpf-workroom/flow-graph";
    const ids = "@opendigitalproductfactory/dpf-workroom/process/element-ids";
    const diagnostics = "@opendigitalproductfactory/dpf-workroom/process/diagnostics";
    const constructs = "@opendigitalproductfactory/dpf-workroom/process/executable-constructs";
    expect(runtimeImports("workroom/flow-graph.ts")).toEqual([graph]);
    expect(runtimeImports("gpp/element-ids.ts")).toEqual([ids]);
    expect(runtimeImports("gpp/diagnostics.ts")).toEqual([diagnostics]);
    expect(runtimeImports("gpp/executable-constructs.ts")).toEqual([constructs]);
    expect(runtimeImports(fileURLToPath(import.meta.resolve(graph)))).toEqual(["../gpp/element-ids.js"]);
    expect(runtimeImports(fileURLToPath(import.meta.resolve(ids)))).toEqual(["./diagnostics.js"]);
    expect(runtimeImports(fileURLToPath(import.meta.resolve(diagnostics)))).toEqual(["./executable-constructs.js"]);
    expect(runtimeImports(fileURLToPath(import.meta.resolve(constructs)))).toEqual([]);
  });
});
