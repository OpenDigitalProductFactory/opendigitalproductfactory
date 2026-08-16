// Coverage conformance for the consequential-tool gate.
//
// The gate itself was never broken: it is fail-closed, it vetoes rather than
// averages, and it refuses bypass arguments. What was broken was its REACH.
// `ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES` carried nine names, seven of which
// (`create_product`, `create_product_line`, `launch_campaign`,
// `publish_storefront`, `send_quote`, `send_invoice`, `execute_change`)
// matched no tool anywhere in the codebase. A name that resolves to nothing
// gates nothing, so the list read as broad coverage while alignment actually
// ran on two real tools out of ~198 side-effecting ones.
//
// That failure is silent by construction: nothing errors when a gate names a
// tool that does not exist, and nothing errors when a tool that spends money
// ships without a classification. These tests make both loud.

import { describe, expect, it } from "vitest";
import { PLATFORM_TOOLS, type ToolConsequence } from "@/lib/mcp-tools";
import {
  ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES,
  classifyConsequentialTool,
} from "./consequential-tool-policy";

const byName = new Map(PLATFORM_TOOLS.map((t) => [t.name, t]));

/**
 * The declared set, pinned. This is the review surface: changing what an agent
 * may do to the outside world without a human noticing requires editing this
 * list, and the diff says so out loud.
 */
const EXPECTED: Record<string, ToolConsequence> = {
  // Leaves the platform: reaches a third party, publishes externally, or spends money.
  send_marketing_email: "outward",
  publish_to_linkedin: "outward",
  place_linkedin_ad: "outward",
  tick_marketing_scheduler: "outward",
  create_portal_pr: "outward",
  contribute_to_hive: "outward",
  escalate_feedback_upstream: "outward",
  // Stays inside, but no inverse call restores the prior state.
  admin_run_command: "irreversible",
  apply_platform_update: "irreversible",
  deploy_feature: "irreversible",
  execute_promotion: "irreversible",
  merge_customer_accounts: "irreversible",
  merge_customer_contacts: "irreversible",
  manage_coworker_tool_grant: "irreversible",
  retire_backlog_item: "irreversible",
};

describe("consequential-tool coverage", () => {
  // The regression that started this. A gate whose allowlist names a
  // non-existent tool is not a narrow gate — it is an absent one.
  it("every name the alignment list gates resolves to a real tool", () => {
    const unresolved = ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES.filter((n) => !byName.has(n));
    expect(unresolved).toEqual([]);
  });

  it("every tool declared consequential is registered and actually mutates", () => {
    for (const [name, consequence] of Object.entries(EXPECTED)) {
      const tool = byName.get(name);
      expect(tool, `${name} is not a registered tool`).toBeDefined();
      expect(tool!.consequence, `${name} lost its declaration`).toBe(consequence);
      // A read cannot be irreversible. If this fails the declaration is wrong,
      // not the test.
      expect(tool!.sideEffect, `${name} declares consequence but no side effect`).toBe(true);
    }
  });

  it("no tool declares a consequence without a side effect", () => {
    const bogus = PLATFORM_TOOLS.filter((t) => t.consequence && !t.sideEffect).map((t) => t.name);
    expect(bogus).toEqual([]);
  });

  it("routes what leaves the business through the alignment gate", () => {
    for (const [name, consequence] of Object.entries(EXPECTED)) {
      if (consequence !== "outward") continue;
      const c = classifyConsequentialTool({ toolName: name, tool: byName.get(name)! });
      expect(c.consequential, name).toBe(true);
      expect(c.alignmentRequired, name).toBe(true);
      expect(c.collaborationShape, name).toBe("outward-review");
    }
  });

  // Deliberate asymmetry: an irreversible platform operation is recorded and
  // receipted, but a BUSINESS stance has nothing to say about
  // `admin_run_command`. Capability and authority govern those. Sending them
  // through the WWWD corpus would manufacture escalations, not safety.
  it("records irreversible platform operations without asking the business stance", () => {
    for (const [name, consequence] of Object.entries(EXPECTED)) {
      if (consequence !== "irreversible") continue;
      const c = classifyConsequentialTool({ toolName: name, tool: byName.get(name)! });
      expect(c.consequential, name).toBe(true);
      expect(c.alignmentRequired, name).toBe(false);
      expect(c.collaborationShape, name).toBe("change-consequential");
    }
  });

  it("leaves ordinary bookkeeping mutations alone", () => {
    const ordinary = byName.get("update_backlog_item");
    expect(ordinary?.sideEffect).toBe(true);
    expect(ordinary?.consequence).toBeUndefined();
    const c = classifyConsequentialTool({ toolName: "update_backlog_item", tool: ordinary! });
    expect(c.consequential).toBe(false);
    expect(c.alignmentRequired).toBe(false);
  });
});
