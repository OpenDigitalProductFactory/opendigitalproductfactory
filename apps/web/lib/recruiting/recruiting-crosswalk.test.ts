import { describe, expect, it, vi } from "vitest";
import {
  loadRecruitingCrosswalk,
  registerRecruitingCrosswalk,
  resolveNativeRecruitingId,
  type RecruitingCrosswalkClient,
} from "./recruiting-crosswalk";

function fakeDb(opts: { findUnique?: unknown; findMany?: unknown[] } = {}) {
  const findUnique = vi.fn().mockResolvedValue(opts.findUnique ?? null);
  const findMany = vi.fn().mockResolvedValue(opts.findMany ?? []);
  const upsert = vi.fn().mockResolvedValue({});
  const db: RecruitingCrosswalkClient = {
    masterDataSourceRef: { findUnique, findMany, upsert },
  };
  return { db, findUnique, findMany, upsert };
}

describe("registerRecruitingCrosswalk", () => {
  it("upserts on the (domain, sourceSystem, sourceEntityId) unique key", async () => {
    const { db, upsert } = fakeDb();
    await registerRecruitingCrosswalk(db, {
      domain: "recruiting-candidate",
      sourceSystem: "greenhouse",
      sourceEntityId: "cand-1",
      canonicalId: "dpf-candidate-1",
    });
    const call = upsert.mock.calls[0][0];
    expect(call.where.domain_sourceSystem_sourceEntityId).toEqual({
      domain: "recruiting-candidate",
      sourceSystem: "greenhouse",
      sourceEntityId: "cand-1",
    });
    expect(call.create).toMatchObject({
      domain: "recruiting-candidate",
      sourceSystem: "greenhouse",
      sourceEntityId: "cand-1",
      canonicalId: "dpf-candidate-1",
      trustTier: "connector",
    });
    expect(call.update).toMatchObject({ canonicalId: "dpf-candidate-1" });
  });
});

describe("resolveNativeRecruitingId", () => {
  it("returns the canonicalId when a crosswalk exists", async () => {
    const { db } = fakeDb({ findUnique: { canonicalId: "dpf-app-9" } });
    const id = await resolveNativeRecruitingId(db, {
      domain: "recruiting-application",
      sourceSystem: "greenhouse",
      sourceEntityId: "app-9",
    });
    expect(id).toBe("dpf-app-9");
  });

  it("returns null when there is no crosswalk", async () => {
    const { db } = fakeDb();
    expect(
      await resolveNativeRecruitingId(db, {
        domain: "recruiting-candidate",
        sourceSystem: "greenhouse",
        sourceEntityId: "missing",
      }),
    ).toBeNull();
  });
});

describe("loadRecruitingCrosswalk", () => {
  it("builds a sourceEntityId -> canonicalId map for a domain+source", async () => {
    const { db } = fakeDb({
      findMany: [
        { sourceEntityId: "cand-1", canonicalId: "dpf-1" },
        { sourceEntityId: "cand-2", canonicalId: "dpf-2" },
      ],
    });
    const map = await loadRecruitingCrosswalk(db, {
      domain: "recruiting-candidate",
      sourceSystem: "greenhouse",
    });
    expect(map.get("cand-1")).toBe("dpf-1");
    expect(map.get("cand-2")).toBe("dpf-2");
    expect(map.size).toBe(2);
  });
});
