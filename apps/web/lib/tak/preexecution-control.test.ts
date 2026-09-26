// BI-DEDAC950: an alignment refusal names the principle page that governs it,
// on the gate decision and in the refusal data, so the caller reaches the rule
// with one wiki_query.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./tool-execution-receipt", () => ({ writeToolExecutionReceipt: vi.fn() }));

import { ALIGNMENT_REFUSAL_PRINCIPLE } from "@/lib/kernel/governing-principles";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";

import { setAlignmentGateOverrideForTests, type AlignmentGateDecision } from "./alignment-tool-gate";
import { enforceTakPreexecution } from "./preexecution-control";

const args = {
  toolName: "create_offer",
  rawParams: { title: "Discounted adoption weekend" },
  userId: "user-1",
  source: "mcp",
} as unknown as GovernedExecuteArgs;

function gateReturning(verdict: AlignmentGateDecision["verdict"]): void {
  setAlignmentGateOverrideForTests(async () => ({
    verdict,
    interactionId: "DPI-1",
    rationale: `The WWWD stance says ${verdict}.`,
    alignment: { verdict, criteria: [], checks: [], veto: null } as unknown as AlignmentGateDecision["alignment"],
  }));
}

async function enforce() {
  return enforceTakPreexecution({
    args,
    alignmentRequired: true,
    preconditionRequired: false,
    writeAudit: async () => null,
  });
}

describe("alignment refusals cite their governing principle", () => {
  afterEach(() => setAlignmentGateOverrideForTests(null));

  it.each([
    ["decline", "alignment_denied"],
    ["escalate", "alignment_escalation_required"],
  ] as const)("a %s verdict refuses with %s and its principle slug", async (verdict, rejection) => {
    gateReturning(verdict);
    const { result, alignmentDecision } = await enforce();
    const slug = ALIGNMENT_REFUSAL_PRINCIPLE[rejection];
    expect(slug).toBeTruthy();
    expect(result?.error).toBe(rejection);
    expect(alignmentDecision?.principleSlug).toBe(slug);
    expect(result?.data).toMatchObject({ interactionId: "DPI-1", principleSlug: slug });
  });

  it("does not cite a principle when alignment approves", async () => {
    gateReturning("approve");
    const { result, alignmentDecision } = await enforce();
    expect(result).toBeNull();
    expect(alignmentDecision).not.toHaveProperty("principleSlug");
  });
});
