import { describe, expect, it, vi } from "vitest";

import type { OwedAcceptance } from "./owed-acceptance";
import {
  ACCEPTANCE_OWED_ACTIVITY_KIND,
  owedAcceptanceFingerprint,
  recordOwedAcceptanceSnapshot,
} from "./owed-snapshot";

// The acceptance_owed activity is the history of who owed what and since when
// (design §3.1). It is written only when that answer changes.

const projection: OwedAcceptance = {
  owed: [
    { code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator", nextAction: "Record delivery evidence." },
    { code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: "Record acceptance evidence." },
  ],
  owner: { agentId: "AGT-WS-ACCEPT", displayName: "Acceptance Reviewer", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] },
  unroutable: [{ code: "DELIVERY_EVIDENCE_REQUIRED", accountableRole: "delivery-coordinator", reason: "no-writer-lane", nextAction: "Record delivery evidence." }],
  closable: false,
};

function fakeDb(lastPayload: unknown) {
  const findFirst = vi.fn().mockResolvedValue(lastPayload === undefined ? null : { payload: lastPayload });
  const create = vi.fn().mockResolvedValue({ id: "act_new" });
  return { db: { backlogItemActivity: { findFirst, create } }, findFirst, create };
}

describe("recordOwedAcceptanceSnapshot", () => {
  it("writes the first snapshot with codes, owner, unroutable reasons and next actions", async () => {
    const { db, findFirst, create } = fakeDb(undefined);

    const result = await recordOwedAcceptanceSnapshot({ db, backlogItemId: "bi_row_1", projection, recordedByAgentId: "AGT-WS-PORTFOLIO" });

    expect(result).toEqual({ written: true, activityId: "act_new" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { backlogItemId: "bi_row_1", kind: ACCEPTANCE_OWED_ACTIVITY_KIND },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { payload: true },
    });
    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      backlogItemId: "bi_row_1",
      kind: "acceptance_owed",
      recordedByAgentId: "AGT-WS-PORTFOLIO",
      payload: {
        fingerprint: owedAcceptanceFingerprint(projection),
        owedCodes: ["ACCEPTANCE_EVIDENCE_REQUIRED", "DELIVERY_EVIDENCE_REQUIRED"],
        owner: { agentId: "AGT-WS-ACCEPT", displayName: "Acceptance Reviewer", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] },
        unroutable: [{ code: "DELIVERY_EVIDENCE_REQUIRED", accountableRole: "delivery-coordinator", reason: "no-writer-lane", nextAction: "Record delivery evidence." }],
        owed: projection.owed,
        closable: false,
      },
    });
    expect(data.summary).toContain("AGT-WS-ACCEPT");
    expect(data.summary).toContain("ACCEPTANCE_EVIDENCE_REQUIRED");
  });

  it("writes nothing when the owed codes, owner and unroutable reasons are unchanged", async () => {
    const reordered: OwedAcceptance = {
      ...projection,
      owed: [...projection.owed].reverse().map((entry) => ({ ...entry, nextAction: `${entry.nextAction} (reworded)` })),
      owner: { ...projection.owner!, displayName: "Renamed Reviewer" },
    };
    const { db, create } = fakeDb({ fingerprint: owedAcceptanceFingerprint(projection) });

    const result = await recordOwedAcceptanceSnapshot({ db, backlogItemId: "bi_row_1", projection: reordered });

    expect(result).toEqual({ written: false, activityId: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("writes when the owner changes", async () => {
    const { db, create } = fakeDb({ fingerprint: owedAcceptanceFingerprint(projection) });

    await recordOwedAcceptanceSnapshot({
      db,
      backlogItemId: "bi_row_1",
      projection: { ...projection, owner: { agentId: "AGT-OTHER", displayName: "Other", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] } },
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("writes when an unroutable reason changes", async () => {
    const { db, create } = fakeDb({ fingerprint: owedAcceptanceFingerprint(projection) });

    await recordOwedAcceptanceSnapshot({
      db,
      backlogItemId: "bi_row_1",
      projection: { ...projection, unroutable: [{ ...projection.unroutable[0]!, reason: "unresolved" }] },
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("writes when the last snapshot is malformed", async () => {
    const { db, create } = fakeDb("not-an-object");

    await recordOwedAcceptanceSnapshot({ db, backlogItemId: "bi_row_1", projection });

    expect(create).toHaveBeenCalledTimes(1);
  });
});
