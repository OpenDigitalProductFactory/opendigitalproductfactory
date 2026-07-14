import { describe, expect, it } from "vitest";

import { filterActivePresence, PRESENCE_ACTIVE_WINDOW_MS } from "./work-item-presence";

const now = 1_000_000_000_000;
const at = (msAgo: number) => new Date(now - msAgo);

describe("filterActivePresence (BI-B416B12A)", () => {
  it("keeps viewers seen within the window and drops stale ones", () => {
    const active = filterActivePresence(
      [
        { principalType: "user", principalId: "u1", displayLabel: "Mark", lastSeenAt: at(1_000) },
        { principalType: "agent", principalId: "a1", displayLabel: "Ops", lastSeenAt: at(PRESENCE_ACTIVE_WINDOW_MS + 5_000) },
      ],
      now,
    );
    expect(active.map((v) => v.principalId)).toEqual(["u1"]);
    expect(active[0]).toMatchObject({ principalType: "user", label: "Mark" });
  });

  it("excludes the current viewer and dedupes to newest per principal", () => {
    const active = filterActivePresence(
      [
        { principalType: "user", principalId: "u1", displayLabel: "Me", lastSeenAt: at(500) },
        { principalType: "agent", principalId: "a1", displayLabel: "Ops", lastSeenAt: at(2_000) },
        { principalType: "agent", principalId: "a1", displayLabel: "Ops", lastSeenAt: at(9_000) },
      ],
      now,
      { excludePrincipalId: "u1" },
    );
    expect(active.map((v) => v.principalId)).toEqual(["a1"]);
  });

  it("falls back to a generic label by principal type", () => {
    const active = filterActivePresence(
      [
        { principalType: "agent", principalId: "a1", displayLabel: null, lastSeenAt: at(100) },
        { principalType: "user", principalId: "u2", displayLabel: "  ", lastSeenAt: at(100) },
      ],
      now,
    );
    const labels = Object.fromEntries(active.map((v) => [v.principalId, v.label]));
    expect(labels).toEqual({ a1: "A coworker", u2: "Someone" });
  });
});
