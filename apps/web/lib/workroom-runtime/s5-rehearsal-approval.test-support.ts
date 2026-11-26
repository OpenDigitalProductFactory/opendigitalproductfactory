export const s5ApprovalFixturePreview = { leaseId: "NPEL-FIXTURE", sourceSha: "a".repeat(40), origin: "http://localhost:3001" };
export const s5ApprovalFixtureAttempt = { workroomId: "WC-FIXTURE", sessionRef: "run-fixture", stageKey: "coordinate", stageAttemptRef: "attempt-1" };
export const s5ApprovalFixtureApproverPrincipal = "PRN-APPROVER";
export const s5ApprovalFixtureAgent = { principalId: "PRN-AGENT", gaid: "gaid:priv:fixture:agent" };

export function s5ApprovalFixture() {
  const p = s5ApprovalFixturePreview;
  return {
    schemaVersion: "s5-rehearsal-approval-draft.v2", leaseId: p.leaseId, sourceSha: p.sourceSha,
    approverPrincipalId: s5ApprovalFixtureApproverPrincipal,
    signingPublicKey: Buffer.alloc(44).toString("base64"), shapeRef: "shape@1",
    operations: ["get_workroom", "post_room_message"],
    snapshot: { ...s5ApprovalFixtureAttempt, profile: "synthetic-rehearsal", mode: "read-only-coordination",
      issuer: "source-A", receiverRef: "control-A", hostRef: "host-A", resource: p.origin + "/api/internal/s5-rehearsal-admission",
      originRef: "origin-A", subject: s5ApprovalFixtureAgent, authority: { bindingRef: "binding-A", grantKeys: ["room_read", "room_write"] },
      syntheticTarget: { environment: "non-production", fixtureRef: "fixture-a", databaseRef: `preview-db:${p.leaseId}`,
        caseKey: "case-a", destinationRef: "relay-a", recipient: { authorityRef: "auth-a", destinationRef: "dest-a", reservationRef: "res-a" } },
    },
  };
}
