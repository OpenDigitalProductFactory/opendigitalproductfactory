export type CanonicalWorkRoomRef = {
  caseKey: string;
  caseId: string;
  workItemId: string;
};

export function buildRoomChannelEnvelope(input: {
  room: CanonicalWorkRoomRef;
  portalOrigin: string;
  summary: string;
}) {
  const origin = input.portalOrigin.replace(/\/$/, "");
  return {
    summary: input.summary,
    deepLink: `${origin}/workspace/cases/${input.room.caseKey}`,
    metadata: { workRoom: input.room },
  };
}

type InboundRoomEventInput = {
  providerKey: string;
  providerEventId: string;
  externalSubject: string;
  resolvedPrincipalRef: string | null;
  room: CanonicalWorkRoomRef | null;
  body: string;
  requestedAction: string | null;
  sensitivity: string;
  authenticationMethods: readonly string[];
  adapterCapabilities: {
    inbound: boolean;
    interactive: boolean;
    deliveryReceipts: boolean;
  };
  seenEventIds: readonly string[];
};

export type NormalizedInboundRoomEvent =
  | { status: "duplicate"; eventId: string }
  | { status: "quarantined"; eventId: string; reason: "unresolved-principal" | "unresolved-room" }
  | { status: "degraded"; eventId: string; reason: "inbound-unsupported" | "interaction-unsupported"; roomUsable: true }
  | { status: "auth-required"; eventId: string; reason: "step-up-required"; deliveryAcknowledged: false; actionCompleted: false }
  | {
      status: "accepted";
      eventId: string;
      principalRef: string;
      room: CanonicalWorkRoomRef;
      activity: { kind: "external-event"; summary: string };
      requestedAction: string | null;
      deliveryAcknowledged: false;
      actionCompleted: false;
    };

function requiresStepUp(sensitivity: string, requestedAction: string | null): boolean {
  return Boolean(requestedAction) && ["confidential", "restricted", "critical"].includes(sensitivity);
}

export function normalizeInboundRoomEvent(input: InboundRoomEventInput): NormalizedInboundRoomEvent {
  const eventId = `${input.providerKey.trim()}:${input.providerEventId.trim()}`;
  if (input.seenEventIds.includes(eventId)) return { status: "duplicate", eventId };
  if (!input.resolvedPrincipalRef) {
    return { status: "quarantined", eventId, reason: "unresolved-principal" };
  }
  if (!input.room) return { status: "quarantined", eventId, reason: "unresolved-room" };
  if (!input.adapterCapabilities.inbound) {
    return { status: "degraded", eventId, reason: "inbound-unsupported", roomUsable: true };
  }
  if (input.requestedAction && !input.adapterCapabilities.interactive) {
    return { status: "degraded", eventId, reason: "interaction-unsupported", roomUsable: true };
  }
  if (
    requiresStepUp(input.sensitivity, input.requestedAction)
    && !input.authenticationMethods.some((method) => ["mfa", "webauthn", "step-up"].includes(method))
  ) {
    return {
      status: "auth-required",
      eventId,
      reason: "step-up-required",
      deliveryAcknowledged: false,
      actionCompleted: false,
    };
  }

  return {
    status: "accepted",
    eventId,
    principalRef: input.resolvedPrincipalRef,
    room: input.room,
    activity: { kind: "external-event", summary: input.body.trim() },
    requestedAction: input.requestedAction,
    // Provider delivery is evidence about transport, never evidence that a
    // governed Work Case action completed.
    deliveryAcknowledged: false,
    actionCompleted: false,
  };
}
