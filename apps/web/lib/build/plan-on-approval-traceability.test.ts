// BI-6F2872FC — the plan names which acceptance criteria each task satisfies,
// by the ids the design's scope baseline gives them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeAndCall = vi.fn();
vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: (...a: unknown[]) => routeAndCall(...a) }));

import { generateNormalizedPlan } from "./plan-on-approval";

const PLAN = JSON.stringify({ fileStructure: [], tasks: [{ title: "t", testFirst: "a", implement: "b", verify: "c", satisfies: ["AC-2"] }] });

describe("plan generation traces acceptance criteria", () => {
  beforeEach(() => {
    routeAndCall.mockReset();
    routeAndCall.mockResolvedValue({ content: PLAN, providerId: "codex" });
  });

  it("numbers the design's acceptance criteria as the baseline does and asks every task to name the ids it satisfies", async () => {
    await generateNormalizedPlan({
      buildId: "FB-1", title: "t", biTitle: null, biBody: null, verifiedPaths: [], log: async () => {},
      designDoc: { problemStatement: "p", acceptanceCriteria: ["First", "  ", "Second"] },
    });
    const prompt = String((routeAndCall.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content);
    expect(prompt).toContain("AC-1: First");
    expect(prompt).toContain("AC-2: Second");
    expect(prompt).not.toContain("AC-3");
    expect(prompt).toContain('"satisfies": ["<AC id>"');
    expect(prompt).toMatch(/every acceptance id .* at least one task/i);
  });

  it("keeps each task's satisfies through normalization", async () => {
    const result = await generateNormalizedPlan({
      buildId: "FB-1", title: "t", biTitle: null, biBody: null, verifiedPaths: [], log: async () => {},
      designDoc: { acceptanceCriteria: ["First", "Second"] },
    });
    expect("plan" in result && (result.plan.tasks?.[0] as { satisfies?: string[] }).satisfies).toEqual(["AC-2"]);
  });
});
