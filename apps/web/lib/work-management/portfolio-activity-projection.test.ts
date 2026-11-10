import { describe, expect, it } from "vitest";

import {
  deriveActivitySignal,
  EVIDENCE_STALE_WINDOW_MS,
  EXECUTION_FRESH_WINDOW_MS,
  projectPortfolioActivityPage,
  selectRepresentativeActivities,
  type RoomActivityInput,
} from "./portfolio-activity-projection";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function room(over: Partial<RoomActivityInput> & { roomId: string }): RoomActivityInput {
  return {
    title: `Room ${over.roomId}`,
    portfolioRole: "foundational",
    branchId: "b-1",
    href: `/workspace/cases/${over.roomId}`,
    status: "working",
    latestAction: null,
    blocker: null,
    evidenceAt: null,
    ...over,
  };
}

describe("deriveActivitySignal", () => {
  it("animates only on fresh execution evidence", () => {
    const fresh = deriveActivitySignal(room({ roomId: "a", evidenceAt: ago(1_000) }), NOW);
    expect(fresh).toMatchObject({ state: "executing", animate: true });
  });

  it("ages into stale rather than spinning forever", () => {
    const stale = deriveActivitySignal(room({ roomId: "a", evidenceAt: ago(EVIDENCE_STALE_WINDOW_MS + 1) }), NOW);
    expect(stale).toMatchObject({ state: "stale", animate: false });
  });

  it("distinguishes no evidence from old evidence", () => {
    expect(deriveActivitySignal(room({ roomId: "a", evidenceAt: null }), NOW)).toMatchObject({ state: "unknown", animate: false });
  });

  it("treats evidence past the fresh window but inside stale as queued, not executing", () => {
    const between = deriveActivitySignal(room({ roomId: "a", evidenceAt: ago(EXECUTION_FRESH_WINDOW_MS + 1_000) }), NOW);
    expect(between.state).toBe("queued");
    expect(between.animate).toBe(false);
  });

  it("never animates a blocked, waiting, queued, completed, stale or unknown room", () => {
    const cases: RoomActivityInput[] = [
      room({ roomId: "b", blocker: "needs review", evidenceAt: ago(1_000) }),
      room({ roomId: "w", awaitingPerson: true, evidenceAt: ago(1_000) }),
      room({ roomId: "q", queued: true, evidenceAt: ago(1_000) }),
      room({ roomId: "c", verifiedComplete: true, evidenceAt: ago(1_000) }),
      room({ roomId: "s", evidenceAt: ago(EVIDENCE_STALE_WINDOW_MS + 1) }),
      room({ roomId: "u" }),
    ];
    for (const input of cases) expect(deriveActivitySignal(input, NOW).animate).toBe(false);
  });

  it("does not let recent evidence override a verified receipt or a blocker", () => {
    expect(deriveActivitySignal(room({ roomId: "c", verifiedComplete: true, evidenceAt: ago(1) }), NOW).state).toBe("completed");
    expect(deriveActivitySignal(room({ roomId: "b", blocker: "waiting", evidenceAt: ago(1) }), NOW).state).toBe("blocked");
  });

  it("carries an accessible label and the deciding evidence timestamp", () => {
    const signal = deriveActivitySignal(room({ roomId: "a", evidenceAt: ago(1_000) }), NOW);
    expect(signal.label).toBe("Working now");
    expect(signal.evidenceAt).toBe(ago(1_000).toISOString());
  });
});

describe("selectRepresentativeActivities", () => {
  it("puts unresolved attention before live execution and completion", () => {
    const picked = selectRepresentativeActivities([
      room({ roomId: "done", verifiedComplete: true }),
      room({ roomId: "run", evidenceAt: ago(1_000), latestAction: "Checking invoice matching" }),
      room({ roomId: "stuck", blocker: "Waiting for release review" }),
    ], NOW, 3);
    expect(picked.map((p) => p.roomId)).toEqual(["stuck", "run", "done"]);
  });

  it("states a concrete action or blocker rather than a count", () => {
    const picked = selectRepresentativeActivities([
      room({ roomId: "run", evidenceAt: ago(1_000), latestAction: "Checking invoice matching" }),
      room({ roomId: "stuck", blocker: "Waiting for release review" }),
    ], NOW, 2);
    expect(picked[0]!.statement).toBe("Room stuck · blocked: Waiting for release review");
    expect(picked[1]!.statement).toBe("Room run · Checking invoice matching");
    for (const p of picked) expect(p.statement).not.toMatch(/^\d+$/);
  });

  it("says so plainly when no concrete action was recorded", () => {
    const [only] = selectRepresentativeActivities([room({ roomId: "x", title: "Payroll run" })], NOW, 1);
    expect(only!.statement).toBe("Payroll run · unknown");
  });

  it("is deterministic when priority and recency tie", () => {
    const rooms = [room({ roomId: "z" }), room({ roomId: "a" }), room({ roomId: "m" })];
    const first = selectRepresentativeActivities(rooms, NOW, 3).map((p) => p.roomId);
    const second = selectRepresentativeActivities([...rooms].reverse(), NOW, 3).map((p) => p.roomId);
    expect(first).toEqual(["a", "m", "z"]);
    expect(second).toEqual(first);
  });

  it("gives every representative a resolvable destination", () => {
    const picked = selectRepresentativeActivities([room({ roomId: "x" })], NOW, 1);
    expect(picked[0]!.href).toBe("/workspace/cases/x");
  });

  it("honours the bound and returns nothing when asked for none", () => {
    const rooms = Array.from({ length: 20 }, (_, i) => room({ roomId: `r-${i}` }));
    expect(selectRepresentativeActivities(rooms, NOW, 3)).toHaveLength(3);
    expect(selectRepresentativeActivities(rooms, NOW, 0)).toHaveLength(0);
  });
});

describe("projectPortfolioActivityPage", () => {
  it("counts a room once even when it arrives twice", () => {
    const page = projectPortfolioActivityPage({
      rooms: [room({ roomId: "dup" }), room({ roomId: "dup" }), room({ roomId: "other" })],
      now: NOW,
    });
    expect(page.observedRooms).toBe(2);
    expect(page.rows[0]!.roomCount).toBe(2);
  });

  it("labels a truncated read partial and pages deterministically without repeats", () => {
    const rooms = Array.from({ length: 7 }, (_, i) => room({ roomId: `r-${i}`, branchId: `b-${i}` }));
    const first = projectPortfolioActivityPage({ rooms, now: NOW, pageSize: 3 });
    expect(first.partial).toBe(true);
    expect(first.rows).toHaveLength(3);

    const second = projectPortfolioActivityPage({ rooms, now: NOW, pageSize: 3, cursor: first.nextCursor });
    const third = projectPortfolioActivityPage({ rooms, now: NOW, pageSize: 3, cursor: second.nextCursor });
    expect(third.partial).toBe(false);
    expect(third.nextCursor).toBeNull();

    const seen = [...first.rows, ...second.rows, ...third.rows].map((r) => r.branchId);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...seen].sort((a, b) => a.localeCompare(b, "en-US")));
  });

  it("reports a complete read as not partial", () => {
    const page = projectPortfolioActivityPage({ rooms: [room({ roomId: "a" })], now: NOW, pageSize: 50 });
    expect(page.partial).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("counts rooms needing attention separately from the total", () => {
    const page = projectPortfolioActivityPage({
      rooms: [
        room({ roomId: "ok", evidenceAt: ago(1_000) }),
        room({ roomId: "stuck", blocker: "needs review" }),
        room({ roomId: "waiting", awaitingPerson: true }),
      ],
      now: NOW,
    });
    expect(page.rows[0]!.roomCount).toBe(3);
    expect(page.rows[0]!.attentionCount).toBe(2);
  });

  it("stays bounded at 1,000 rooms across 100 agents and never renders them all", () => {
    const rooms = Array.from({ length: 1_000 }, (_, i) => room({
      roomId: `r-${String(i).padStart(4, "0")}`,
      branchId: `branch-${String(i % 40).padStart(3, "0")}`,
      latestAction: `Agent ${i % 100} working step ${i}`,
      evidenceAt: ago(i * 1_000),
      blocker: i % 97 === 0 ? "waiting on review" : null,
    }));

    const started = Date.now();
    const page = projectPortfolioActivityPage({ rooms, now: NOW, pageSize: 50, representativeLimit: 3 });
    const elapsed = Date.now() - started;

    // 40 branches fit in one page of 50, so the page is complete...
    expect(page.rows).toHaveLength(40);
    expect(page.partial).toBe(false);
    // ...but it never emits a row per room: at most three statements per branch.
    for (const row of page.rows) expect(row.representative.length).toBeLessThanOrEqual(3);
    const emitted = page.rows.reduce((n, row) => n + row.representative.length, 0);
    expect(emitted).toBeLessThanOrEqual(120);
    expect(page.observedRooms).toBe(1_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("pages a wide estate without ever exceeding the page bound", () => {
    const rooms = Array.from({ length: 1_000 }, (_, i) => room({
      roomId: `r-${String(i).padStart(4, "0")}`,
      branchId: `branch-${String(i).padStart(4, "0")}`,
    }));
    let cursor: string | null = null;
    let pages = 0;
    const branches = new Set<string>();
    do {
      const page: ReturnType<typeof projectPortfolioActivityPage> =
        projectPortfolioActivityPage({ rooms, now: NOW, pageSize: 50, cursor });
      expect(page.rows.length).toBeLessThanOrEqual(50);
      for (const row of page.rows) branches.add(row.branchId);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 100);
    expect(branches.size).toBe(1_000);
    expect(pages).toBe(20);
  });
});
