import { describe, expect, it, vi } from "vitest";
import {
  newSemanticReviewPublication,
  publishRetainedReview,
  readSemanticReviewPublication,
  reconcileSemanticReviewPublications,
  type PublicationDeps,
} from "./semantic-review-publication";
import { FailureReadinessPublicationError } from "./failure-readiness-status";

const HEAD = "c".repeat(40);
const T0 = new Date("2026-11-13T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

/** One completed native review whose status post is owed, held in a CAS-checked fake store. */
function harness(options: { roomHead?: string | null; publication?: Record<string, unknown> | null } = {}) {
  const row = {
    id: "run-row-1", taskRunId: "TR-1", userId: "user-1", status: "completed", updatedAt: new Date(T0),
    a2aMetadata: { gateKind: "semantic-review", capsuleId: "WC-1" },
    progressPayload: { evidenceRecordId: "evidence-1", semanticReview: {
      schemaVersion: 1, state: "completed", requestDigest: "d".repeat(64), evidenceRecordId: "evidence-1",
      publication: options.publication === undefined
        ? newSemanticReviewPublication({ capsuleId: "WC-1", sourceHeadSha: HEAD }, T0) : options.publication,
    } } as Record<string, unknown>,
  };
  let tick = 0;
  const db = {
    taskRun: {
      findUnique: vi.fn(async () => structuredClone(row)),
      findMany: vi.fn(async () => [structuredClone(row)]),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.updatedAt && (where.updatedAt as Date).getTime() !== row.updatedAt.getTime()) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date(T0.getTime() + ++tick) });
        return { count: 1 };
      }),
    },
    workroom: { findUnique: vi.fn(async () => ({ headSha: options.roomHead === undefined ? HEAD : options.roomHead,
      repositoryFullName: "o/r" })) },
  };
  let now = T0;
  const deps: PublicationDeps = {
    db: db as unknown as PublicationDeps["db"],
    publish: vi.fn(async () => undefined),
    authority: vi.fn(async () => "allowed" as const),
    now: () => now,
  };
  const publication = () => readSemanticReviewPublication(row.progressPayload);
  return { row, db, deps, publication, at: (date: Date) => { now = date; } };
}

describe("retained review publication (BI-2A8A8FC8)", () => {
  it("keeps a failed post durable and visible, without touching the completed review", async () => {
    const h = harness();
    vi.mocked(h.deps.publish).mockRejectedValueOnce(new Error("connect ETIMEDOUT api.github.com"));
    const outcome = await publishRetainedReview("TR-1", h.deps);
    expect(outcome.state).toBe("pending");
    expect(h.row.status).toBe("completed");
    expect((h.row.progressPayload.semanticReview as Record<string, unknown>).state).toBe("completed");
    expect(h.publication()).toMatchObject({ state: "pending", attempts: 1, reason: "publication-transport-failed",
      owner: "delivery-coordinator", sourceHeadSha: HEAD, nextAttemptAt: minutes(2).toISOString() });
    expect(h.publication()!.nextAction).toMatch(/retries/i);
    expect(JSON.stringify(h.row)).not.toContain("ETIMEDOUT");
  });

  it("the reconciler publishes the retained verdict once, fenced to the reviewed commit", async () => {
    const h = harness({ publication: { ...newSemanticReviewPublication({ capsuleId: "WC-1", sourceHeadSha: HEAD }, T0),
      attempts: 1, reason: "publication-transport-failed", nextAttemptAt: minutes(2).toISOString() } });
    h.at(minutes(1));
    expect(await reconcileSemanticReviewPublications(h.deps)).toMatchObject({ published: 0 });
    expect(h.deps.publish).not.toHaveBeenCalled();
    h.at(minutes(3));
    expect(await reconcileSemanticReviewPublications(h.deps)).toMatchObject({ published: 1 });
    expect(h.deps.publish).toHaveBeenCalledExactlyOnceWith("WC-1", HEAD);
    expect(h.publication()).toMatchObject({ state: "published", attempts: 2, publishedAt: minutes(3).toISOString() });
    h.at(minutes(60));
    await reconcileSemanticReviewPublications(h.deps);
    expect(h.deps.publish).toHaveBeenCalledOnce();
  });

  it("holds a changed source instead of publishing the old verdict onto a new commit", async () => {
    const h = harness({ roomHead: "e".repeat(40) });
    const outcome = await publishRetainedReview("TR-1", h.deps);
    expect(outcome.state).toBe("held");
    expect(h.deps.publish).not.toHaveBeenCalled();
    expect(h.publication()).toMatchObject({ state: "held", reason: "source-changed", attempts: 0 });
  });

  it("holds revoked authority, and waits without spending an attempt when authority is unreadable", async () => {
    const denied = harness();
    vi.mocked(denied.deps.authority).mockResolvedValueOnce("denied");
    expect((await publishRetainedReview("TR-1", denied.deps)).state).toBe("held");
    expect(denied.publication()).toMatchObject({ reason: "submitting-authority-no-longer-valid" });

    const unknown = harness();
    vi.mocked(unknown.deps.authority).mockResolvedValueOnce("unavailable");
    expect((await publishRetainedReview("TR-1", unknown.deps)).state).toBe("pending");
    expect(unknown.publication()).toMatchObject({ attempts: 0, reason: "review-authority-unavailable" });
    expect(unknown.deps.publish).not.toHaveBeenCalled();
  });

  it("holds a permission denial without a blind retry, but retries a rate limit", async () => {
    const denied = harness();
    vi.mocked(denied.deps.publish).mockRejectedValueOnce(new FailureReadinessPublicationError("http-status", "x", { httpStatus: 403 }));
    expect((await publishRetainedReview("TR-1", denied.deps)).state).toBe("held");
    expect(denied.publication()).toMatchObject({ reason: "publication-denied", attempts: 1 });

    const limited = harness();
    vi.mocked(limited.deps.publish).mockRejectedValueOnce(
      new FailureReadinessPublicationError("http-status", "x", { httpStatus: 403, rateLimited: true }));
    expect((await publishRetainedReview("TR-1", limited.deps)).state).toBe("pending");
    expect(limited.publication()).toMatchObject({ reason: "publication-rate-limited" });
  });

  it("stops at the attempt cap with a named owner and next action", async () => {
    const h = harness();
    vi.mocked(h.deps.publish).mockRejectedValue(new Error("socket hang up"));
    await publishRetainedReview("TR-1", h.deps);
    h.at(minutes(3)); await reconcileSemanticReviewPublications(h.deps);
    h.at(minutes(20)); await reconcileSemanticReviewPublications(h.deps);
    expect(h.publication()).toMatchObject({ state: "held", attempts: 3, reason: "publication-attempts-exhausted",
      owner: "delivery-coordinator" });
    h.at(minutes(200)); await reconcileSemanticReviewPublications(h.deps);
    expect(h.deps.publish).toHaveBeenCalledTimes(3);
  });

  it("leaves a live claim alone and recovers a claim whose worker died mid-post", async () => {
    const h = harness({ publication: { ...newSemanticReviewPublication({ capsuleId: "WC-1", sourceHeadSha: HEAD }, T0),
      state: "publishing", attempts: 1, lastAttemptAt: T0.toISOString(), claim: "dead-worker" } });
    h.at(minutes(1));
    await reconcileSemanticReviewPublications(h.deps);
    expect(h.deps.publish).not.toHaveBeenCalled();
    h.at(minutes(6));
    await reconcileSemanticReviewPublications(h.deps);
    expect(h.deps.publish).toHaveBeenCalledOnce();
    expect(h.publication()).toMatchObject({ state: "published", attempts: 2 });
  });

  it("lets only one of two concurrent ticks reserve the post", async () => {
    const h = harness();
    const stale = structuredClone(h.row);
    h.db.taskRun.findUnique.mockResolvedValueOnce(structuredClone(stale)).mockResolvedValueOnce(structuredClone(stale));
    const [a, b] = await Promise.all([publishRetainedReview("TR-1", h.deps), publishRetainedReview("TR-1", h.deps)]);
    expect([a.state, b.state].sort()).toEqual(["contended", "published"]);
    expect(h.deps.publish).toHaveBeenCalledOnce();
  });

  it("holds an obligation older than the publication window", async () => {
    const h = harness();
    h.at(new Date(T0.getTime() + 25 * 3_600_000));
    expect((await publishRetainedReview("TR-1", h.deps)).state).toBe("held");
    expect(h.publication()).toMatchObject({ reason: "publication-window-elapsed" });
    expect(h.deps.publish).not.toHaveBeenCalled();
  });

  it("rejects a malformed marker rather than guessing", () => {
    expect(readSemanticReviewPublication({ semanticReview: { publication: { schemaVersion: 1, state: "pending", attempts: -1 } } })).toBeNull();
    expect(readSemanticReviewPublication({ semanticReview: {} })).toBeNull();
  });
});
