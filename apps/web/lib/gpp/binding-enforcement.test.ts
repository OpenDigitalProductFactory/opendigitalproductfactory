// GPP Phase 2, PR-E — the per-binding enforcement table and its promotion ratchet.
//
// Promotion of a binding from shadow to enforced is possible ONLY through a
// checked-in entry in GPP_BINDING_ENFORCEMENT that this file accepts:
// - it cites a WWMD decision id (DI-...), a ratification date and evidence;
// - the binding names an explicit tool list, every tool outward, authority or
//   irreversible by the runtime's own classifier (classifyConsequentialTool);
// - none of those tools still has a direct executeTool site, and no dynamic
//   direct site exists that could reach them (§5.3 complete mediation);
// - the binding is not on the shrink-only KNOWN_SHADOW_BINDINGS list.
// The runtime override can only LOWER enforcement (`shadow-all`), never raise it.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-E).
import { afterEach, describe, expect, it, vi } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";

import {
  DECISION_ID_PATTERN,
  GPP_BINDING_ENFORCEMENT,
  KNOWN_SHADOW_BINDINGS,
  promotionRefusals,
  resolveBindingMode,
  setBindingEnforcementOverrideForTests,
  type BindingEnforcementEntry,
  type PromotionContext,
} from "./binding-enforcement";
import { GPP_BINDINGS, setGppBindingsOverrideForTests, type GppBinding } from "./bindings";
import { readWebSourceFiles } from "./source-files";
import { findUnmediatedExecuteSites, type CallSite } from "./unmediated-execute-sites";

afterEach(() => {
  setBindingEnforcementOverrideForTests(null);
  setGppBindingsOverrideForTests(null);
  vi.unstubAllEnvs();
});

const liveTools: PromotionContext["tools"] = PLATFORM_TOOLS.map((tool) => {
  const classification = classifyConsequentialTool({ toolName: tool.name, tool });
  return { name: tool.name, consequential: classification.consequential, alignmentRequired: classification.alignmentRequired };
});
const liveSites: CallSite[] = findUnmediatedExecuteSites(readWebSourceFiles());

function liveContext(): PromotionContext {
  return { bindings: GPP_BINDINGS, shadowList: KNOWN_SHADOW_BINDINGS, tools: liveTools, directSites: liveSites };
}

describe("the shipped enforcement table", () => {
  it("promotes no binding in this PR: the enforced set is empty", () => {
    expect(GPP_BINDING_ENFORCEMENT).toEqual({});
  });

  it("every declared binding is in exactly one of KNOWN_SHADOW_BINDINGS or GPP_BINDING_ENFORCEMENT", () => {
    for (const binding of GPP_BINDINGS) {
      const shadow = KNOWN_SHADOW_BINDINGS.includes(binding.bindingId);
      const enforced = Object.hasOwn(GPP_BINDING_ENFORCEMENT, binding.bindingId);
      expect(shadow !== enforced, `${binding.bindingId}: shadow=${shadow} enforced=${enforced}`).toBe(true);
    }
  });

  it("a new binding starts on the shadow list: every non-promoted binding is listed there", () => {
    const unlisted = GPP_BINDINGS.map((b) => b.bindingId).filter(
      (id) => !KNOWN_SHADOW_BINDINGS.includes(id) && !Object.hasOwn(GPP_BINDING_ENFORCEMENT, id),
    );
    expect(unlisted, "Add the new binding id to KNOWN_SHADOW_BINDINGS").toEqual([]);
  });

  it("the shadow list only shrinks: it names no binding that is not declared, and no duplicate", () => {
    const declared = new Set(GPP_BINDINGS.map((b) => b.bindingId));
    expect(KNOWN_SHADOW_BINDINGS.filter((id) => !declared.has(id))).toEqual([]);
    expect(new Set(KNOWN_SHADOW_BINDINGS).size).toBe(KNOWN_SHADOW_BINDINGS.length);
  });

  it("every enforcement entry passes the promotion ratchet against the live tree", () => {
    for (const [bindingId, entry] of Object.entries(GPP_BINDING_ENFORCEMENT)) {
      expect(promotionRefusals(bindingId, entry, liveContext()), bindingId).toEqual([]);
    }
  });

  it("no seed binding is promotable today (predicate-wide, and direct sites remain)", () => {
    const entry: BindingEnforcementEntry = {
      mode: "enforced", decisionId: "DI-0123456789AB", ratifiedAt: "2026-10-01", evidenceRef: "obs:14d", lineage: "unsealed-accepted",
    };
    for (const binding of GPP_BINDINGS) {
      const ctx = { ...liveContext(), shadowList: [] };
      expect(promotionRefusals(binding.bindingId, entry, ctx).length, binding.bindingId).toBeGreaterThan(0);
    }
  });
});

describe("resolveBindingMode", () => {
  const entry: BindingEnforcementEntry = {
    mode: "enforced", decisionId: "DI-0123456789AB", ratifiedAt: "2026-10-01", evidenceRef: "obs:14d", lineage: "sealed-required",
  };

  it("is shadow for every declared binding with the shipped table", () => {
    for (const binding of GPP_BINDINGS) {
      expect(resolveBindingMode(binding.bindingId)).toEqual({ mode: "shadow", reason: "not-promoted" });
    }
  });

  it("is enforced only when an entry exists", () => {
    setBindingEnforcementOverrideForTests({ "fixture-binding": entry });
    expect(resolveBindingMode("fixture-binding")).toEqual({ mode: "enforced", entry });
    expect(resolveBindingMode("tak-alignment-admit")).toEqual({ mode: "shadow", reason: "not-promoted" });
  });

  it("DPF_GPP_ENFORCEMENT=shadow-all lowers an enforced binding to shadow", () => {
    setBindingEnforcementOverrideForTests({ "fixture-binding": entry });
    vi.stubEnv("DPF_GPP_ENFORCEMENT", "shadow-all");
    expect(resolveBindingMode("fixture-binding")).toEqual({ mode: "shadow", reason: "operator-shadow-all" });
  });

  it.each(["enforced", "enforce-all", "on", "true", "SHADOW-ALL-BUT-ENFORCE", "tak-alignment-admit"])(
    "the runtime override cannot raise enforcement (DPF_GPP_ENFORCEMENT=%s)",
    (value) => {
      vi.stubEnv("DPF_GPP_ENFORCEMENT", value);
      for (const binding of GPP_BINDINGS) {
        expect(resolveBindingMode(binding.bindingId).mode, binding.bindingId).toBe("shadow");
      }
      expect(resolveBindingMode("fixture-binding").mode).toBe("shadow");
    },
  );

  it("the test seams refuse to run outside a test runtime", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setBindingEnforcementOverrideForTests({ "fixture-binding": entry })).toThrow(/test/);
    expect(() => setGppBindingsOverrideForTests([])).toThrow(/test/);
  });
});

describe("promotion ratchet on fixtures", () => {
  const fixture: GppBinding = {
    bindingId: "fixture-admit",
    version: 1,
    gateKey: "tak-alignment",
    authority: "wwwd",
    resolver: { module: "lib/tak/alignment-tool-gate", exportName: "runTakAlignmentGate" },
    admission: "alignment-approve",
    tools: ["outward_tool"],
    toolPredicate: (tool) => tool.consequential,
    reason: "oai",
  };
  const entry: BindingEnforcementEntry = {
    mode: "enforced", decisionId: "DI-0123456789AB", ratifiedAt: "2026-10-01", evidenceRef: "GppPermitObservation 2026-09-17..2026-10-01", lineage: "sealed-required",
  };
  const tools: PromotionContext["tools"] = [
    { name: "outward_tool", consequential: true, alignmentRequired: true },
    { name: "other_outward_tool", consequential: true, alignmentRequired: true },
    { name: "internal_write", consequential: false, alignmentRequired: false },
    { name: "unaligned_outward", consequential: true, alignmentRequired: false },
  ];
  const ctx = (patch: Partial<PromotionContext> = {}): PromotionContext => ({
    bindings: [fixture], shadowList: [], tools, directSites: [], ...patch,
  });

  it("accepts a clean promotion", () => {
    expect(promotionRefusals("fixture-admit", entry, ctx())).toEqual([]);
  });

  it("refuses an entry without a WWMD decision id", () => {
    expect(promotionRefusals("fixture-admit", { ...entry, decisionId: "" }, ctx()).join("\n")).toMatch(/decision id/);
    expect(promotionRefusals("fixture-admit", { ...entry, decisionId: "DI-123" }, ctx()).join("\n")).toMatch(/decision id/);
    expect(promotionRefusals("fixture-admit", { ...entry, decisionId: "di-0123456789ab" }, ctx()).join("\n")).toMatch(/decision id/);
    expect(DECISION_ID_PATTERN.test("DI-2DE3951FBB28")).toBe(true);
  });

  it("refuses an entry with no evidence or no ratification date", () => {
    expect(promotionRefusals("fixture-admit", { ...entry, evidenceRef: " " }, ctx()).join("\n")).toMatch(/evidence/);
    expect(promotionRefusals("fixture-admit", { ...entry, ratifiedAt: "soon" }, ctx()).join("\n")).toMatch(/ratifiedAt/);
  });

  it("refuses a binding with a tool that is not outward, authority or irreversible", () => {
    const wide: GppBinding = { ...fixture, tools: ["outward_tool", "internal_write"] };
    expect(promotionRefusals("fixture-admit", entry, ctx({ bindings: [wide] })).join("\n")).toMatch(/internal_write.*not outward/);
  });

  it("refuses a binding whose tool still has a direct executeTool site", () => {
    const sites: CallSite[] = [{ path: "lib/build/ship-on-review-approval.ts", line: 111, toolName: "outward_tool" }];
    expect(promotionRefusals("fixture-admit", entry, ctx({ directSites: sites })).join("\n"))
      .toMatch(/outward_tool.*direct executeTool site.*ship-on-review-approval/);
  });

  it("refuses any promotion while a dynamic direct site could reach the binding's tools", () => {
    const sites: CallSite[] = [{ path: "app/api/admin/ops/execute-proposal/route.ts", line: 40, toolName: "dynamic" }];
    expect(promotionRefusals("fixture-admit", entry, ctx({ directSites: sites })).join("\n")).toMatch(/dynamic/);
  });

  it("ignores direct sites for tools the binding does not name", () => {
    const sites: CallSite[] = [{ path: "lib/a.ts", line: 1, toolName: "other_outward_tool" }];
    expect(promotionRefusals("fixture-admit", entry, ctx({ directSites: sites }))).toEqual([]);
  });

  it("refuses a binding still on the shrink-only shadow list", () => {
    expect(promotionRefusals("fixture-admit", entry, ctx({ shadowList: ["fixture-admit"] })).join("\n")).toMatch(/KNOWN_SHADOW_BINDINGS/);
  });

  it("refuses a predicate-only binding: promotion needs an explicit, reviewable tool list", () => {
    const { tools: _tools, ...predicateOnly } = fixture;
    expect(promotionRefusals("fixture-admit", entry, ctx({ bindings: [predicateOnly] })).join("\n")).toMatch(/explicit/);
  });

  it("refuses a tool the registry does not know", () => {
    const ghost: GppBinding = { ...fixture, tools: ["no_such_tool"] };
    expect(promotionRefusals("fixture-admit", entry, ctx({ bindings: [ghost] })).join("\n")).toMatch(/no_such_tool.*not a registered/);
  });

  it("refuses an alignment-admit binding over a tool the alignment gate does not run for", () => {
    const unaligned: GppBinding = { ...fixture, tools: ["unaligned_outward"] };
    expect(promotionRefusals("fixture-admit", entry, ctx({ bindings: [unaligned] })).join("\n")).toMatch(/alignment gate does not run/);
  });

  it("refuses a c5 binding and an undeclared binding", () => {
    expect(promotionRefusals("fixture-admit", entry, ctx({ bindings: [{ ...fixture, reason: "c5" }] })).join("\n")).toMatch(/c5/);
    expect(promotionRefusals("nope", entry, ctx()).join("\n")).toMatch(/not a declared binding/);
  });

  it("refuses an unknown lineage policy", () => {
    const bad = { ...entry, lineage: "whatever" } as unknown as BindingEnforcementEntry;
    expect(promotionRefusals("fixture-admit", bad, ctx()).join("\n")).toMatch(/lineage/);
  });
});
