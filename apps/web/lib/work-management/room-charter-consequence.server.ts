/**
 * Per-call consequence for invite_room_participant (BI-C649809F).
 *
 * The tool declares `consequence: "authority"`, and a damaging call always
 * reaches a person before any recorded steering is consulted
 * (escalation-gate.ts, resolveEscalation branch 4). That made every admission a
 * click, even into a room whose charter already decided it: on the reference
 * install 23 of 50 invites parked on an approval.
 *
 * This refiner narrows an invite the room's charter covers to non-damaging.
 * The call then goes to recorded steering (room-authority, connection-delegation)
 * or, when nothing steers it, to a person (branch 6). It never widens: a person
 * invitee, an unknown room or agent, or any error keeps `authority`
 * (resolveCallConsequence fails closed to the declaration).
 */
import { prisma } from "@dpf/db";

import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import {
  classifyInviteeAgent,
  evaluateCharterAdmission,
  requestedAdmissionClass,
  resolveRoomCharter,
} from "./room-charter";
import { resolveRoomMessagingWorkItem } from "./room-participant-invitation-preflight.server";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

function text(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const keepAuthority = (why: string): ToolCallConsequence => ({ consequence: "authority", reason: `outside-charter:${why}` });

export async function inviteRoomParticipantConsequence(call: ToolCallConsequenceInput): Promise<ToolCallConsequence> {
  const caseKey = text(call.params, "caseKey");
  const inviteeAgentId = text(call.params, "agentId");
  // People are not admitted by charter in this slice: a person invite stays a person's decision.
  if (!inviteeAgentId || text(call.params, "userId")) return keepAuthority("invitee-kind-unknown");
  if (!caseKey) return keepAuthority("room-not-found");

  const item = await resolveRoomMessagingWorkItem(caseKey);
  if (!item) return keepAuthority("room-not-found");

  const agent = await prisma.agent.findUnique({ where: { agentId: inviteeAgentId }, select: { agentId: true, status: true } });
  if (!agent) return keepAuthority("invitee-kind-unknown");
  const principal = await ensureAgentPrincipalIdentity(agent.agentId);

  const policy = readWorkspaceRoomPolicy(item.evidence);
  const roomSensitivityCeiling = policy.sensitivityCeiling ?? "internal";
  const decision = evaluateCharterAdmission({
    charter: resolveRoomCharter({ charter: policy.charter, sensitivityCeiling: roomSensitivityCeiling }),
    invitee: {
      kind: classifyInviteeAgent(agent.agentId),
      active: agent.status === "active",
      sensitivityClearance: (principal?.sensitivityClearance as string[] | undefined) ?? ["public", "internal"],
    },
    roomSensitivityCeiling,
    requestedClass: requestedAdmissionClass(call.params.canAct !== false),
    now: call.now ?? new Date(),
  });
  return { consequence: decision.inCharter ? null : "authority", reason: decision.reason };
}
