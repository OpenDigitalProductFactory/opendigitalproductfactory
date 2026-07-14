import { describe, expect, it } from "vitest";

import { buildMentionRoster, mentionHandle } from "./mention-roster";

describe("mentionHandle", () => {
  it("slugifies a display name to a mention handle", () => {
    expect(mentionHandle("Mark Bodman")).toBe("mark-bodman");
    expect(mentionHandle("  Ops Coworker!  ")).toBe("ops-coworker");
  });
});

describe("buildMentionRoster (BI-B416B12A)", () => {
  it("maps coworkers and users to typed principals by slugified handle", () => {
    const roster = buildMentionRoster({
      coworkers: [{ agentId: "AGT-9", name: "Ops Coworker", displayName: "Ops" }],
      users: [{ id: "user-1", name: "Mark Bodman", email: "mark@x.com" }],
    });
    expect(roster["ops-coworker"]).toEqual({ type: "agent", id: "AGT-9" });
    expect(roster["mark-bodman"]).toEqual({ type: "user", id: "user-1" });
  });

  it("falls back to the email local-part when a user has no name", () => {
    const roster = buildMentionRoster({
      coworkers: [],
      users: [{ id: "user-2", name: null, email: "dana@x.com" }],
    });
    expect(roster["dana"]).toEqual({ type: "user", id: "user-2" });
  });

  it("keeps the first writer on a slug collision (coworkers before users)", () => {
    const roster = buildMentionRoster({
      coworkers: [{ agentId: "AGT-1", name: "Alex" }],
      users: [{ id: "user-9", name: "Alex", email: "alex@x.com" }],
    });
    expect(roster["alex"]).toEqual({ type: "agent", id: "AGT-1" });
  });
});
