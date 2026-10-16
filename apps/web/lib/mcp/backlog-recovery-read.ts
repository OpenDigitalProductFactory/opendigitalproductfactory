import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { INITIATIVE_GATE_KEYS } from "@/lib/backlog/initiative-readiness/receipt-schema";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import type { ToolResult } from "@/lib/mcp-tool-types";

export const RECOVERY_READ_GATES = [...INITIATIVE_GATE_KEYS, "objective-mapping"] as const;
const MAX_RECOVERY_READ_CHARS = 8_000;

export function isRecoveryReadGate(value: unknown): value is typeof RECOVERY_READ_GATES[number] {
  return typeof value === "string" && (RECOVERY_READ_GATES as readonly string[]).includes(value);
}

/** Select the same owed decision as dispatch; projection never confers eligibility. */
export async function recoveryReadDecision(gate: string, decisions: Partial<Record<"plan" | "implementation" | "completion", InitiativeReadinessDecision>>) {
  if (gate === "research") {
    const research = [decisions.plan, decisions.implementation, decisions.completion].find(decision =>
      decision && [...decision.blockers, ...decision.unmet].some(entry => entry.code === "RESEARCH_REQUIRED"));
    if (research) return research;
  }
  const { INITIATIVE_READINESS_LANES } = await import("@/lib/tak/initiative-readiness-tool-grants");
  const { decisionForIndependentReview } = await import("@/lib/backlog/initiative-readiness/design-phase-recovery");
  const writer = Object.entries(INITIATIVE_READINESS_LANES).find(([, lane]) =>
    (lane.gates as readonly string[]).includes(gate))?.[0];
  return (writer ? decisionForIndependentReview(writer, decisions) : null)
    ?? decisions.completion ?? decisions.implementation ?? decisions.plan ?? null;
}

/** A bounded packet read never substitutes item visibility for exact-room content access. */
export async function canReadRecoveryPacket(args: {
  gate: string; recovery?: Recovery; currentAgentId: string | null; currentUserId?: string;
}) {
  const routes = args.recovery?.reviewerRoutes.filter(route => route.gate === args.gate) ?? [];
  if (!routes.length) return true; // The issuer's refusal/escalation contains no request.
  if (!args.currentUserId) return false;
  const { prisma } = await import("@dpf/db");
  const { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  for (const route of routes) {
    if (!route.workroomId) return false;
    const room = await prisma.workroom.findUnique({ where: { capsuleId: route.workroomId }, select: { id: true } });
    if (!room) return false;
    const input = { userId: args.currentUserId, workroomId: room.id, requested: "content" as const };
    const access = args.currentAgentId
      ? await resolveAgentWorkroomAccess({ ...input, agentId: args.currentAgentId })
      : await resolveHumanWorkroomAccess(input);
    if (access.decision.level !== "content") return false;
  }
  return true;
}

type Recovery = {
  reviewerRoutes: readonly { gate: string; workroomId?: string; requestCoworker?: unknown }[];
  escalations: readonly unknown[];
  unroutable: readonly unknown[];
};

/** One exact request or a finite refusal, shared by MCP callers without registering a tool pack. */
export function boundedBacklogRecoveryRead(args: {
  itemId: string; status: string; workShape: string | null; gate: string; recovery?: Recovery;
}): ToolResult {
  const recovery = args.recovery ?? { reviewerRoutes: [], escalations: [], unroutable: [] };
  const availableGates = [...new Set(recovery.reviewerRoutes.map(route => route.gate).filter(isRecoveryReadGate))].sort();
  const routes = recovery.reviewerRoutes.filter(route => route.gate === args.gate);
  const identity = { itemId: args.itemId, status: args.status, workShape: args.workShape,
    recoveryGate: args.gate, availableGates };
  if (routes.length > 1 || (!routes.length && !recovery.escalations.length && !recovery.unroutable.length)) {
    return { success: false, error: routes.length > 1 ? "recovery_gate_ambiguous" : "recovery_gate_unavailable",
      message: "No unique current request was delivered for this gate. Do not reconstruct or dispatch a different request.",
      data: { ...identity, nextAction: "Follow current readiness on the exact Workroom. A satisfied gate needs no new review; unresolved ownership or source must be reconciled before requesting it." } };
  }
  const result: ToolResult = { success: true, message: `Loaded bounded ${args.gate} recovery for ${args.itemId}.`,
    data: { ...identity, recovery: { reviewerRoutes: routes, escalations: recovery.escalations, unroutable: recovery.unroutable } } };
  const requiredChars = JSON.stringify(result).length;
  if (requiredChars <= MAX_RECOVERY_READ_CHARS) return result;
  return { success: false, error: "recovery_packet_over_budget",
    message: "The current recovery packet was not delivered: it exceeds the bounded response budget. No partial request was returned.",
    data: { ...identity, requiredChars, limitChars: MAX_RECOVERY_READ_CHARS,
      requestDigest: `sha256:${createHash("sha256").update(canonicalJson(result.data)).digest("hex")}`,
      nextAction: "Retain this digest and report the issuer's oversized packet to the delivery coordinator. Do not reconstruct it, alter it or retry the full item response." } };
}
