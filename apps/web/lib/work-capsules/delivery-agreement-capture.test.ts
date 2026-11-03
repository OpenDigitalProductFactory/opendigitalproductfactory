import { describe, expect, it, vi } from "vitest";
import { captureFiniteDeliveryState } from "./delivery-agreement-capture";
import { readDeliveryAgreement } from "@/lib/work-management/delivery-agreement";
const now = new Date("2026-10-25T12:00:00.000Z");
const input = { objective: "Intake verified", source: "external-adoption", backlogItemId: "BI-1",
  acceptanceSource: { itemId: "BI-1", body: "## Acceptance\n- One intake reaches care\n## Notes\nA note" }, now };
const intent = { schemaVersion: 1, primaryPurpose: "evolve-dpf", secondaryPurposes: [], relationshipIntents: ["same-organization"],
  pairedProductionInstallationRef: "customer-zero", evidence: [], confidence: "high", confirmation: { status: "confirmed", confirmedAt: now.toISOString(), confirmedByPrincipalId: "owner" } };
function database() {
  return { platformConfig: { findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
    ({ value: where.key === "installation.operating-intent.v1" ? intent : null })) },
    federationLink: { findMany: vi.fn(async () => [{ linkId: "LINK-1", role: "same-org-peer", linkState: "trusted",
      peerOrganizationRef: "customer-zero", revokedAt: null, quarantinedAt: null }]) } };
}
describe("delivery agreement capture", () => {
  it("binds semantic acceptance, excluding unrelated notes, and checks the actual paired link", async () => {
    const db = database();
    const state = await captureFiniteDeliveryState(db, input, { environmentClass: async () => "development" });
    const agreement = readDeliveryAgreement(state)!;
    expect(agreement.acceptance?.criteria).toEqual(["One intake reaches care"]);
    expect(agreement.context).toMatchObject({ state: "checked", peerRef: "customer-zero", guidanceState: "unavailable" });
    expect(agreement.context.sourceRefs).toContain("federation-link:LINK-1");
    expect(db.federationLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11 }));
  });
  it("does not equate a trusted link with having read the peer's business guidance", async () => {
    const state = await captureFiniteDeliveryState(database(), input, { environmentClass: async () => "development" });
    expect(readDeliveryAgreement(state)?.context.reason).toMatch(/guidance.*not.*read/i);
  });
  it("reads the linked deliverable guidance only from a synced canonical peer mirror", async () => {
    const db = { ...database(), federatedRecordMirror: { findFirst: vi.fn(async () => ({ mirrorId: "MIRROR-1", version: 7n,
      peerRecordRef: "customer-zero:BI-1", lastSyncedAt: now, syncStatus: "synced" })) } };
    const state = await captureFiniteDeliveryState(db, input, { environmentClass: async () => "development" });
    expect(readDeliveryAgreement(state)?.context).toMatchObject({ guidanceState: "checked" });
    expect(readDeliveryAgreement(state)?.context.sourceRefs).toEqual(expect.arrayContaining(["federated-record-mirror:MIRROR-1@7", "applies-to:BI-1"]));
    expect(readDeliveryAgreement(state)?.context.reason).toContain("snapshot");
    expect(db.federatedRecordMirror.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      federationLinkId: "LINK-1", localRecordRef: "BI-1", canonicalSide: "peer", syncStatus: "synced" }) }));
  });
  it("surfaces a declared peer mismatch instead of silently taking guidance from another peer", async () => {
    const db = database();
    db.federationLink.findMany.mockResolvedValue([{ linkId: "LINK-OTHER", role: "same-org-peer", linkState: "trusted", peerOrganizationRef: "other-org", revokedAt: null, quarantinedAt: null }]);
    const state = await captureFiniteDeliveryState(db, input, { environmentClass: async () => "development" });
    expect(readDeliveryAgreement(state)?.context.reason).toMatch(/declared.*match/i);
    expect(readDeliveryAgreement(state)?.context.guidanceState).toBe("unavailable");
  });
  it("retains the original agreement on replay without repeating context reads", async () => {
    const db = database();
    const state = await captureFiniteDeliveryState(db, input, { environmentClass: async () => "development" });
    db.platformConfig.findUnique.mockClear();
    const replay = await captureFiniteDeliveryState(db, { ...input, workspaceState: state, objective: "Much larger outcome" });
    expect(replay).toEqual(state);
    expect(db.platformConfig.findUnique).not.toHaveBeenCalled();
  });
  it("records unavailable context without inventing a peer or failing ordinary work", async () => {
    const state = await captureFiniteDeliveryState({}, input);
    expect(readDeliveryAgreement(state)?.context).toMatchObject({ state: "unavailable", guidanceState: "unavailable" });
  });
  it("does not add a finite agreement to a standing stewardship room", async () => {
    expect(await captureFiniteDeliveryState(database(), { ...input, source: "scheduled-steward" })).toEqual({});
  });
  it("keeps the same acceptance digest after an unrelated body note changes", async () => {
    const first = readDeliveryAgreement(await captureFiniteDeliveryState({}, input));
    const next = readDeliveryAgreement(await captureFiniteDeliveryState({}, { ...input, acceptanceSource: { ...input.acceptanceSource, body: input.acceptanceSource.body + " changed" } }));
    expect(first?.acceptance?.digest).toBe(next?.acceptance?.digest);
  });
});

it("captures an ordinary finite manual room and respects an adopted standing shape", async () => {
  expect(readDeliveryAgreement(await captureFiniteDeliveryState({}, { ...input, source: "manual" }))).not.toBeNull();
  expect(await captureFiniteDeliveryState({}, { ...input, scope: { workShape: "dependency-advisory-watch@1.0.0" } })).toEqual({});
});

it("captures criteria through an existing unique-only backlog adapter", async () => {
  const findUnique = vi.fn(async () => ({ body: "## Acceptance\n- Preserve the intake identity" }));
  const state = await captureFiniteDeliveryState({ backlogItem: { findUnique } }, { ...input, acceptanceSource: undefined });
  expect(readDeliveryAgreement(state)?.acceptance?.criteria).toEqual(["Preserve the intake identity"]);
  expect(findUnique).toHaveBeenCalledWith({ where: { itemId: "BI-1" }, select: { itemId: true, body: true } });
});

it("retains the already-read semantic source without consuming another lookup", async () => {
  const findUnique = vi.fn(async () => null);
  const state = await captureFiniteDeliveryState({ backlogItem: { findUnique } }, { ...input,
    backlogItemId: "row-1",
    acceptanceSource: { itemId: "BI-1", body: "## Acceptance\n- Keep the customer owner" } });
  expect(findUnique).not.toHaveBeenCalled();
  expect(readDeliveryAgreement(state)).toMatchObject({ backlogItemId: "BI-1", acceptance: { criteria: ["Keep the customer owner"] } });
});
