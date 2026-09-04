/**
 * Server binding for GAID-federated Work Room participation
 * (EP-WORKROOM-COMMS Phase 2, BI-4CA4FCE5).
 *
 * The sovereignty-preserving "apply" primitives an inbound A2A room event calls: an
 * external GAID participant is admitted to a room by its LOCAL mirrored principal
 * (outcome-scoped), and inbound posts are mirrored as external WorkItemMessages —
 * never a direct remote write. Gated (flag + trusted link + same-org) via the pure
 * core. First slice: same-org trusted links only, behind DPF_FEDERATION_A2A_ENABLED.
 * The HTTP CloudEvent ingress that drives these is a documented follow-up.
 */
import { prisma } from "@dpf/db";

import { ensureFederatedRoomPrincipal } from "@/lib/identity/principal-linking";
import {
  buildFederatedRoomMessageMirror,
  evaluateFederatedRoomAdmission,
  type FederatedRoomGateDecision,
} from "./federated-room";
import { persistExplicitWorkroomAssignmentsForWorkItem } from "./room-participant-assignment.server";
import { appendRoomPolicyParticipant } from "./room-policy";
import { decodeWorkCaseKey } from "./workspace-case-loader";

function a2aFederationEnabled(): boolean {
  return process.env.DPF_FEDERATION_A2A_ENABLED === "true";
}

async function resolveRoomWorkItem(caseKey: string) {
  const decoded = decodeWorkCaseKey(caseKey);
  if (!decoded) return null;
  return prisma.workItem.findFirst({
    where: {
      OR: [
        { sourceType: decoded.sourceType, sourceId: decoded.sourceId },
        { sourceType: decoded.sourceType, itemId: decoded.sourceId },
      ],
    },
    select: { id: true, itemId: true, title: true, evidence: true },
  });
}

export interface FederatedRoomAdmissionResult {
  gate: FederatedRoomGateDecision;
  mirroredPrincipalId?: string;
  workItemId?: string;
  error?: "invalid-case-key" | "room-not-found";
}

/**
 * Admit an external GAID participant to a room, outcome-scoped, if the sovereignty
 * gate passes. Mints/resolves the LOCAL mirrored principal and appends it to the
 * room policy. `linkTrusted` and `sameOrg` are resolved by the caller (the A2A
 * ingress) from the federation link auth.
 */
export async function admitFederatedRoomParticipant(input: {
  federationLinkId: string;
  linkTrusted: boolean;
  sameOrg: boolean;
  foreignGaid: string;
  issuer: string;
  caseKey: string;
  canAct: boolean;
  displayName?: string | null;
}): Promise<FederatedRoomAdmissionResult> {
  const gate = evaluateFederatedRoomAdmission({
    a2aEnabled: a2aFederationEnabled(),
    linkTrusted: input.linkTrusted,
    sameOrg: input.sameOrg,
  });
  if (!gate.allowed) return { gate };

  const principal = await ensureFederatedRoomPrincipal({
    foreignGaid: input.foreignGaid,
    issuer: input.issuer,
    displayName: input.displayName,
  });

  const item = await resolveRoomWorkItem(input.caseKey);
  if (!item) return { gate, error: "room-not-found" };

  const newEvidence = appendRoomPolicyParticipant(item.evidence, {
    principalRef: principal.principalId,
    roles: ["contributor"],
    canAct: input.canAct,
    enteredReason: `Federated participant via link ${input.federationLinkId}`,
  });
  await prisma.workItem.update({ where: { id: item.id }, data: { evidence: newEvidence as never } });
  await persistExplicitWorkroomAssignmentsForWorkItem({
    workItemId: item.id,
    principalRef: principal.principalId,
    roles: ["contributor"],
    enteredReason: `Federated participant via link ${input.federationLinkId}`,
  });

  return { gate, mirroredPrincipalId: principal.principalId, workItemId: item.id };
}

/**
 * Mirror an inbound federated room post as an external WorkItemMessage. Idempotent
 * on the peer message id. Requires the participant to have been admitted first
 * (same gate applies upstream at the ingress).
 */
export async function mirrorFederatedRoomMessage(input: {
  federationLinkId: string;
  foreignGaid: string;
  caseKey: string;
  body: string;
  /** Stable peer event id for idempotency. */
  peerMessageId: string;
}): Promise<{ mirrored: boolean; workItemId?: string }> {
  const item = await resolveRoomWorkItem(input.caseKey);
  if (!item) return { mirrored: false };

  const mirror = buildFederatedRoomMessageMirror({
    foreignGaid: input.foreignGaid,
    federationLinkId: input.federationLinkId,
    messageId: `a2a:${input.federationLinkId}:${input.peerMessageId}`,
    body: input.body,
  });

  await prisma.workItemMessage.upsert({
    where: { messageId: mirror.messageId },
    create: {
      messageId: mirror.messageId,
      workItemId: item.id,
      senderType: mirror.senderType,
      messageType: mirror.messageType,
      channel: mirror.channel,
      body: mirror.body,
      structuredPayload: mirror.structuredPayload as never,
    },
    update: {},
  });

  return { mirrored: true, workItemId: item.id };
}
