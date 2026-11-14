import { describe, expect, it, vi } from "vitest";

import { WORK_SYNC_HEALTH_KEY, runWorkSync, type WorkSyncDb, type WorkSyncHealthRecordV1 } from "./work-sync";
import { classifyWorkSyncFailure, mergeWorkSyncHealth, mirrorsStaleSince, staleFrom } from "./work-sync-health";
import { WORK_SYNC_FAILURE_ISSUE_TYPE, planWorkSyncAlerts, runWorkSyncWatch, runWorkSyncWatchSafely, type WorkSyncWatchDb } from "./work-sync-watch";

const at = (iso: string) => new Date(iso);
const LINK = { linkId: "link_peer", peerLabel: "the development installation", peerAuthorityUrl: "http://192.0.2.10:3000", lastMirrorSyncAt: null };

describe("classifyWorkSyncFailure", () => {
  it("tells revocation apart from network and TLS failure", () => {
    expect(classifyWorkSyncFailure("no-token", "This link holds no peer-issued token.")).toBe("revoked");
    expect(classifyWorkSyncFailure("fetch-failed", "Peer responded 401")).toBe("revoked");
    expect(classifyWorkSyncFailure("fetch-failed", "Peer responded 403: link revoked")).toBe("revoked");
    expect(classifyWorkSyncFailure("fetch-failed", "Peer responded 0: fetch failed")).toBe("network");
    expect(classifyWorkSyncFailure("fetch-failed", "Peer responded 0: self-signed certificate in certificate chain")).toBe("tls");
    expect(classifyWorkSyncFailure("fetch-failed", "Peer does not serve work sync yet (upgrade the peer).")).toBe("peer-outdated");
    expect(classifyWorkSyncFailure("invalid-page", "items missing")).toBe("protocol");
    expect(classifyWorkSyncFailure("identity-mismatch", "origin changed")).toBe("protocol");
  });
});

describe("mergeWorkSyncHealth", () => {
  const success = mergeWorkSyncHealth(null, [{ linkId: "link_peer", outcome: "synced", detail: null }], at("2026-11-08T14:40:00.000Z"));

  it("keeps the last success and the first failure across failed cycles", () => {
    const first = mergeWorkSyncHealth(success, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "Peer responded 0: fetch failed" }], at("2026-11-08T14:50:00.000Z"));
    const later = mergeWorkSyncHealth(first, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "Peer responded 0: fetch failed" }], at("2026-11-09T14:50:00.000Z"));
    expect(later.links[0]).toMatchObject({
      lastPullAt: null,
      lastSuccessAt: "2026-11-08T14:40:00.000Z",
      failingSince: "2026-11-08T14:50:00.000Z",
      errorClass: "network",
    });
    expect(mirrorsStaleSince(later)).toEqual(at("2026-11-08T14:40:00.000Z"));
  });

  it("clears the failure on the next good pull", () => {
    const failed = mergeWorkSyncHealth(success, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "x" }], at("2026-11-08T15:00:00.000Z"));
    const back = mergeWorkSyncHealth(failed, [{ linkId: "link_peer", outcome: "synced", detail: null }], at("2026-11-13T02:00:00.000Z"));
    expect(back.links[0]).toMatchObject({ lastSuccessAt: "2026-11-13T02:00:00.000Z", failingSince: null, errorClass: null });
    expect(mirrorsStaleSince(back)).toBeNull();
  });

  it("reads a pre-existing record's lastPullAt as the last success", () => {
    const legacy: WorkSyncHealthRecordV1 = { schemaVersion: 1, observedAt: "x", links: [{ linkId: "link_peer", outcome: "synced", detail: null, lastPullAt: "2026-11-08T14:40:00.000Z" }] };
    const next = mergeWorkSyncHealth(legacy, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "y" }], at("2026-11-08T14:45:00.000Z"));
    expect(next.links[0]!.lastSuccessAt).toBe("2026-11-08T14:40:00.000Z");
  });

  it("uses the newest mirror sync as the last success when the record has none", () => {
    const record = mergeWorkSyncHealth(null, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "y" }], at("2026-11-13T01:00:00.000Z"));
    expect(staleFrom(record.links[0]!, at("2026-11-08T14:40:00.000Z"))).toEqual(at("2026-11-08T14:40:00.000Z"));
    expect(staleFrom(record.links[0]!)).toEqual(at("2026-11-13T01:00:00.000Z"));
  });
});

describe("planWorkSyncAlerts", () => {
  const failing = (lastSuccessAt: string, detail = "Peer responded 0: fetch failed"): WorkSyncHealthRecordV1 =>
    mergeWorkSyncHealth(
      mergeWorkSyncHealth(null, [{ linkId: "link_peer", outcome: "synced", detail: null }], at(lastSuccessAt)),
      [{ linkId: "link_peer", outcome: "fetch-failed", detail }],
      at("2026-11-08T15:00:00.000Z"),
    );

  it("raises nothing before the 6-hour threshold", () => {
    expect(planWorkSyncAlerts({ record: failing("2026-11-08T14:40:00.000Z"), links: [LINK], now: at("2026-11-08T20:00:00.000Z") })).toEqual([]);
  });

  it("raises one item naming the peer, the last success, the class and next steps", () => {
    const [alert, ...rest] = planWorkSyncAlerts({ record: failing("2026-11-08T14:40:00.000Z"), links: [LINK], now: at("2026-11-09T02:00:00.000Z") });
    expect(rest).toEqual([]);
    expect(alert!.issueKey).toBe("work-sync:link:link_peer");
    expect(alert!.summary).toMatch(/^Work sync with the development installation has not worked since /);
    expect(alert!.details).toMatchObject({ lastSuccessAt: "2026-11-08T14:40:00.000Z", errorClass: "network", href: "/ops/installation" });
    expect(alert!.details.explanation).toMatch(/could not be reached at http:\/\/192\.0\.2\.10:3000/);
    expect(alert!.details.nextSteps.join(" ")).toMatch(/switched on/);
  });

  it("tells the operator to pair again when the peer refused the connection", () => {
    const [alert] = planWorkSyncAlerts({ record: failing("2026-11-08T14:40:00.000Z", "Peer responded 403"), links: [LINK], now: at("2026-11-09T02:00:00.000Z") });
    expect(alert!.details.errorClass).toBe("revoked");
    expect(alert!.details.nextSteps.join(" ")).toMatch(/Pair the two installations again/);
  });
});

function watchDb(record: WorkSyncHealthRecordV1 | null, openKeys: string[] = []) {
  const upserts: Array<{ where: { issueKey: string } }> = [];
  const db: WorkSyncWatchDb = {
    platformConfig: { findUnique: vi.fn(async () => (record ? { value: record } : null)) },
    federationLink: { findMany: vi.fn(async () => [{ linkId: "link_peer", peerAuthorityUrl: LINK.peerAuthorityUrl, principal: { displayName: LINK.peerLabel } }]) },
    federatedRecordMirror: { findFirst: vi.fn(async () => ({ lastSyncedAt: at("2026-11-08T14:40:00.000Z") })) },
    portfolioQualityIssue: {
      findMany: vi.fn(async () => openKeys.map((issueKey) => ({ issueKey }))),
      upsert: vi.fn(async (args: { where: { issueKey: string } }) => {
        upserts.push(args);
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { db, upserts };
}

describe("runWorkSyncWatch", () => {
  const failingRecord = mergeWorkSyncHealth(null, [{ linkId: "link_peer", outcome: "fetch-failed", detail: "Peer responded 0: fetch failed" }], at("2026-11-08T15:00:00.000Z"));

  it("opens the row, rings the bell once, and resolves every other work-sync row", async () => {
    const { db, upserts } = watchDb(failingRecord);
    const notify = vi.fn(async () => {});
    const result = await runWorkSyncWatch(db, { now: () => at("2026-11-09T02:00:00.000Z"), notify });
    expect(result.opened).toEqual(["work-sync:link:link_peer"]);
    expect(upserts).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(db.portfolioQualityIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { issueType: WORK_SYNC_FAILURE_ISSUE_TYPE, status: "open", issueKey: { notIn: ["work-sync:link:link_peer"] } },
    }));
  });

  it("refreshes an already-open row without ringing again", async () => {
    const { db } = watchDb(failingRecord, ["work-sync:link:link_peer"]);
    const notify = vi.fn(async () => {});
    const result = await runWorkSyncWatch(db, { now: () => at("2026-11-09T02:05:00.000Z"), notify });
    expect(result.opened).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a database failure instead of throwing, so the cron step never retries on it", async () => {
    const { db } = watchDb(failingRecord);
    db.platformConfig.findUnique = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(runWorkSyncWatchSafely(db)).resolves.toEqual({ failed: "connection reset" });
  });

  it("clears the row once sync works again", async () => {
    const recovered = mergeWorkSyncHealth(failingRecord, [{ linkId: "link_peer", outcome: "synced", detail: null }], at("2026-11-13T02:00:00.000Z"));
    const { db, upserts } = watchDb(recovered, ["work-sync:link:link_peer"]);
    const result = await runWorkSyncWatch(db, { now: () => at("2026-11-13T02:00:00.000Z") });
    expect(result.open).toEqual([]);
    expect(upserts).toHaveLength(0);
    expect(db.portfolioQualityIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { issueType: WORK_SYNC_FAILURE_ISSUE_TYPE, status: "open" },
    }));
  });
});

describe("runWorkSync health record", () => {
  it("carries the last success forward when a pull fails", async () => {
    const previous = mergeWorkSyncHealth(null, [{ linkId: "link_peer", outcome: "synced", detail: null }], at("2026-11-08T14:40:00.000Z"));
    let written: unknown = null;
    const db = {
      federationLink: { findMany: vi.fn(async () => [{ linkId: "link_peer", role: "same-org-peer", peerAuthorityUrl: "http://192.0.2.10:3000", peerTokenEnc: "enc" }]), updateMany: vi.fn() },
      platformConfig: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (where.key === WORK_SYNC_HEALTH_KEY ? { value: previous } : null)),
        upsert: vi.fn(async (args: { create: { value: unknown } }) => {
          written = args.create.value;
          return {};
        }),
      },
    } as unknown as WorkSyncDb;
    await runWorkSync(db, {
      now: at("2026-11-08T15:00:00.000Z"),
      decryptToken: () => "token",
      fetchPage: async () => ({ ok: false, status: 0, error: "fetch failed" }),
    });
    expect((written as WorkSyncHealthRecordV1).links[0]).toMatchObject({
      outcome: "fetch-failed",
      lastSuccessAt: "2026-11-08T14:40:00.000Z",
      failingSince: "2026-11-08T15:00:00.000Z",
      errorClass: "network",
    });
  });
});
