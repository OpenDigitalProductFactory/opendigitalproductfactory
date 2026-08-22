import { afterEach, describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import {
  CONSEQUENTIAL_DECISION_TOOLS,
  _resetConsequentialToolResolverForTests,
  gatedToolNames,
  installConsequentialToolResolver,
  isGovernedDecisionAction,
} from "./decision-routing-governance-hook";
import {
  _resetConsequentialToolCacheForTests,
  deriveConsequentialToolNames,
  getConsequentialToolNames,
  measureConsequentialGateCoverage,
} from "./consequential-tool-coverage";

afterEach(() => {
  _resetConsequentialToolResolverForTests();
  _resetConsequentialToolCacheForTests();
});

describe("deriveConsequentialToolNames", () => {
  it("gates a side-effecting tool that declares any consequence class", () => {
    const gated = deriveConsequentialToolNames({
      tools: [
        { name: "publishes", sideEffect: true, consequence: "outward" },
        { name: "destroys", sideEffect: true, consequence: "irreversible" },
        { name: "grants", sideEffect: true, consequence: "authority" },
      ],
      seed: new Set(),
    });
    expect([...gated].sort()).toEqual(["destroys", "grants", "publishes"]);
  });

  it("leaves an undeclared side-effecting tool ungated — the default is not flipped here", () => {
    const gated = deriveConsequentialToolNames({
      tools: [{ name: "bookkeeping", sideEffect: true, consequence: undefined }],
      seed: new Set(),
    });
    expect(gated.has("bookkeeping")).toBe(false);
  });

  it("ignores a declared consequence on a read-only tool", () => {
    const gated = deriveConsequentialToolNames({
      tools: [{ name: "reader", sideEffect: false, consequence: "outward" }],
      seed: new Set(),
    });
    expect(gated.has("reader")).toBe(false);
  });

  it("UNIONS the transitional seed rather than replacing it", () => {
    const gated = deriveConsequentialToolNames({
      tools: [{ name: "publishes", sideEffect: true, consequence: "outward" }],
    });
    for (const seeded of CONSEQUENTIAL_DECISION_TOOLS) expect(gated.has(seeded)).toBe(true);
    expect(gated.has("publishes")).toBe(true);
  });
});

describe("the live catalog", () => {
  it("gates every tool that declares a consequence, plus the seed", () => {
    const gated = getConsequentialToolNames();
    for (const tool of PLATFORM_TOOLS) {
      if (tool.sideEffect && tool.consequence) expect(gated.has(tool.name)).toBe(true);
    }
    for (const seeded of CONSEQUENTIAL_DECISION_TOOLS) expect(gated.has(seeded)).toBe(true);
  });

  it("covers the tools that move money, reach a third party, change authority, or destroy state", () => {
    const gated = getConsequentialToolNames();
    for (const name of [
      "send_marketing_email",      // third party
      "place_linkedin_ad",         // spend
      "setup_email",               // third party
      "create_employee",           // identity
      "transition_employee_status",
      "manage_coworker_tool_grant", // authority
      "create_policy",
      "merge_backlog_items",       // destroys state
      "cancel_scheduled_agent_task",
      "recover_sandbox",
    ]) {
      expect(gated.has(name), `${name} must be consult-gated`).toBe(true);
    }
  });

  it("reports coverage materially above the two-name allowlist it replaced", () => {
    const coverage = measureConsequentialGateCoverage();
    expect(coverage.sideEffectingTools).toBeGreaterThan(100);
    expect(coverage.gateClassified).toBeGreaterThanOrEqual(50);
    expect(coverage.coveragePct).toBeGreaterThanOrEqual(25);
  });
});

describe("the gate reads the derived set", () => {
  it("defaults to the seed when no resolver is installed — degrades narrow, never off", () => {
    expect([...gatedToolNames()].sort()).toEqual([...CONSEQUENTIAL_DECISION_TOOLS].sort());
  });

  it("governs a derived consequential tool once the resolver is installed", () => {
    const event = { toolName: "send_marketing_email", source: "agentic-loop" as const };
    expect(isGovernedDecisionAction(event)).toBe(false);
    installConsequentialToolResolver(getConsequentialToolNames);
    expect(isGovernedDecisionAction(event)).toBe(true);
  });

  it("still ignores surfaces other than the agentic loop", () => {
    installConsequentialToolResolver(getConsequentialToolNames);
    expect(
      isGovernedDecisionAction({ toolName: "send_marketing_email", source: "mcp" as never }),
    ).toBe(false);
  });
});

describe("the composition root installs the resolver", () => {
  it("register-tool-governance-hooks wires the derived set before registering the hook", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../governance/register-tool-governance-hooks.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("installConsequentialToolResolver(getConsequentialToolNames)");
  });
});
