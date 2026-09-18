import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

import { alignmentStatement } from "./alignment-tool-gate";
import { classifyConsequentialTool } from "./consequential-tool-policy";

describe("alignmentStatement (BI-63B14D4B)", () => {
  it("uses the tool's descriptive fields when it has them", () => {
    expect(alignmentStatement("send_marketing_email", { title: "Spring adoption drive", market: "Austin" }))
      .toBe("send marketing email: Spring adoption drive. Austin");
  });

  it("never yields a bare tool name: names the scalar parameters it was given", () => {
    const statement = alignmentStatement("create_portal_pr", { readinessTrailers: "Seed-Fit: pass", dryRun: false });
    expect(statement).toBe("create portal pr with readinessTrailers=Seed-Fit: pass, dryRun=false");
    expect(statement.trim().endsWith(":")).toBe(false);
  });

  it("says plainly when nothing describes the request", () => {
    expect(alignmentStatement("tick_marketing_scheduler", {}))
      .toBe("tick marketing scheduler (no parameters describe this request)");
  });
});

/**
 * The live catalog: platform-development tools that leave the install must
 * not be routed to the customer's WWWD stance. These are the tools whose
 * empty escalations reached the owner's review queue on the DEV install
 * (ledger rows `create portal pr:`, `run hive scout ingest:`,
 * `discovery sweep:`, `grok signin start:`).
 */
const PLATFORM_OUTWARD_TOOLS = [
  "create_portal_pr",
  "contribute_to_hive",
  "discovery_sweep",
  "run_hive_scout_ingest",
  "escalate_feedback_upstream",
  "grok_signin_start",
] as const;

describe("platform-scoped outward tools in the live catalog", () => {
  it.each(PLATFORM_OUTWARD_TOOLS)("%s declares platform scope and is not WWWD-alignment-gated", (name) => {
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === name);
    expect(tool, `${name} must exist in the catalog`).toBeDefined();
    expect(tool!.consequence).toBe("outward");
    expect(tool!.consequenceScope).toBe("platform");
    const classification = classifyConsequentialTool({ toolName: name, tool: tool! });
    expect(classification.consequential).toBe(true);
    expect(classification.alignmentRequired).toBe(false);
  });

  it("business-scoped outward tools remain alignment-gated", () => {
    for (const name of ["send_marketing_email", "publish_to_linkedin", "place_linkedin_ad"]) {
      const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === name);
      expect(tool, `${name} must exist in the catalog`).toBeDefined();
      expect(classifyConsequentialTool({ toolName: name, tool: tool! }).alignmentRequired).toBe(true);
    }
  });
});
