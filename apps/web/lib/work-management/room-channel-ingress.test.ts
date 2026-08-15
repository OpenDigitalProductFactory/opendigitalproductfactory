import { describe, expect, it, vi } from "vitest";

import { ingestWorkroomChannelEvent, type RoomChannelIngressDb } from "./room-channel-ingress";

function database(overrides: Partial<RoomChannelIngressDb> = {}): RoomChannelIngressDb {
  return {
    communicationChannelBinding: {
      findFirst: async () => ({ principal: { principalId: "PRN-7" } }),
    },
    communicationChannelSession: {
      findFirst: async () => ({ workItemId: "row-1", principal: { principalId: "PRN-7" } }),
    },
    workItem: {
      findUnique: async () => ({
        id: "row-1",
        itemId: "WI-1",
        sourceType: "booking",
        sourceId: "BK-1",
      }),
    },
    workItemMessage: {
      findUnique: async () => null,
      upsert: async () => undefined,
    },
    ...overrides,
  };
}

describe("Work Room channel ingress", () => {
  it("resolves identity and room context before writing one canonical activity", async () => {
    const upsert = vi.fn(async () => undefined);
    const result = await ingestWorkroomChannelEvent({
      db: database({
        workItemMessage: { findUnique: async () => null, upsert },
      }),
      channelType: "teams",
      providerKey: "microsoft-graph",
      providerAccountId: "tenant-1",
      providerEventId: "evt-1",
      externalSubject: "person@example.com",
      body: "The customer approved the window.",
      requestedAction: null,
      sensitivity: "internal",
      authenticationMethods: ["session"],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
    });

    expect(result).toMatchObject({ status: "accepted", principalRef: "PRN-7" });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        messageId: "microsoft-graph:evt-1",
        workItemId: "row-1",
        messageType: "external-event",
        channel: "teams",
        structuredPayload: expect.objectContaining({
          externalEventId: "microsoft-graph:evt-1",
          workroom: expect.objectContaining({ caseId: "booking:BK-1" }),
        }),
      }),
    }));
  });

  it("quarantines an unresolved external identity without loading room content", async () => {
    const loadSession = vi.fn(async () => null);
    const result = await ingestWorkroomChannelEvent({
      db: database({
        communicationChannelBinding: { findFirst: async () => null },
        communicationChannelSession: { findFirst: loadSession },
      }),
      channelType: "slack",
      providerKey: "slack-enterprise",
      providerAccountId: "workspace-1",
      providerEventId: "evt-404",
      externalSubject: "U-404",
      body: "Approve it",
      requestedAction: "approve",
      sensitivity: "confidential",
      authenticationMethods: [],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
    });

    expect(result).toMatchObject({ status: "quarantined", reason: "unresolved-principal" });
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("does not write a duplicate provider event", async () => {
    const upsert = vi.fn(async () => undefined);
    const result = await ingestWorkroomChannelEvent({
      db: database({
        workItemMessage: {
          findUnique: async () => ({ messageId: "microsoft-graph:evt-1" }),
          upsert,
        },
      }),
      channelType: "teams",
      providerKey: "microsoft-graph",
      providerAccountId: "tenant-1",
      providerEventId: "evt-1",
      externalSubject: "person@example.com",
      body: "Duplicate",
      requestedAction: null,
      sensitivity: "internal",
      authenticationMethods: ["session"],
      adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: true },
    });

    expect(result).toEqual({ status: "duplicate", eventId: "microsoft-graph:evt-1" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
