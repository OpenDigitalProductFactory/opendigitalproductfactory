// BI-2D65BD1B — a per-call refiner may only narrow a declared consequence.
import { describe, expect, it, vi } from "vitest";

import { resolveCallConsequence, type ToolCallConsequenceInput } from "./tool-consequence";

const CALL: ToolCallConsequenceInput = { toolName: "claim_workroom_scope", params: {}, userId: "user-1" };

describe("resolveCallConsequence", () => {
  it("keeps the declaration when the tool has no refiner", async () => {
    await expect(resolveCallConsequence({ consequence: "authority" }, CALL))
      .resolves.toEqual({ consequence: "authority", refinement: null });
  });

  it("is ordinary when nothing is declared, and never consults a refiner", async () => {
    const consequenceForCall = vi.fn();
    await expect(resolveCallConsequence({ consequenceForCall }, CALL))
      .resolves.toEqual({ consequence: null, refinement: null });
    expect(consequenceForCall).not.toHaveBeenCalled();
  });

  it("narrows to ordinary and records why", async () => {
    const consequenceForCall = vi.fn(async () => ({ consequence: null, reason: "ordinary-claim" }));
    await expect(resolveCallConsequence({ consequence: "authority", consequenceForCall }, CALL))
      .resolves.toEqual({ consequence: null, refinement: { declared: "authority", reason: "ordinary-claim" } });
  });

  it("cannot change the class: any non-null answer keeps the declaration", async () => {
    const consequenceForCall = vi.fn(async () => ({ consequence: "outward" as const, reason: "odd" }));
    await expect(resolveCallConsequence({ consequence: "authority", consequenceForCall }, CALL))
      .resolves.toMatchObject({ consequence: "authority" });
  });

  it("fails closed when the refiner throws", async () => {
    const consequenceForCall = vi.fn(async () => { throw new Error("db down"); });
    await expect(resolveCallConsequence({ consequence: "authority", consequenceForCall }, CALL))
      .resolves.toEqual({
        consequence: "authority",
        refinement: { declared: "authority", reason: "refinement-unavailable" },
      });
  });
});
