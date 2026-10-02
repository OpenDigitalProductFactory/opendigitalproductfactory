// GPP Phase 2, PR-C — the hand-declared binding table.
// §5.4 ordering: a binding may only name a gate that exists. Constraint 2:
// bindings cover outward/authority/irreversible calls only, never a read or an
// ordinary write.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";

import { GPP_BINDINGS, bindingForAdmittedCall, bindingRef } from "./bindings";
import { WEB_ROOT } from "./source-files";

describe("GPP bindings", () => {
  it("declares exactly the two Phase 2 seeds", () => {
    expect(GPP_BINDINGS.map(bindingRef)).toEqual(["tak-alignment-admit@1", "human-checkpoint-admit@1"]);
  });

  it("has unique binding ids", () => {
    const ids = GPP_BINDINGS.map((binding) => binding.bindingId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GPP_BINDINGS.map((binding) => [bindingRef(binding), binding] as const))(
    "%s names a resolver that is an exported, implemented gate function",
    async (_ref, binding) => {
      const mod = (await import(pathToFileURL(join(WEB_ROOT, `${binding.resolver.module}.ts`)).href)) as Record<string, unknown>;
      expect(typeof mod[binding.resolver.exportName]).toBe("function");
    },
  );

  const classified = PLATFORM_TOOLS.map((tool) => ({
    name: tool.name,
    consequential: classifyConsequentialTool({ toolName: tool.name, tool }).consequential,
  }));

  it("no binding covers a routine read or an ordinary write", () => {
    const readsAndWrites = classified.filter((tool) => !tool.consequential);
    expect(readsAndWrites.length).toBeGreaterThan(0);
    for (const binding of GPP_BINDINGS) {
      const covered = readsAndWrites.filter((tool) => binding.toolPredicate({ consequential: tool.consequential }));
      expect(covered.map((tool) => tool.name), bindingRef(binding)).toEqual([]);
    }
  });

  it("every tool a binding covers is O/A/I, unless the binding's reason is c5", () => {
    for (const binding of GPP_BINDINGS) {
      if (binding.reason === "c5") continue;
      const covered = classified.filter((tool) => binding.toolPredicate({ consequential: tool.consequential }));
      expect(covered.length, bindingRef(binding)).toBeGreaterThan(0);
      expect(covered.every((tool) => tool.consequential), bindingRef(binding)).toBe(true);
    }
  });

  it("declares no c5 binding while C-5 combinations are not computed", () => {
    expect(GPP_BINDINGS.filter((binding) => binding.reason === "c5")).toEqual([]);
  });

  describe("bindingForAdmittedCall", () => {
    const oai = { consequential: true };

    it("is null when no gate admitted the call (ungoverned)", () => {
      expect(bindingForAdmittedCall({ tool: oai, alignmentApproved: false, approvedEnvelopeId: null })).toBeNull();
    });
    it("picks the alignment binding when the alignment gate approved", () => {
      expect(bindingForAdmittedCall({ tool: oai, alignmentApproved: true, approvedEnvelopeId: null })?.bindingId)
        .toBe("tak-alignment-admit");
    });
    it("picks the human-checkpoint binding for an approved envelope", () => {
      expect(bindingForAdmittedCall({ tool: oai, alignmentApproved: false, approvedEnvelopeId: "env-1" })?.bindingId)
        .toBe("human-checkpoint-admit");
    });
    it("never binds an R or W call, whatever admitted it", () => {
      expect(bindingForAdmittedCall({ tool: { consequential: false }, alignmentApproved: true, approvedEnvelopeId: "env-1" }))
        .toBeNull();
    });
  });
});
