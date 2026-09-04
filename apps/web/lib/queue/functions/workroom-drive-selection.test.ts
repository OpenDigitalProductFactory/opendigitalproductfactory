// Room selection for the standing drive (BI-72B3FB40).
//
// The drive shipped selecting rooms like this:
//
//   findMany({ where: { non-terminal } , take: 200 })   // no orderBy
//     .flatMap(row => resolveWorkShapeClaim(row.scopeClaims) ? [row] : [])
//
// The cap therefore applied to ALL rooms and the claim filter ran afterwards,
// in JavaScript. On the reference install that was 276 non-terminal rooms with
// exactly one shaped room, and the drive reported `scanned: 0` on every tick
// for seven hours — the one room that mattered sat outside an unordered
// 200-row window. Nothing errored; the feature was simply invisible.
//
// The invariant these tests hold: the claim filter and the ordering belong in
// the query, so the cap bounds rooms the drive could act on rather than rooms
// that merely exist.

import { describe, expect, it } from "vitest";

import { STANDING_ROOM_SCAN_LIMIT, loadStandingRoomIds } from "./workroom-drive";

/** Captures the SQL the selector issues, and returns canned ids. */
function stubDb(rows: Array<{ id: string }> = []) {
  const seen: string[] = [];
  const values: unknown[] = [];
  return {
    seen,
    values,
    db: {
      $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => {
        seen.push(q.join("?"));
        values.push(...v);
        return Promise.resolve(rows);
      },
    },
  };
}

describe("standing-room selection", () => {
  it("filters for a work-shape claim in the query, not after it", async () => {
    // This is the whole defect. If the claim filter ever moves back out of SQL,
    // the cap silently starts hiding shaped rooms again.
    const { db, seen } = stubDb();
    await loadStandingRoomIds(db);
    const sql = seen.join(" ");
    expect(sql).toMatch(/jsonb_array_elements/i);
    expect(sql).toContain("workShape");
    expect(sql).toMatch(/EXISTS/i);
  });

  it("excludes terminal and archived rooms in the query", async () => {
    const { db, seen } = stubDb();
    await loadStandingRoomIds(db);
    const sql = seen.join(" ");
    expect(sql).toMatch(/"archivedAt"\s+IS\s+NULL/i);
    for (const terminal of ["abandoned", "archived", "complete"]) {
      expect(sql).toContain(terminal);
    }
  });

  it("orders deterministically before applying the cap", async () => {
    // Without ORDER BY, which rooms fall inside the cap is whatever the planner
    // returned that day — so a room could be scanned on one tick and invisible
    // on the next, with no change to the room itself.
    const { db, seen, values } = stubDb();
    await loadStandingRoomIds(db);
    const sql = seen.join(" ");
    expect(sql).toMatch(/ORDER\s+BY/i);
    const orderIndex = sql.search(/ORDER\s+BY/i);
    const limitIndex = sql.search(/LIMIT/i);
    expect(orderIndex).toBeGreaterThan(-1);
    expect(limitIndex).toBeGreaterThan(orderIndex);
    expect(values).toContain(STANDING_ROOM_SCAN_LIMIT);
  });

  it("returns every id the query yielded, without post-filtering", async () => {
    // A JS filter after the query would re-create the original bug in a new
    // place: rows fetched, then silently discarded below the cap.
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `room-${i}` }));
    const { db } = stubDb(rows);
    const ids = await loadStandingRoomIds(db);
    expect(ids).toHaveLength(rows.length);
    expect(ids[0]).toBe("room-0");
    expect(ids.at(-1)).toBe("room-24");
  });

  it("handles an empty result without work", async () => {
    const { db } = stubDb([]);
    expect(await loadStandingRoomIds(db)).toEqual([]);
  });

  it("bounds a tick to a sane number of rooms", () => {
    expect(STANDING_ROOM_SCAN_LIMIT).toBeGreaterThan(0);
    expect(STANDING_ROOM_SCAN_LIMIT).toBeLessThanOrEqual(500);
  });
});
