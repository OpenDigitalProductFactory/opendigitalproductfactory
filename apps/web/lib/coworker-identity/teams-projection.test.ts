// apps/web/lib/coworker-identity/teams-projection.test.ts
// Unit tests for the pure rooms aggregator (EP-COWORKER-IDENTITY-360 Phase 2).
import { describe, it, expect } from "vitest";

import { aggregateRooms, type CoworkerRoom } from "./teams-projection";

function room(p: Partial<CoworkerRoom> & { id: string; kind: CoworkerRoom["kind"] }): CoworkerRoom {
  return { name: `Team ${p.id}`, role: "Member", detail: "", ...p };
}

describe("aggregateRooms", () => {
  it("dedupes by (kind,id) and counts the total distinct rooms", () => {
    const rows = [
      room({ id: "t1", kind: "value-stream-team" }),
      room({ id: "t1", kind: "value-stream-team" }), // dup
      room({ id: "t1", kind: "owning-team" }), // same team id, different kind → distinct
    ];
    const { rooms, totals } = aggregateRooms(rows);
    expect(rooms).toHaveLength(2);
    expect(totals.total).toBe(2);
  });

  it("counts lead-shaped roles", () => {
    const rows = [
      room({ id: "t1", kind: "value-stream-team", role: "Build Lead" }),
      room({ id: "t2", kind: "value-stream-team", role: "Reviewer" }),
      room({ id: "t3", kind: "owning-team", role: "Coordinator" }),
    ];
    expect(aggregateRooms(rows).totals.leads).toBe(2);
  });

  it("caps the returned rooms but counts all in totals", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      room({ id: `t${i}`, kind: "value-stream-team" as const }),
    );
    const { rooms, totals } = aggregateRooms(rows, { maxRooms: 5 });
    expect(rooms).toHaveLength(5);
    expect(totals.total).toBe(12);
  });

  it("returns an empty summary for no memberships", () => {
    expect(aggregateRooms([])).toEqual({ rooms: [], totals: { total: 0, leads: 0 } });
  });
});
