import { describe, expect, it, vi } from "vitest";

import {
  assertDocsImpactDisposed,
  disposedDocsFromEvidence,
  pendingDocsFromVerificationState,
  undisposedDocs,
} from "./docs-impact-disposition";
import { publicationRefusedToolResult } from "./publication-refusal";
import { WorkCapsulePublicationRefusedError } from "./work-capsule-terminal-status";

const PARITY = "docs/architecture/agent-client-capability-parity.md";
const GATES = "docs/architecture/enforced-ci-gates.md";

const verificationState = {
  changeImpactContract: {
    status: "resolved",
    gateContext: {
      docsImpact: [
        { doc: PARITY, status: "pending", because: ["code packages/dpf-skill-pack/hooks/hooks.json"] },
        { doc: GATES, status: "updated", because: ["code scripts/check-docs-impact.mjs"] },
      ],
    },
  },
};

const disposition = (docs: unknown[]) => ({ kind: "docs-impact-disposition", summary: "docs", result: { docs } });

describe("docs-impact disposition at Workroom handoff (BI-9B17E889)", () => {
  it("reads only pending docs from the room's change-impact contract", () => {
    expect(pendingDocsFromVerificationState(verificationState)).toEqual([PARITY]);
    expect(pendingDocsFromVerificationState({})).toEqual([]);
    expect(pendingDocsFromVerificationState(null)).toEqual([]);
  });

  it("settles a doc as updated, or as not-affected only with a reason", () => {
    expect(disposedDocsFromEvidence(disposition([{ doc: PARITY, disposition: "updated" }]))).toEqual([PARITY]);
    expect(disposedDocsFromEvidence(disposition([{ doc: PARITY, disposition: "not-affected", reason: "internal rename, behaviour unchanged" }]))).toEqual([PARITY]);
    expect(disposedDocsFromEvidence(disposition([{ doc: PARITY, disposition: "not-affected" }]))).toEqual([]);
    expect(disposedDocsFromEvidence(disposition([{ doc: PARITY, disposition: "skipped", reason: "a long enough reason" }]))).toEqual([]);
    expect(disposedDocsFromEvidence({ kind: "note", result: { docs: [{ doc: PARITY, disposition: "updated" }] } })).toEqual([]);
  });

  it("lists the docs no disposition settles", () => {
    expect(undisposedDocs([PARITY, GATES], [disposition([{ doc: GATES, disposition: "updated" }])])).toEqual([PARITY]);
  });

  it("refuses ready-for-review while a pending doc has no disposition, and names the repair", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const error = await assertDocsImpactDisposed({
      status: "ready-for-review", capsuleRowId: "row-1", verificationState, workroomActivity: { findMany },
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(WorkCapsulePublicationRefusedError);
    expect(error.code).toBe("docs_impact_disposition_required");
    expect(error.undisposedDocs).toEqual([PARITY]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { workCapsuleId: "row-1", kind: "evidence-recorded" } });

    const result = publicationRefusedToolResult(error, { capsuleId: "WC-1", status: "ready-for-review" });
    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ undisposedDocs: [PARITY] });
    expect(String((result.data as { nextAction: string }).nextAction)).toMatch(/docs-impact-disposition/);
  });

  it("allows the handoff once every pending doc is settled", async () => {
    const findMany = vi.fn().mockResolvedValue([{ payload: disposition([{ doc: PARITY, disposition: "updated" }]) }]);
    await expect(assertDocsImpactDisposed({
      status: "ready-for-review", capsuleRowId: "row-1", verificationState, workroomActivity: { findMany },
    })).resolves.toBeUndefined();
  });

  it("does not judge non-handoff statuses, rooms with no affected docs, or rooms it cannot read", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await assertDocsImpactDisposed({ status: "working", capsuleRowId: "r", verificationState, workroomActivity: { findMany } });
    await assertDocsImpactDisposed({ status: "complete", capsuleRowId: "r", verificationState, workroomActivity: { findMany } });
    await assertDocsImpactDisposed({ status: "ready-for-review", capsuleRowId: "r", verificationState: {}, workroomActivity: { findMany } });
    expect(findMany).not.toHaveBeenCalled();
    await expect(assertDocsImpactDisposed({
      status: "ready-for-review", capsuleRowId: "r", verificationState, workroomActivity: {},
    })).resolves.toBeUndefined();
  });
});
