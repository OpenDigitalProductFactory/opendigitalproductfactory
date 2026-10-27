import { expect, it, vi } from "vitest";
import { loadWorkspaceWorkCaseDetail } from "./workspace-case-loader";
import { baseItem, prismaFor } from "./workspace-case-loader.test-fixtures";

it("shows native reviewer waits before a final Workroom activity receipt exists", async () => {
  const client = prismaFor([baseItem]);
  client.workroom.findMany = async () => [{ id: "room-1", capsuleId: "WC-1", status: "working", title: "Review room" }];
  const now = new Date("2026-06-28T11:00:00Z");
  const head = "a".repeat(40);
  // Exercise candidate discovery and identity projection through the actual loader.
  // The two SQL categories have different row contracts; neither is a verdict.
  const queryRaw = vi.fn().mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join("");
    if (sql.includes("WITH rooms AS")) return [{
      id: "task-row-1", taskRunId: "TR-REVIEW", userId: "user-1", status: "input-required",
      createdAt: new Date("2026-06-28T10:00:00Z"), updatedAt: new Date("2026-06-28T10:30:00Z"), lastHeartbeatAt: null,
      capsuleId: "WC-1", reviewKind: "semantic-review", candidatePosition: 1,
      roomMissing: false, scalarTruncated: false, ambiguousReviewKind: false,
      bindingTruncated: false, progressTruncated: false, nodeFieldsTruncated: false,
      progressPayload: { semanticReview: { reason: "provider-outcome-uncertain-after-restart" } }, nodes: [],
    }];
    if (sql.includes('LEFT JOIN "TaskArtifact"')) return [{
      rowId: "task-row-1", capsuleId: "WC-1", requestBound: true,
      requestSchemaVersion: 2, requestArtifactType: "code-change",
      identityArtifactType: "code-change", identityArtifactTypePresent: true,
      sourceHeadSha: head, currentHeadSha: head, issuedAt: "2026-06-28T10:00:00Z",
    }];
    throw new Error("Unexpected reviewer query in workspace fixture");
  });
  Object.assign(client, { $queryRaw: queryRaw });
  const detail = await loadWorkspaceWorkCaseDetail({ prismaClient: client, caseKey: "booking%3ABK-1", userId: "user-1", now });
  expect(queryRaw).toHaveBeenCalledTimes(2);
  const candidateQuery = queryRaw.mock.calls.find(([parts]) => parts.join("").includes("WITH rooms AS"));
  const identityQuery = queryRaw.mock.calls.find(([parts]) => parts.join("").includes('LEFT JOIN "TaskArtifact"'));
  expect(candidateQuery?.slice(1)).toEqual([["WC-1"]]);
  expect(identityQuery?.at(-1)).toEqual(["task-row-1"]);
  expect(detail?.room?.reviewerRuns).toContainEqual(expect.objectContaining({ taskRunId: "TR-REVIEW", identityScope: "current" }));
  expect(detail?.room?.receipts.some(receipt => receipt.receiptKind === "semantic-review-receipt")).toBe(false);
  expect(detail?.room?.receipts).toContainEqual(expect.objectContaining({ receiptKind: "reviewer-state-snapshot", status: "observed" }));
  expect(detail?.room?.sourceRefs).toContainEqual(expect.objectContaining({ kind: "task-run", id: "TR-REVIEW" }));
  expect(detail?.room?.work.attentionReason).toContain("TR-REVIEW");
  expect(detail?.room?.work.nextAction).toContain("Observed execution");
  expect(detail?.room?.identity.instance.occurrenceTrace.executionRefs).toContainEqual(expect.objectContaining({ kind: "task-run", id: "TR-REVIEW" }));
});
