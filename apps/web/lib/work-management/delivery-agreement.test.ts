import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";
import { retainDeliveryAgreement, readDeliveryAgreement, projectDeliveryAgreement, finishDeliveryAgreement } from "./delivery-agreement";

const startedAt = "2026-10-25T12:00:00.000Z";
const agreement = () => retainDeliveryAgreement({}, {
  objective: "The intake handoff is verified", backlogItemId: "BI-INTAKE",
  acceptance: { digest: "sha256:original", criteria: ["One intake reaches care with its original identity"] },
  capturedAt: startedAt, basis: "created", context: { state: "unavailable", checkedAt: startedAt,
    peerRef: "customer-zero", guidanceState: "unavailable", reason: "No permitted guidance reader", sourceRefs: [] },
});

describe("finite delivery agreement", () => {
  it("retains the original objective and acceptance identity when work is retried with a larger objective", () => {
    const first = agreement();
    const next = retainDeliveryAgreement(first, { ...readDeliveryAgreement(first)!, objective: "Rebuild every rescue process",
      acceptance: { digest: "sha256:expanded", criteria: ["Every process is replaced"] } });
    expect(readDeliveryAgreement(next)).toEqual(readDeliveryAgreement(first));
  });
  it("does not turn a malformed stored agreement into permission to start over", () => {
    expect(() => retainDeliveryAgreement({ deliveryAgreement: { schemaVersion: 99 } }, readDeliveryAgreement(agreement())!)).toThrow(/agreement/i);
  });
  it("shows drift while retaining what was originally agreed", () => {
    const view = projectDeliveryAgreement({ workspaceState: agreement(), currentObjective: "Rebuild every rescue process", terminal: false });
    expect(view).toMatchObject({ originalObjective: "The intake handoff is verified", objectiveChanged: true, disposition: "in-progress" });
  });
  it("does not infer a successful handoff from a terminal room alone", () => {
    const view = projectDeliveryAgreement({ workspaceState: agreement(), currentObjective: "The intake handoff is verified", terminal: true });
    expect(view?.disposition).toBe("closed-without-handoff");
  });
  it("leaves separately owned follow-on work visible without changing a verified delivery", () => {
    const finished = finishDeliveryAgreement(agreement(), { completedAt: "2026-10-25T12:30:00.000Z",
      baselineId: "baseline-original", evidenceRefs: ["EV-1"], summary: "Intake delivered", followOnRefs: ["BI-NEXT"] });
    const view = projectDeliveryAgreement({ workspaceState: finished, currentObjective: "The intake handoff is verified", terminal: true });
    expect(view).toMatchObject({ disposition: "delivered", followOnRefs: ["BI-NEXT"] });
    expect(readDeliveryAgreement(finished)).toEqual(readDeliveryAgreement(agreement()));
  });
  it("does not fabricate an initial agreement for historical rooms", () => {
    expect(projectDeliveryAgreement({ workspaceState: {}, currentObjective: "Finished", terminal: true })).toBeNull();
  });
  it("refuses a handoff with no outcome evidence", () => {
    expect(() => finishDeliveryAgreement(agreement(), { completedAt: startedAt, baselineId: null,
      evidenceRefs: [], summary: "Done", followOnRefs: [] })).toThrow(/evidence/i);
  });
});

it("preserves the completed handoff on replay and refuses later replacement", () => {
  const handoff = { completedAt: startedAt, baselineId: "BASE-1", evidenceRefs: ["EV-1"], summary: "Verified", followOnRefs: ["BI-NEXT"] };
  const state = finishDeliveryAgreement(agreement(), handoff);
  expect(finishDeliveryAgreement(state, handoff)).toEqual(state);
  expect(() => finishDeliveryAgreement(state, { ...handoff, summary: "A different result" })).toThrow(/cannot be replaced/);
});

it("replays a persisted handoff when JSON storage changes object key order", () => {
  const handoff = { completedAt: startedAt, baselineId: "BASE-1", evidenceRefs: ["EV-1"], summary: "Verified", followOnRefs: ["BI-NEXT"] };
  const persisted = JSON.parse(canonicalJson(finishDeliveryAgreement(agreement(), handoff)));
  expect(finishDeliveryAgreement(persisted, handoff)).toEqual(persisted);
});
