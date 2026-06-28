import { describe, expect, it } from "vitest";

import { evaluateFederatedWorkCaseParticipation } from "./federation-governance";
import type { WorkCaseAgentCapabilityDescriptor } from "./agent-capability";

const FEDERATED_AGENT = {
  actor: { actorKind: "external", actorId: "peer-agent-1", displayName: "Peer Agent" },
  displayName: "Peer Agent",
  authorityMode: "authenticated-inbound",
  authenticatedInboundPrincipalId: "prn-peer-agent-1",
  supportedSourceKeys: ["engagement"],
  supportedActions: ["respond", "propose"],
  caseTypes: ["customer-service"],
  inputModes: ["text", "data"],
  outputModes: ["text", "artifact"],
  securitySchemes: ["federated-link-token"],
  supportsStreaming: true,
  supportsLongRunning: true,
  federation: {
    linkId: "flnk-1",
    peerOrganizationId: "org-peer",
    trustState: "trusted",
    controlTowerVisible: true,
  },
} satisfies WorkCaseAgentCapabilityDescriptor;

describe("evaluateFederatedWorkCaseParticipation", () => {
  it("allows trusted authenticated-inbound peers to participate as governed delegates", () => {
    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: FEDERATED_AGENT,
        sourceKey: "engagement",
        action: "respond",
        risk: "read-only",
        receiptSupported: true,
        stopConditionsSupported: true,
      }),
    ).toMatchObject({
      ok: true,
      participationMode: "delegate",
      maxAutonomyLevel: "autopilot",
      requiredControls: expect.arrayContaining([
        "authenticated-inbound-principal",
        "federation-link",
        "receipt-stream",
        "stop-conditions",
        "control-tower-visibility",
      ]),
    });
  });

  it("refuses federated actors without authenticated-inbound authority", () => {
    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: {
          ...FEDERATED_AGENT,
          authorityMode: "autonomous",
          authenticatedInboundPrincipalId: null,
        },
        sourceKey: "engagement",
        action: "respond",
        risk: "read-only",
        receiptSupported: true,
        stopConditionsSupported: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_authenticated_inbound_authority",
    });
  });

  it("caps outbound/floor-risk peer participation at proposal mode", () => {
    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: FEDERATED_AGENT,
        sourceKey: "engagement",
        action: "propose",
        risk: "outbound-or-floor",
        receiptSupported: true,
        stopConditionsSupported: true,
      }),
    ).toMatchObject({
      ok: true,
      participationMode: "propose",
      maxAutonomyLevel: "propose",
    });
  });

  it("refuses peers that are not visible in a control-tower surface", () => {
    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: {
          ...FEDERATED_AGENT,
          federation: {
            ...FEDERATED_AGENT.federation,
            controlTowerVisible: false,
          },
        },
        sourceKey: "engagement",
        action: "respond",
        risk: "read-only",
        receiptSupported: true,
        stopConditionsSupported: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_control_tower_visibility",
    });
  });

  it("refuses participation when receipt or stop-condition support is missing", () => {
    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: FEDERATED_AGENT,
        sourceKey: "engagement",
        action: "respond",
        risk: "read-only",
        receiptSupported: false,
        stopConditionsSupported: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_receipt_support",
    });

    expect(
      evaluateFederatedWorkCaseParticipation({
        descriptor: FEDERATED_AGENT,
        sourceKey: "engagement",
        action: "respond",
        risk: "read-only",
        receiptSupported: true,
        stopConditionsSupported: false,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_stop_condition_support",
    });
  });
});
