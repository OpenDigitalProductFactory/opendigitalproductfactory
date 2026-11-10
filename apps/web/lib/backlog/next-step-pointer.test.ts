import { describe, expect, it } from "vitest";

import {
  UNRESOLVED_NEXT_STEP_LABEL,
  backlogItem,
  declaredItemIds,
  openIntent,
  resolveNextStep,
  type FiledBacklogItem,
  type NextStepPointer,
} from "./next-step-pointer";

function filed(...items: FiledBacklogItem[]): Map<string, FiledBacklogItem> {
  return new Map(items.map((item) => [item.itemId, item]));
}

const OPEN_BI: FiledBacklogItem = {
  itemId: "BI-5BF97BAA",
  title: "Integration and finance surfaces show a next backlog item id that resolves to nothing",
  status: "open",
};

describe("resolveNextStep", () => {
  it("labels a filed item with its own id", () => {
    const resolved = resolveNextStep(backlogItem("BI-5BF97BAA"), filed(OPEN_BI));

    expect(resolved.kind).toBe("filed");
    expect(resolved.label).toBe("BI-5BF97BAA");
    if (resolved.kind !== "filed") throw new Error("expected a filed next step");
    expect(resolved.title).toBe(OPEN_BI.title);
    expect(resolved.status).toBe("open");
  });

  // The defect itself: BI-INT-8D4F72 and fourteen siblings survived the backlog
  // reset of 2026-08-22 in source and kept rendering as though they were live.
  it("never renders a declared id the backlog does not hold", () => {
    const resolved = resolveNextStep(backlogItem("BI-INT-8D4F72"), filed(OPEN_BI));

    expect(resolved.kind).toBe("unresolved");
    expect(resolved.label).toBe(UNRESOLVED_NEXT_STEP_LABEL);
    expect(resolved.label).not.toContain("BI-INT-8D4F72");
  });

  it("states intent when no item is filed", () => {
    const resolved = resolveNextStep(openIntent("Entity links before write-back"), filed());

    expect(resolved.kind).toBe("open");
    expect(resolved.label).toBe("Entity links before write-back");
  });

  it("resolves an open intent without consulting the backlog at all", () => {
    const resolved = resolveNextStep(openIntent("Bank-feed provider ownership"), filed(OPEN_BI));

    expect(resolved.kind).toBe("open");
    expect(resolved.label).toBe("Bank-feed provider ownership");
  });

  it("labels every pointer shape with something a reader can act on", () => {
    const pointers: NextStepPointer[] = [
      backlogItem("BI-5BF97BAA"),
      backlogItem("BI-07D76D6B"),
      openIntent("Fee and payout reconciliation"),
    ];

    for (const resolved of pointers.map((pointer) => resolveNextStep(pointer, filed(OPEN_BI)))) {
      expect(resolved.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("declaredItemIds", () => {
  it("collects claimed ids once each, in declaration order", () => {
    const ids = declaredItemIds([
      backlogItem("BI-07D76D6B"),
      openIntent("Reconciliation parity"),
      backlogItem("BI-5BF97BAA"),
      backlogItem("BI-07D76D6B"),
    ]);

    expect(ids).toEqual(["BI-07D76D6B", "BI-5BF97BAA"]);
  });

  it("claims nothing when every pointer states intent", () => {
    expect(declaredItemIds([openIntent("Channel custody boundary")])).toEqual([]);
  });
});
