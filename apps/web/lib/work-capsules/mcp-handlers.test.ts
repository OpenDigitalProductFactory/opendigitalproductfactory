import { describe, expect, it } from "vitest";

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
