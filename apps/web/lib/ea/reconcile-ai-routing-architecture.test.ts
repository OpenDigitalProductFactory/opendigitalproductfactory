import { describe, expect, it, vi } from "vitest";
import {
  reconcileAiRoutingArchitecture,
  summarizeAiRoutingArchitectureResults,
} from "./reconcile-ai-routing-architecture";
import type { SysmlSeedResult } from "./sysml-model-seed";

const result = (
  status: SysmlSeedResult["status"],
  values: Partial<SysmlSeedResult> = {},
): SysmlSeedResult => ({
  status,
  created: 0,
  updated: 0,
  removed: 0,
  ...values,
});

describe("reconcileAiRoutingArchitecture", () => {
  it("applies BPMN, ArchiMate, and SysML through the shared projection seam", async () => {
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    const reconciled = await reconcileAiRoutingArchitecture({ db: db as never });

    expect(reconciled.status).toBe("skipped");
    expect(reconciled.bpmn.status).toBe("skipped");
    expect(reconciled.archimate.status).toBe("skipped");
    expect(reconciled.sysml.status).toBe("skipped");
    expect(db.eaNotation.findUnique).toHaveBeenNthCalledWith(1, {
      where: { slug: "bpmn20" },
      select: { id: true },
    });
    expect(db.eaNotation.findUnique).toHaveBeenNthCalledWith(2, {
      where: { slug: "archimate4" },
      select: { id: true },
    });
    expect(db.eaNotation.findUnique).toHaveBeenNthCalledWith(3, {
      where: { slug: "sysml2" },
      select: { id: true },
    });
  });

  it("aggregates projection and cross-notation evidence without losing domain detail", () => {
    const summarized = summarizeAiRoutingArchitectureResults(
      result("applied", { created: 20 }),
      result("noop", { updated: 8 }),
      result("applied", {
        created: 10,
        crossLayerLinked: 9,
        crossLayerUnresolved: 1,
      }),
    );

    expect(summarized).toMatchObject({
      status: "applied",
      created: 30,
      updated: 8,
      removed: 0,
      crossLayerLinked: 9,
      crossLayerUnresolved: 1,
    });
    expect(summarized.bpmn.status).toBe("applied");
    expect(summarized.archimate.status).toBe("noop");
    expect(summarized.sysml.status).toBe("applied");
  });
});
