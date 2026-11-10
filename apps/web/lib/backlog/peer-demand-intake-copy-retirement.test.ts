import { describe, expect, it, vi } from "vitest";

import { SWEEP_RESOLUTION_PREFIX } from "./peer-demand-intake-copies";
import {
  handleRetirePeerDemandIntakeCopies,
  loadRetirementPlan,
  type PeerDemandCopySource,
} from "./peer-demand-intake-copy-retirement";

const FILED = new Date("2026-10-29T00:17:00Z");

type Row = Awaited<ReturnType<PeerDemandCopySource["copies"]>>[number];

function row(n: number, overrides: Partial<Row> = {}): Row {
  return {
    id: `row-${n}`,
    itemId: `BI-C${String(n).padStart(4, "0")}`,
    title: `Item ${n}`,
    status: "triaging",
    body: `body\n[origin:ecosystem-peer-demand:fdm_${String(n).padStart(24, "0")}]`,
    resolution: null,
    claimedById: null,
    claimedByAgentId: null,
    claimStatus: null,
    activeBuildId: null,
    createdAt: FILED,
    ...overrides,
  };
}

function source(rows: Row[], extra: Partial<PeerDemandCopySource> = {}): PeerDemandCopySource {
  return {
    copies: async () => rows,
    mirrors: async (ids) => ids.map((mirrorId) => ({
      mirrorId,
      federationLinkId: mirrorId.endsWith("3") ? "link-revoked" : "link-live",
      syncStatus: mirrorId.endsWith("2") ? "withdrawn" : "synced",
      disposition: mirrorId.endsWith("2") ? "withdrawn" : "observed",
    })),
    links: async () => [
      { linkId: "link-live", role: "same-org-peer", linkState: "trusted", revokedAt: null },
      { linkId: "link-revoked", role: "same-org-peer", linkState: "revoked", revokedAt: new Date("2026-10-01") },
    ],
    activities: async (ids) => ids.map((backlogItemId) => ({ backlogItemId, kind: "intake_origin", recordedById: null, originKind: "ecosystem-peer-demand" })),
    workroomRefs: async () => [],
    evidenceRowIds: async () => [],
    originatedBuildRowIds: async () => [],
    mutatingToolCalls: async () => [],
    workSyncTwins: async () => [],
    ...extra,
  };
}

describe("loadRetirementPlan", () => {
  it("assembles facts from the source and classifies each copy", async () => {
    const rows = [row(1), row(2), row(3), row(4), row(5), row(6)];
    const plan = await loadRetirementPlan(source(rows, {
      workroomRefs: async () => ["BI-C0004"],
      mutatingToolCalls: async () => [
        { itemId: "BI-C0005", toolName: "update_backlog_item", createdAt: new Date("2026-10-30") },
        { itemId: "BI-C0006", toolName: "update_backlog_item", createdAt: new Date("2026-10-01") },
      ],
      workSyncTwins: async () => [
        { itemId: "BI-TWIN-LATE", title: "Item 1", body: "[origin:federatedWork:did_x:BI-2]", createdAt: new Date("2026-09-02") },
        { itemId: "BI-TWIN-EARLY", title: "Item 1", body: "[origin:federatedWork:did_x:BI-1]", createdAt: new Date("2026-09-01") },
        { itemId: "BI-OTHER-COPY", title: "Item 1", body: "[origin:federatedWork:did_x:BI-0]\n[origin:ecosystem-peer-demand:fdm_1]", createdAt: new Date("2026-08-01") },
      ],
    }));
    expect(plan.toRetire.map((r) => [r.itemId, r.plan.origin, r.plan.outcome, r.plan.duplicateOfItemId])).toEqual([
      ["BI-C0001", "same-org-live", "duplicate", "BI-TWIN-EARLY"],
      ["BI-C0002", "withdrawn-demand", "discard", null],
      ["BI-C0003", "revoked-link", "discard", null],
      // tool calls before filing are not local work
      ["BI-C0006", "same-org-live", "discard", null],
    ]);
    expect(plan.kept.map((k) => [k.itemId, k.reasons])).toEqual([
      ["BI-C0004", ["workroom"]],
      ["BI-C0005", ["tool-edits:update_backlog_item"]],
    ]);
  });

  it("returns an empty plan when nothing carries the marker", async () => {
    const plan = await loadRetirementPlan(source([]));
    expect(plan).toMatchObject({ scanned: 0, toRetire: [], kept: [] });
  });
});

describe("handleRetirePeerDemandIntakeCopies", () => {
  it("dry-run reports counts and the digest and writes nothing", async () => {
    const retire = vi.fn();
    const result = await handleRetirePeerDemandIntakeCopies({}, "user-1", undefined, { source: source([row(1), row(2)]), retire });
    expect(result.success).toBe(true);
    expect(retire).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ mode: "dry-run", toRetire: { total: 2 } });
    expect(typeof (result.data as { selectionDigest: string }).selectionDigest).toBe("string");
  });

  it("retire requires the dry-run digest", async () => {
    const retire = vi.fn();
    const result = await handleRetirePeerDemandIntakeCopies({ mode: "retire" }, "user-1", undefined, { source: source([row(1)]), retire });
    expect(result).toMatchObject({ success: false, error: "selection_digest_required" });
    expect(retire).not.toHaveBeenCalled();
  });

  it("refuses with no writes when the selection changed since the dry run", async () => {
    const retire = vi.fn();
    const dry = await handleRetirePeerDemandIntakeCopies({}, "u", undefined, { source: source([row(1), row(2)]), retire });
    const digest = (dry.data as { selectionDigest: string }).selectionDigest;
    const drifted = source([row(1), row(2)], { workroomRefs: async () => ["row-2"] });
    const result = await handleRetirePeerDemandIntakeCopies({ mode: "retire", selectionDigest: digest }, "u", undefined, { source: drifted, retire });
    expect(result).toMatchObject({ success: false, error: "selection_changed" });
    expect(retire).not.toHaveBeenCalled();
  });

  it("retires each copy through the retire core path and is idempotent", async () => {
    const rows = [row(1), row(2)];
    const retire = vi.fn(async (params: Record<string, unknown>, _userId: string, _context?: { agentId?: string }) => {
      const target = rows.find((r) => r.itemId === params.itemId)!;
      target.status = "retired";
      target.resolution = String(params.rationale);
      return { success: true, message: "ok" };
    });
    const settle = vi.fn(async () => {});
    const src = source(rows);
    const dry = await handleRetirePeerDemandIntakeCopies({}, "u", undefined, { source: src, retire });
    const digest = (dry.data as { selectionDigest: string }).selectionDigest;

    const first = await handleRetirePeerDemandIntakeCopies({ mode: "retire", selectionDigest: digest }, "u", { agentId: "AGT-1" }, { source: src, retire, settle });
    expect(first).toMatchObject({ success: true, data: { retired: 2, alreadyRetired: 0, failed: [] } });
    expect(retire).toHaveBeenCalledTimes(2);
    expect(retire.mock.calls[0]?.[1]).toBe("u");
    expect(retire.mock.calls[0]?.[2]).toEqual({ agentId: "AGT-1" });
    expect(String(retire.mock.calls[0]?.[0].rationale).startsWith(SWEEP_RESOLUTION_PREFIX)).toBe(true);
    expect(settle).toHaveBeenCalledWith(["BI-C0001", "BI-C0002"]);

    const second = await handleRetirePeerDemandIntakeCopies({ mode: "retire", selectionDigest: digest }, "u", undefined, { source: src, retire });
    expect(second).toMatchObject({ success: true, data: { retired: 0, alreadyRetired: 2 } });
    expect(retire).toHaveBeenCalledTimes(2);
  });

  it("reports per-item refusals without stopping the sweep", async () => {
    const retire = vi.fn(async (params: Record<string, unknown>) =>
      params.itemId === "BI-C0001" ? { success: false, error: "active_build_exists", message: "no" } : { success: true, message: "ok" });
    const src = source([row(1), row(2)]);
    const dry = await handleRetirePeerDemandIntakeCopies({}, "u", undefined, { source: src, retire });
    const digest = (dry.data as { selectionDigest: string }).selectionDigest;
    const result = await handleRetirePeerDemandIntakeCopies({ mode: "retire", selectionDigest: digest }, "u", undefined, { source: src, retire });
    expect(result.data).toMatchObject({ retired: 1, failed: [{ itemId: "BI-C0001", error: "active_build_exists" }] });
  });
});
