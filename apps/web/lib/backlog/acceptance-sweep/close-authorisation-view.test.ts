import { describe, expect, it } from "vitest";

import { CLOSE_AUTHORISATION_CONFIG_KEY, CLOSE_AUTHORISATION_SCOPE, DEFAULT_CLOSE_LIMIT } from "./close-authorisation";
import {
  loadCloseAuthorisationView,
  parseLastSweepClosing,
  type CloseAuthorisationViewDb,
} from "./close-authorisation-view";

// BI-C2467A2E AC-1: the admin card reads the recorded pre-authorisation and the
// last sweep run's closing outcome, with people shown by email, not by id.

const GRANT = {
  schemaVersion: 1,
  scope: CLOSE_AUTHORISATION_SCOPE,
  enabled: true,
  setByUserId: "user-op",
  setAt: "2026-10-01T09:00:00.000Z",
  reason: "Merged work already passes its gate.",
  maxClosuresPerRun: 10,
};

function db(input: { config?: unknown; lastRun?: unknown; room?: boolean; users?: Array<{ id: string; email: string }> }) {
  const userQueries: string[][] = [];
  const fake: CloseAuthorisationViewDb = {
    platformConfig: {
      findUnique: async ({ where }) =>
        where.key === CLOSE_AUTHORISATION_CONFIG_KEY && input.config !== undefined ? { value: input.config } : null,
    },
    user: {
      findMany: async ({ where }) => {
        userQueries.push(where.id.in);
        return (input.users ?? []).filter((u) => where.id.in.includes(u.id));
      },
    },
    workroom: { findUnique: async () => (input.room === false ? null : { id: "room-1" }) },
    workroomActivity: {
      findFirst: async () => (input.lastRun === undefined ? null : { payload: input.lastRun, recordedAt: new Date("2026-10-05T05:00:00.000Z") }),
    },
  };
  return { fake, userQueries };
}

describe("parseLastSweepClosing", () => {
  it("reads the closing counts the sweep summary recorded", () => {
    expect(
      parseLastSweepClosing({
        ranAt: "2026-10-05T05:00:00.000Z",
        closing: {
          enabled: true, disabledReason: null, closed: ["BI-1", "BI-2"], refused: [{ itemId: "BI-3", code: "X" }],
          deferredByLimit: ["BI-4"], errored: [],
        },
      }),
    ).toEqual({ ranAt: "2026-10-05T05:00:00.000Z", closingWasOn: true, closed: 2, refused: 1, deferredByLimit: 1, offReason: null });
  });

  it("returns null for a run recorded before closing existed", () => {
    expect(parseLastSweepClosing({ ranAt: "2026-09-30T05:00:00.000Z" })).toBeNull();
    expect(parseLastSweepClosing(null)).toBeNull();
  });
});

describe("loadCloseAuthorisationView", () => {
  it("reads off with the default limit when nothing is recorded", async () => {
    const { fake } = db({});
    const view = await loadCloseAuthorisationView(fake);
    expect(view.state).toBe("off");
    expect(view.grant).toBeNull();
    expect(view.limit).toBe(DEFAULT_CLOSE_LIMIT);
    expect(view.lastRun).toBeNull();
  });

  it("reads on with who granted it, by email, and the last run's closed count", async () => {
    const { fake } = db({
      config: GRANT,
      users: [{ id: "user-op", email: "op@example.test" }],
      lastRun: { ranAt: "2026-10-05T05:00:00.000Z", closing: { enabled: true, disabledReason: null, closed: ["BI-1"], refused: [], deferredByLimit: [] } },
    });
    const view = await loadCloseAuthorisationView(fake);
    expect(view.state).toBe("on");
    expect(view.grant).toEqual({ by: "op@example.test", at: GRANT.setAt, reason: GRANT.reason });
    expect(view.limit).toBe(10);
    expect(view.lastRun?.closed).toBe(1);
  });

  it("keeps the grant and shows the revocation after a revoke", async () => {
    const { fake } = db({
      config: { ...GRANT, enabled: false, revokedByUserId: "user-two", revokedAt: "2026-10-03T09:00:00.000Z", revokeReason: "Pausing to review." },
      users: [{ id: "user-op", email: "op@example.test" }],
    });
    const view = await loadCloseAuthorisationView(fake);
    expect(view.state).toBe("off");
    expect(view.grant?.by).toBe("op@example.test");
    // An unknown user falls back to the stored id rather than vanishing.
    expect(view.revocation).toEqual({ by: "user-two", at: "2026-10-03T09:00:00.000Z", reason: "Pausing to review." });
  });

  it("reads an incomplete or out-of-scope record as off and says so", async () => {
    expect((await loadCloseAuthorisationView(db({ config: { schemaVersion: 1 } }).fake)).recordProblem).toBe("malformed");
    const outOfScope = await loadCloseAuthorisationView(db({ config: { ...GRANT, scope: "something-else" } }).fake);
    expect(outOfScope.state).toBe("off");
    expect(outOfScope.recordProblem).toBe("out-of-scope");
  });

  it("has no last run before the Acceptance room exists", async () => {
    const view = await loadCloseAuthorisationView(db({ config: GRANT, room: false }).fake);
    expect(view.lastRun).toBeNull();
  });
});

describe("room identity", () => {
  it("matches the keys the sweep writes its summary under", async () => {
    const task = await import("./acceptance-sweep-task");
    const view = await import("./close-authorisation-view");
    expect(view.ACCEPTANCE_ROOM_IDEMPOTENCY_KEY).toBe(task.ACCEPTANCE_ROOM_KEY);
    expect(view.ACCEPTANCE_SWEEP_ACTIVITY_KIND).toBe(task.ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND);
  });
});
