import { describe, expect, it } from "vitest";

import {
  evaluateWorkCaseActorCapability,
  rankWorkCaseActors,
  toWorkCaseAgentCard,
  type WorkCaseAgentCapabilityDescriptor,
} from "./agent-capability";

const HUMAN_SPONSORED_AGENT = {
  actor: { actorKind: "agent", actorId: "agt-customer-ops", displayName: "Customer Ops Agent" },
  displayName: "Customer Ops Agent",
  description: "Handles customer engagement and booking cases.",
  authorityMode: "autonomous",
  sponsorPrincipalId: "prn-human-sponsor",
  supportedSourceKeys: ["engagement", "booking"],
  supportedActions: ["respond", "propose", "delegate"],
  caseTypes: ["customer-service"],
  inputModes: ["text", "data"],
  outputModes: ["text", "artifact"],
  securitySchemes: ["dpf-authority-binding"],
  supportsStreaming: true,
  supportsLongRunning: true,
} satisfies WorkCaseAgentCapabilityDescriptor;

describe("Work Case agent capability descriptors", () => {
  it("projects an AgentCard-compatible descriptor without leaking routing internals as labels", () => {
    expect(toWorkCaseAgentCard(HUMAN_SPONSORED_AGENT)).toMatchObject({
      name: "Customer Ops Agent",
      description: "Handles customer engagement and booking cases.",
      capabilities: {
        streaming: true,
        longRunning: true,
      },
      skills: [
        {
          id: "work-case:customer-service",
          tags: ["work-case", "customer-service"],
        },
      ],
      securitySchemes: ["dpf-authority-binding"],
      dpfWorkCase: {
        actorId: "agt-customer-ops",
        authorityMode: "autonomous",
        sponsorPrincipalId: "prn-human-sponsor",
        supportedSourceKeys: ["engagement", "booking"],
        supportedActions: ["respond", "propose", "delegate"],
      },
    });
  });

  it("denies an autonomous agent descriptor without a human sponsor", () => {
    expect(
      evaluateWorkCaseActorCapability(
        {
          ...HUMAN_SPONSORED_AGENT,
          sponsorPrincipalId: null,
        },
        { sourceKey: "engagement", action: "respond", caseType: "customer-service" },
      ),
    ).toMatchObject({
      ok: false,
      reason: "missing_agent_sponsor",
    });
  });

  it("allows authenticated-inbound external agents without a DPF sponsor when inbound principal is present", () => {
    expect(
      evaluateWorkCaseActorCapability(
        {
          ...HUMAN_SPONSORED_AGENT,
          actor: { actorKind: "external", actorId: "peer-agent-1", displayName: "Peer Agent" },
          authorityMode: "authenticated-inbound",
          sponsorPrincipalId: null,
          authenticatedInboundPrincipalId: "prn-peer-agent-1",
          securitySchemes: ["federated-link-token"],
        },
        { sourceKey: "booking", action: "respond", caseType: "customer-service" },
      ),
    ).toMatchObject({
      ok: true,
      score: expect.any(Number),
    });
  });

  it("denies unsupported source/action pairs", () => {
    expect(
      evaluateWorkCaseActorCapability(
        HUMAN_SPONSORED_AGENT,
        { sourceKey: "backlog-item", action: "complete", caseType: "platform-development" },
      ),
    ).toMatchObject({
      ok: false,
      reason: "unsupported_source",
    });
  });

  it("ranks exact case-type and source matches ahead of wildcard routing candidates", () => {
    const wildcard = {
      ...HUMAN_SPONSORED_AGENT,
      actor: { actorKind: "agent", actorId: "agt-generalist", displayName: "Generalist" },
      displayName: "Generalist",
      supportedSourceKeys: ["*"],
      supportedActions: ["respond", "propose"],
      caseTypes: ["*"],
      supportsLongRunning: false,
    } satisfies WorkCaseAgentCapabilityDescriptor;

    expect(
      rankWorkCaseActors(
        [wildcard, HUMAN_SPONSORED_AGENT],
        { sourceKey: "engagement", action: "respond", caseType: "customer-service" },
      ).map((candidate) => candidate.descriptor.actor.actorId),
    ).toEqual(["agt-customer-ops", "agt-generalist"]);
  });
});
