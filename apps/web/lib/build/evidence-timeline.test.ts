import { describe, expect, it, vi } from "vitest";

import {
  loadBuildEvidenceTimelineEvents,
  mapBuildEvidenceTimelineEvents,
  type EvidenceTimelineDb,
} from "./evidence-timeline";

describe("mapBuildEvidenceTimelineEvents", () => {
  it("maps external-agent records to an external lane with a title-cased provider label", () => {
    const events = mapBuildEvidenceTimelineEvents({
      externalRecords: [
        {
          id: "ext-1",
          provider: "grok",
          resultSummary: "Implemented the parser",
          createdAt: new Date("2026-06-19T10:00:00.000Z"),
        },
        {
          id: "ext-2",
          provider: "claude-code",
          resultSummary: "Wrote the tests",
          createdAt: new Date("2026-06-19T09:00:00.000Z"),
        },
      ],
      runtimeVerifications: [],
      capsuleEvidence: [],
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: "external-ext-1", source: "external", label: "Grok", status: "recorded" });
    expect(events[1]).toMatchObject({ source: "external", label: "Claude Code" });
  });

  it("maps runtime verification with status normalization into the review lane", () => {
    const [event] = mapBuildEvidenceTimelineEvents({
      externalRecords: [],
      runtimeVerifications: [
        {
          verificationId: "RV-1",
          kind: "ux",
          status: "VERIFIED",
          completedAt: new Date("2026-06-19T11:00:00.000Z"),
          result: { summary: "Happy path verified on the live install." },
        },
      ],
      capsuleEvidence: [],
    });

    expect(event).toMatchObject({
      id: "runtime-RV-1",
      source: "review",
      label: "Runtime verification",
      status: "passed",
      summary: "Happy path verified on the live install.",
    });
  });

  it("falls back to a kind/status summary when runtime result has no summary, and maps failure", () => {
    const [event] = mapBuildEvidenceTimelineEvents({
      externalRecords: [],
      runtimeVerifications: [
        { verificationId: "RV-2", kind: "smoke", status: "failed", completedAt: null, result: {} },
      ],
      capsuleEvidence: [],
    });

    expect(event.status).toBe("failed");
    expect(event.summary).toBe("Runtime smoke failed.");
  });

  it("maps capsule evidence to the external lane", () => {
    const [event] = mapBuildEvidenceTimelineEvents({
      externalRecords: [],
      runtimeVerifications: [],
      capsuleEvidence: [
        { id: "act-1", summary: "Recorded build evidence from Codex", recordedAt: new Date("2026-06-19T08:00:00.000Z") },
      ],
    });

    expect(event).toMatchObject({ id: "capsule-act-1", source: "external", label: "Capsule evidence" });
  });

  it("merges all three sources newest-first across source types", () => {
    const events = mapBuildEvidenceTimelineEvents({
      externalRecords: [
        { id: "e", provider: "grok", resultSummary: "oldest", createdAt: new Date("2026-06-19T01:00:00.000Z") },
      ],
      runtimeVerifications: [
        { verificationId: "RV", kind: "ux", status: "passed", completedAt: new Date("2026-06-19T03:00:00.000Z"), result: {} },
      ],
      capsuleEvidence: [
        { id: "c", summary: "middle", recordedAt: new Date("2026-06-19T02:00:00.000Z") },
      ],
    });

    expect(events.map((e) => e.id)).toEqual(["runtime-RV", "capsule-c", "external-e"]);
  });

  it("returns an empty list when there is no cross-surface evidence", () => {
    expect(
      mapBuildEvidenceTimelineEvents({ externalRecords: [], runtimeVerifications: [], capsuleEvidence: [] }),
    ).toEqual([]);
  });
});

describe("loadBuildEvidenceTimelineEvents", () => {
  it("queries external evidence by buildId OR capsule link, and runtime/capsule by the cuid", async () => {
    const externalFindMany = vi.fn(async () => [
      { id: "x", provider: "codex", resultSummary: "did work", createdAt: new Date("2026-06-19T05:00:00.000Z") },
    ]);
    const runtimeFindMany = vi.fn(async () => [] as unknown[]);
    const capsuleFindFirst = vi.fn(async () => ({ id: "capsule-cuid" }));
    const capsuleActivityFindMany = vi.fn(async () => [
      { id: "a", summary: "capsule note", recordedAt: new Date("2026-06-19T04:00:00.000Z") },
    ]);

    const db = {
      externalEvidenceRecord: { findMany: externalFindMany },
      runtimeVerification: { findMany: runtimeFindMany },
      workroom: { findFirst: capsuleFindFirst },
      workroomActivity: { findMany: capsuleActivityFindMany },
    } as unknown as EvidenceTimelineDb;

    const events = await loadBuildEvidenceTimelineEvents({
      db,
      build: { id: "fb-cuid", buildId: "FB-123" },
    });

    // With a linked capsule, external evidence is matched by build id OR the
    // capsule link, so capsule-bound external-agent work (no FeatureBuild) shows.
    expect(externalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ buildId: "FB-123" }, { workCapsuleId: "capsule-cuid" }] },
      }),
    );
    expect(runtimeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: "fb-cuid" } }),
    );
    expect(capsuleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: "fb-cuid" } }),
    );
    expect(capsuleActivityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workCapsuleId: "capsule-cuid", kind: "evidence-recorded" } }),
    );
    expect(events.map((event) => event.id)).toEqual(["external-x", "capsule-a"]);
  });

  it("falls back to a buildId-only external query when the build has no linked capsule", async () => {
    const externalFindMany = vi.fn(async () => [] as unknown[]);

    const db = {
      externalEvidenceRecord: { findMany: externalFindMany },
      runtimeVerification: { findMany: vi.fn(async () => [] as unknown[]) },
      workroom: { findFirst: vi.fn(async () => null) },
      workroomActivity: { findMany: vi.fn(async () => [] as unknown[]) },
    } as unknown as EvidenceTimelineDb;

    await loadBuildEvidenceTimelineEvents({
      db,
      build: { id: "fb-cuid", buildId: "FB-123" },
    });

    expect(externalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId: "FB-123" } }),
    );
  });

  it("skips the capsule-activity query when the build has no linked capsule", async () => {
    const capsuleActivityFindMany = vi.fn(async () => [] as unknown[]);

    const db = {
      externalEvidenceRecord: { findMany: vi.fn(async () => [] as unknown[]) },
      runtimeVerification: { findMany: vi.fn(async () => [] as unknown[]) },
      workroom: { findFirst: vi.fn(async () => null) },
      workroomActivity: { findMany: capsuleActivityFindMany },
    } as unknown as EvidenceTimelineDb;

    const events = await loadBuildEvidenceTimelineEvents({
      db,
      build: { id: "fb-cuid", buildId: "FB-999" },
    });

    expect(capsuleActivityFindMany).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
