import { describe, expect, it } from "vitest";

import {
  describeExternalApprovalLocation,
  isPendingEnvelopeVisibleToCaller,
  listPendingEnvelopesForCaller,
  PENDING_APPROVAL_INBOX_HREF,
  withExternalApprovalLocation,
  type PendingEnvelopeRow,
} from "./external-approval-location";
import { coworkerEnvelopeToAttentionItem } from "@/lib/attention/sources/coworker-envelope";

const OWNER = "admin-token-user";
const OPERATOR = "signed-in-operator";
const NOW = new Date("2026-08-31T20:49:22.000Z");

const proposed: PendingEnvelopeRow = {
  id: "cmthpk6kpfylj01lc5r5cealp",
  delegatingUserId: OWNER,
  status: "proposed",
  taskRunId: "TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-0C8D679DE842",
  expiresAt: new Date("2026-08-31T21:49:22.000Z"),
  rationale: "Record research evidence.",
  manifestActionId: "record_initiative_evidence",
};

describe("describeExternalApprovalLocation", () => {
  it("names the owner and an actionable location without inventing a second store", () => {
    const location = describeExternalApprovalLocation({
      envelopeId: proposed.id,
      delegatingUserId: OWNER,
      taskRunId: proposed.taskRunId,
      expiresAt: proposed.expiresAt,
    });

    expect(location.envelopeId).toBe(proposed.id);
    expect(location.delegatingUserId).toBe(OWNER);
    expect(location.taskRunId).toBe(proposed.taskRunId);
    expect(location.inboxHref).toBe(PENDING_APPROVAL_INBOX_HREF);
    expect(location.approveHref).toBe(`/api/agent/envelope/${proposed.id}/approve`);
    expect(location.declineHref).toBe(`/api/agent/envelope/${proposed.id}/deny`);
    expect(location.nextAction).toContain(OWNER);
    expect(location.nextAction).toContain(PENDING_APPROVAL_INBOX_HREF);
    expect(location.nextAction).toContain("cannot approve this envelope by administrator privilege");
  });
});

describe("withExternalApprovalLocation", () => {
  it("attaches the location to a requiresApproval TaskRun result", () => {
    const location = describeExternalApprovalLocation({
      envelopeId: proposed.id,
      delegatingUserId: OWNER,
      taskRunId: proposed.taskRunId,
    });
    const result = withExternalApprovalLocation({
      taskRunId: proposed.taskRunId,
      status: "input-required",
      requiresApproval: true,
    }, location);

    expect(result.approval).toEqual(location);
    expect(result.requiresApproval).toBe(true);
  });

  it("leaves a result unchanged when no envelope exists", () => {
    const result = { taskRunId: "TR-1", status: "completed" };
    expect(withExternalApprovalLocation(result, null)).toBe(result);
  });
});

describe("listPendingEnvelopesForCaller", () => {
  it("returns the token owner's pending envelope", () => {
    const listed = listPendingEnvelopesForCaller([proposed], OWNER, NOW);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.envelopeId).toBe(proposed.id);
  });

  it("hides the envelope from a different signed-in operator", () => {
    expect(listPendingEnvelopesForCaller([proposed], OPERATOR, NOW)).toEqual([]);
    expect(isPendingEnvelopeVisibleToCaller(proposed, OPERATOR, NOW)).toBe(false);
  });

  it("refuses an empty caller rather than falling back to every envelope", () => {
    expect(listPendingEnvelopesForCaller([proposed], "", NOW)).toEqual([]);
  });

  it("excludes expired and non-proposed rows", () => {
    expect(listPendingEnvelopesForCaller([
      { ...proposed, status: "approved" },
      { ...proposed, id: "expired", expiresAt: new Date("2026-08-31T19:00:00.000Z") },
    ], OWNER, NOW)).toEqual([]);
  });
});

describe("MCP result and inbox projection agree", () => {
  it("names the same owner, expiry, inbox, and settle hrefs", () => {
    const location = describeExternalApprovalLocation({
      envelopeId: proposed.id,
      delegatingUserId: OWNER,
      taskRunId: proposed.taskRunId,
      status: proposed.status,
      expiresAt: proposed.expiresAt,
    });
    const item = coworkerEnvelopeToAttentionItem({
      id: proposed.id,
      coworkerAgentId: "AGT-WS-BUILD",
      delegatingUserId: OWNER,
      manifestActionId: proposed.manifestActionId,
      rationale: proposed.rationale,
      status: proposed.status,
      taskRunId: proposed.taskRunId,
      expiresAt: proposed.expiresAt instanceof Date ? proposed.expiresAt : new Date(String(proposed.expiresAt)),
      createdAt: NOW,
      taskRun: null,
    }, NOW.getTime());

    expect(item.envelope?.envelopeId).toBe(location.envelopeId);
    expect(item.envelope?.delegatingUserId).toBe(location.delegatingUserId);
    expect(item.envelope?.status).toBe(location.status);
    expect(item.envelope?.expiresAtIso).toBe(location.expiresAt);
    expect(item.envelope?.approveHref).toBe(location.approveHref);
    expect(item.envelope?.declineHref).toBe(location.declineHref);
    expect(item.deepLink).toBe(location.inboxHref);
  });
});
