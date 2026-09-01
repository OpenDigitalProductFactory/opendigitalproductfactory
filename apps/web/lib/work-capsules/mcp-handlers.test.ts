import { describe, expect, it } from "vitest";

import { resolveAdoptionBacklogBinding } from "./adopt-backlog-binding";
import { backlogItemIdFromOutcomeAnchor } from "./outcome-anchor";

// BI-512214EA (second site). `Workroom.backlogItemId` is what every subject
// lookup keys on — reviewer recovery, and repository-artifact.ts's subjectWhere
// behind plan coverage. Its only writer was the readiness-gated claim path, so a
// room adopted BEFORE readiness could never satisfy a subject lookup. Adoption
// now resolves a backlog-item outcome anchor onto that binding.
describe("adopt_worktree subject binding", () => {
  it("resolves a backlog-item outcome anchor onto backlogItemId", () => {
    expect(backlogItemIdFromOutcomeAnchor({
      outcomeAnchor: { kind: "backlog-item", id: "BI-3EBFC177", label: "x" },
    })).toBe("BI-3EBFC177");
  });

  it("ignores an anchor that does not name a backlog item", () => {
    for (const outcomeAnchor of [
      { kind: "epic", id: "EP-862820FD" },
      { kind: "backlog-item" },
      { kind: "backlog-item", id: "   " },
      { kind: "backlog-item", id: 42 },
      undefined,
      null,
      [],
      "BI-3EBFC177",
    ]) {
      expect(backlogItemIdFromOutcomeAnchor({ outcomeAnchor })).toBeNull();
    }
  });
});

// BI-CB3AEBBF. Same binding gap at a third site: create_workroom. A room created
// for a backlog item recorded the caller's outcomeAnchor and left backlogItemId
// null, so the completion gate's own recovery — "No live Workroom is bound to
// this item. Claim or resume the exact Workroom" — could not see the room the
// caller had just created the way it asked. Reproduced live as WC-19154AC3, with
// 33 rooms sitting anchor-only against 338 correctly bound.
describe("create_workroom subject binding", () => {
  function reader(items: string[]) {
    return {
      backlogItem: {
        async findFirst(args: unknown) {
          const where = (args as { where: { OR: Array<Record<string, string>> } }).where;
          const wanted = where.OR.map((clause) => Object.values(clause)[0]);
          const hit = items.find((item) => wanted.includes(item));
          return hit ? { itemId: hit } : null;
        },
      },
    };
  }

  it("binds the item named only by an outcome anchor — the shape create_workroom receives", async () => {
    const result = await resolveAdoptionBacklogBinding(reader(["BI-0AA939DF"]), {
      title: "Close out BI-0AA939DF",
      outcomeAnchor: { kind: "backlog-item", id: "BI-0AA939DF", label: "x", source: "backlog" },
    });

    expect(result).toEqual({ bound: true, backlogItemId: "BI-0AA939DF" });
  });

  it("fails closed on an item that does not resolve rather than creating an unbound room", async () => {
    // An unbound room is the expensive failure: it occupies its identity while
    // being invisible to every subject lookup, which is what made the live one
    // useless to the gate that asked for it.
    const result = await resolveAdoptionBacklogBinding(reader([]), {
      outcomeAnchor: { kind: "backlog-item", id: "BI-DOESNOTEXIST" },
    });

    expect(result.bound).toBe(false);
    if (!result.bound) expect(result.refusal.error).toBe("unknown_backlog_item");
  });

  it("leaves a room with no backlog anchor unbound, which is legitimate", async () => {
    // backlogItemId is deliberately nullable — coworker-owned standing work has
    // no backlog item. Binding must not become mandatory as a side effect.
    const result = await resolveAdoptionBacklogBinding(reader(["BI-0AA939DF"]), {
      title: "Security findings watch",
      outcomeAnchor: { kind: "external", url: "https://example.invalid/security" },
    });

    expect(result).toEqual({ bound: true, backlogItemId: null });
  });

  it("still honours an explicit backlogItemId over the anchor", async () => {
    const result = await resolveAdoptionBacklogBinding(reader(["BI-EXPLICIT"]), {
      backlogItemId: "BI-EXPLICIT",
      outcomeAnchor: { kind: "backlog-item", id: "BI-FROM-ANCHOR" },
    });

    expect(result).toEqual({ bound: true, backlogItemId: "BI-EXPLICIT" });
  });
});
