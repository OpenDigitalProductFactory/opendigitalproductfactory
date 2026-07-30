// Gate-context tool pack tests (BI-121DC3A3).
//
// The single-source acceptance from the BI: the MCP tool must return the
// IDENTICAL pack the CLI emits for the same inputs — proven by running both
// against the real generator and comparing the structured output.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { gateContextPack } from "./gate-context-pack";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");

const EXPECTED_TOOLS = ["get_change_gate_context"];

describe("gateContextPack shape", () => {
  it("declares matching definitions, handlers, and grants", () => {
    expect(gateContextPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(gateContextPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(gateContextPack.grants).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("is read-only", () => {
    for (const definition of gateContextPack.definitions) {
      expect(definition.sideEffect).toBe(false);
    }
  });
});

describe("get_change_gate_context", () => {
  it("acceptance: returns the identical pack the CLI emits for the same paths", async () => {
    const paths = [
      { path: "apps/web/instrumentation.ts", status: "M" },
      { path: "packages/db/prisma/schema.prisma", status: "M" },
    ];
    const previousRepoRoot = process.env.DPF_REPO_ROOT;
    process.env.DPF_REPO_ROOT = repoRoot;
    try {
      const result = await gateContextPack.handlers.get_change_gate_context({ paths }, "tester");
      expect(result.success).toBe(true);
      expect(String(result.message)).toContain("Gate context");

      const cliJson = JSON.parse(execFileSync(
        process.execPath,
        [join(repoRoot, "scripts", "gate-context.mjs"), "--stdin-json", "--json"],
        { cwd: repoRoot, input: JSON.stringify({ changedFiles: paths }), encoding: "utf8" },
      ));
      const toolPack = (result.data as { pack: Record<string, unknown> }).pack;
      expect(toolPack).toEqual(cliJson);
    } finally {
      if (previousRepoRoot === undefined) delete process.env.DPF_REPO_ROOT;
      else process.env.DPF_REPO_ROOT = previousRepoRoot;
    }
  }, 30_000);
});
