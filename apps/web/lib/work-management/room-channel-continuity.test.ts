import { describe, expect, it } from "vitest";

import {
  buildRoomChannelEnvelope,
  normalizeInboundRoomEvent,
} from "./room-channel-continuity";

const room = {
  caseKey: "booking%3ABK-1",
  caseId: "booking:BK-1",
  workItemId: "WI-1",
};

describe("Work Room channel continuity", () => {
  it("carries a canonical room reference and safe deep link across channels", () => {
    expect(buildRoomChannelEnvelope({
      room,
      portalOrigin: "https://dpf.example",
      summary: "Approval is needed before Friday.",
    })).toEqual({
      summary: "Approval is needed before Friday.",
      deepLink: "https://dpf.example/workspace/cases/booking%3ABK-1",
      metadata: { workroom: room },
    });
  });

  it("quarantines inbound events whose PrincipalAlias is unresolved", () => {
    expect(normalizeInboundRoomEvent({
      providerKey: "slack-enterprise",
      providerEventId: "evt-1",
      externalSubject: "U-404",
      resolvedPrincipalRef: null,
      room,
      body: "Approve it",
      requestedAction: "approve",
      sensitivity: "confidential",
      authenticationMethods: [],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
      seenEventIds: [],
    })).toMatchObject({ status: "quarantined", reason: "unresolved-principal" });
  });

  it("suppresses duplicate provider events with a stable identity", () => {
    expect(normalizeInboundRoomEvent({
      providerKey: "teams",
      providerEventId: "evt-7",
      externalSubject: "person@example.com",
      resolvedPrincipalRef: "PRN-7",
      room,
      body: "Still working",
      requestedAction: null,
      sensitivity: "internal",
      authenticationMethods: ["session"],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
      seenEventIds: ["teams:evt-7"],
    })).toEqual({ status: "duplicate", eventId: "teams:evt-7" });
  });

  it("requires step-up for sensitive channel actions and never treats delivery as completion", () => {
    expect(normalizeInboundRoomEvent({
      providerKey: "teams",
      providerEventId: "evt-8",
      externalSubject: "person@example.com",
      resolvedPrincipalRef: "PRN-7",
      room,
      body: "Approve it",
      requestedAction: "approve",
      sensitivity: "confidential",
      authenticationMethods: ["session"],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
      seenEventIds: [],
    })).toMatchObject({
      status: "auth-required",
      eventId: "teams:evt-8",
      deliveryAcknowledged: false,
      actionCompleted: false,
    });
  });

  it("leaves the DPF room usable when a provider cannot receive inbound work", () => {
    expect(normalizeInboundRoomEvent({
      providerKey: "email",
      providerEventId: "evt-9",
      externalSubject: "person@example.com",
      resolvedPrincipalRef: "PRN-7",
      room,
      body: "Update",
      requestedAction: null,
      sensitivity: "public",
      authenticationMethods: [],
      adapterCapabilities: { inbound: false, interactive: false, deliveryReceipts: true },
      seenEventIds: [],
    })).toEqual({
      status: "degraded",
      eventId: "email:evt-9",
      reason: "inbound-unsupported",
      roomUsable: true,
    });
  });
});
