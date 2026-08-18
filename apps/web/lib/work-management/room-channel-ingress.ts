import { encodeWorkCaseKey } from "./workspace-case-loader";
import {
  buildCanonicalWorkroomMetadata,
  normalizeInboundRoomEvent,
  type NormalizedInboundRoomEvent,
} from "./room-channel-continuity";

type AdapterCapabilities = {
  inbound: boolean;
  interactive: boolean;
  deliveryReceipts: boolean;
};

export type RoomChannelIngressDb = {
  communicationChannelBinding: {
    findFirst(args: unknown): Promise<{ principal: { principalId: string } } | null>;
  };
  communicationChannelSession: {
    findFirst(args: unknown): Promise<{
      workItemId: string | null;
      principal: { principalId: string } | null;
    } | null>;
  };
  workItem: {
    findUnique(args: unknown): Promise<{
      id: string;
      itemId: string;
      sourceType: string;
      sourceId: string | null;
    } | null>;
  };
  workItemMessage: {
    findUnique(args: unknown): Promise<{ messageId: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export async function ingestWorkroomChannelEvent(input: {
  db: RoomChannelIngressDb;
  channelType: string;
  providerKey: string;
  providerAccountId: string;
  providerEventId: string;
  externalSubject: string;
  body: string;
  requestedAction: string | null;
  sensitivity: string;
  authenticationMethods: readonly string[];
  adapterCapabilities: AdapterCapabilities;
}): Promise<NormalizedInboundRoomEvent> {
  const eventId = `${input.providerKey.trim()}:${input.providerEventId.trim()}`;
  const binding = await input.db.communicationChannelBinding.findFirst({
    where: {
      channelType: input.channelType,
      providerKey: input.providerKey,
      providerAccountId: input.providerAccountId,
      externalSubject: input.externalSubject,
      isActive: true,
      verificationStatus: "verified",
      allowedDirections: { has: "inbound" },
    },
    select: { principal: { select: { principalId: true } } },
  });
  if (!binding) {
    return normalizeInboundRoomEvent({
      ...input,
      resolvedPrincipalRef: null,
      room: null,
      seenEventIds: [],
    });
  }

  const session = await input.db.communicationChannelSession.findFirst({
    where: {
      channelType: input.channelType,
      providerKey: input.providerKey,
      providerAccountId: input.providerAccountId,
      externalPeerId: input.externalSubject,
      principalId: { not: null },
      workItemId: { not: null },
    },
    select: {
      workItemId: true,
      principal: { select: { principalId: true } },
    },
  });
  const principalMatches = session?.principal?.principalId === binding.principal.principalId;
  const workItem = principalMatches && session?.workItemId
    ? await input.db.workItem.findUnique({
        where: { id: session.workItemId },
        select: { id: true, itemId: true, sourceType: true, sourceId: true },
      })
    : null;
  const room = workItem
    ? {
        caseKey: encodeWorkCaseKey({
          sourceType: workItem.sourceType,
          sourceId: workItem.sourceId ?? workItem.itemId,
        }),
        caseId: `${workItem.sourceType}:${workItem.sourceId ?? workItem.itemId}`,
        workItemId: workItem.itemId,
      }
    : null;
  const existing = await input.db.workItemMessage.findUnique({ where: { messageId: eventId } });
  const normalized = normalizeInboundRoomEvent({
    ...input,
    resolvedPrincipalRef: binding.principal.principalId,
    room,
    seenEventIds: existing ? [eventId] : [],
  });

  if (normalized.status !== "accepted" || !workItem) return normalized;

  await input.db.workItemMessage.upsert({
    where: { messageId: eventId },
    update: {},
    create: {
      messageId: eventId,
      workItemId: workItem.id,
      senderType: "external",
      messageType: "external-event",
      body: normalized.activity.summary,
      structuredPayload: {
        externalEventId: eventId,
        principalRef: normalized.principalRef,
        ...buildCanonicalWorkroomMetadata(normalized.room),
        requestedAction: normalized.requestedAction,
      },
      channel: input.channelType,
    },
  });
  return normalized;
}
