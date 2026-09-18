// Mailroom dispatch (design 2026-09-09 §4.6, BI-9BD223B1).
//
//   1. Known sender first — a sender with a verified channel binding goes
//      through the room-native ingress and lands on the room they were in.
//   2. Otherwise the reason's standing queue room is opened or reused and the
//      arrival is written as an external WorkItemMessage on it.
//   3. The queue's owner, when one is bound, is notified through the
//      communication dispatcher (in-app floor). No owner → the chase surface
//      still shows the item, so an unowned queue is visible, never silent.
//
// Nothing here executes a governed verb from message content.

import type { MailroomProfile } from "@dpf/storefront-templates";
import { mailroomAcknowledgeBy } from "@dpf/storefront-templates";

import type { NormalizedInboundRoomEvent } from "@/lib/work-management/room-channel-continuity";

import type { NormalizedInboundMail } from "./providers/types";
import { ensureMailroomQueueRoom, type QueueRoomDb } from "./queue-room";
import type { TriageResult } from "./triage";

export type DispatchTarget =
  | { kind: "known-sender-room"; workItemId: string; caseKey: string }
  | { kind: "queue-room"; workItemId: string; workItemRowId: string; queueKey: string; ownerUserId: string | null; notified: boolean }
  | { kind: "none"; reason: "noise" };

export type KnownSenderIngress = (input: {
  channelType: string;
  providerKey: string;
  providerAccountId: string;
  providerEventId: string;
  externalSubject: string;
  body: string;
  requestedAction: string | null;
  sensitivity: string;
  authenticationMethods: readonly string[];
  adapterCapabilities: { inbound: boolean; interactive: boolean; deliveryReceipts: boolean };
}) => Promise<NormalizedInboundRoomEvent>;

export type DispatchDb = QueueRoomDb & {
  workItemMessage: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export type NotifyPort = (n: { recipientUserId: string; workItemId: string; title: string; body: string; urgency: string; deepLink?: string }) => Promise<void>;

/** Item urgency → notification urgency vocabulary. */
export function notificationUrgency(urgency: TriageResult["urgency"]): string {
  switch (urgency) {
    case "immediate":
      return "emergency";
    case "hours":
      return "urgent";
    default:
      return "routine";
  }
}

export async function dispatchMailroomItem(input: {
  db: DispatchDb;
  profile: MailroomProfile;
  item: { inboundId: string; channelId: string; providerAccountId: string; receivedAt: Date };
  mail: NormalizedInboundMail;
  triage: TriageResult;
  knownSenderIngress?: KnownSenderIngress;
  notify?: NotifyPort;
  portalOrigin?: string;
}): Promise<{ target: DispatchTarget; acknowledgeBy: Date | null }> {
  const { db, profile, item, mail, triage } = input;
  if (triage.noise) return { target: { kind: "none", reason: "noise" }, acknowledgeBy: null };

  const acknowledgeBy = mailroomAcknowledgeBy(triage.urgency, item.receivedAt);
  const senderAddress = mail.from?.address ?? "";
  const senderLabel = mail.from?.name ? `${mail.from.name} <${senderAddress}>` : senderAddress || "unknown sender";
  const eventBody = `${triage.summary}\n\nFrom: ${senderLabel}\nReason: ${triage.reasonKey} (${triage.urgency})` + (triage.subjectRef ? `\nAbout: ${triage.subjectRef}` : "");

  // 1. Known sender.
  if (input.knownSenderIngress && senderAddress) {
    const event = await input.knownSenderIngress({
      channelType: "email",
      providerKey: item.channelId,
      providerAccountId: item.providerAccountId,
      providerEventId: item.inboundId,
      externalSubject: senderAddress,
      body: eventBody,
      requestedAction: null,
      sensitivity: "internal",
      authenticationMethods: [],
      adapterCapabilities: { inbound: true, interactive: false, deliveryReceipts: false },
    });
    if (event.status === "accepted") {
      return { target: { kind: "known-sender-room", workItemId: event.room.workItemId, caseKey: event.room.caseKey }, acknowledgeBy };
    }
  }

  // 2. Queue room.
  const room = await ensureMailroomQueueRoom(db, profile, triage.queueKey);
  await db.workItemMessage.upsert({
    where: { messageId: `mailroom:${item.inboundId}` },
    update: {},
    create: {
      messageId: `mailroom:${item.inboundId}`,
      workItemId: room.id,
      senderType: "external",
      messageType: "external-event",
      body: eventBody,
      structuredPayload: {
        mailroomItemId: item.inboundId,
        reasonKey: triage.reasonKey,
        urgency: triage.urgency,
        subjectRef: triage.subjectRef,
        sender: senderAddress || null,
        acknowledgeBy: acknowledgeBy.toISOString(),
        triageSource: triage.source,
      },
      channel: "email",
    },
  });

  // 3. Notify the bound owner. The queue room's assignee is the explicit rung of
  // the owner ladder; the archetype-role rung arrives with the onboarding
  // ownership work and slots in here without changing the contract.
  let notified = false;
  const ownerUserId = room.assignedToUserId;
  if (ownerUserId && input.notify) {
    const origin = (input.portalOrigin ?? "").replace(/\/$/, "");
    await input.notify({
      recipientUserId: ownerUserId,
      workItemId: room.itemId,
      title: `Mailroom: ${triage.summary}`,
      body: `${senderLabel} · ${triage.reasonKey} · acknowledge by ${acknowledgeBy.toISOString()}`,
      urgency: notificationUrgency(triage.urgency),
      deepLink: `${origin}/workspace/mailroom/items/${item.inboundId}`,
    });
    notified = true;
  }

  return {
    target: { kind: "queue-room", workItemId: room.itemId, workItemRowId: room.id, queueKey: room.queueKey, ownerUserId, notified },
    acknowledgeBy,
  };
}
