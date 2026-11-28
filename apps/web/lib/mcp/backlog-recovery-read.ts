import { createHash } from "node:crypto";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import type { issueOriginalReviewRecoveryTarget } from "@/lib/mcp-task-review-recovery";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { INITIATIVE_GATE_KEYS } from "@/lib/backlog/initiative-readiness/receipt-schema";
import type { InitiativeReadinessDecision, ReadinessProfile, ReadinessRequirementResult } from "@/lib/backlog/initiative-readiness/types";
import type { ToolResult } from "@/lib/mcp-tool-types";

export const RECOVERY_READ_GATES = [...INITIATIVE_GATE_KEYS, "objective-mapping"] as const;
const MAX_RECOVERY_READ_CHARS = 8_000;

export function isRecoveryReadGate(value: unknown): value is typeof RECOVERY_READ_GATES[number] {
  return typeof value === "string" && (RECOVERY_READ_GATES as readonly string[]).includes(value);
}

/** Select the same owed decision as dispatch; projection never confers eligibility. */
export async function recoveryReadDecision(gate: string, decisions: Partial<Record<"plan" | "implementation" | "completion", InitiativeReadinessDecision>>,
  planBaselinePrerequisite?: ReadinessRequirementResult | null) {
  if (gate === "research") {
    const research = [decisions.plan, decisions.implementation, decisions.completion].find(decision =>
      decision && [...decision.blockers, ...decision.unmet].some(entry => entry.code === "RESEARCH_REQUIRED"));
    if (research) return research;
  }
  const { INITIATIVE_READINESS_LANES } = await import("@/lib/tak/initiative-readiness-tool-grants");
  const { decisionForIndependentReview } = await import("@/lib/backlog/initiative-readiness/design-phase-recovery");
  const writer = Object.entries(INITIATIVE_READINESS_LANES).find(([, lane]) =>
    (lane.gates as readonly string[]).includes(gate))?.[0];
  return (writer ? decisionForIndependentReview(writer, decisions, planBaselinePrerequisite, gate) : null)
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
  itemId: string; status: string; workShape: string | null; gate: string;
  profile?: ReadinessProfile; recovery?: Recovery;
}): ToolResult {
  const recovery = args.recovery ?? { reviewerRoutes: [], escalations: [], unroutable: [] };
  const availableGates = [...new Set(recovery.reviewerRoutes.map(route => route.gate).filter(isRecoveryReadGate))].sort();
  const routes = recovery.reviewerRoutes.filter(route => route.gate === args.gate);
  const identity = { itemId: args.itemId, status: args.status, workShape: args.workShape,
    recoveryGate: args.gate, availableGates };
  // A doc-only decision does not owe the specialist design gate. Do not
  // substitute an unrelated acceptance escalation for a data-review packet.
  if (args.gate === "data-review" && args.profile === "doc-only" && routes.length === 0) {
    const recordVerdict = "Ask the accountable data owner to review the exact deliverable and record their verdict. Link that attributable verdict on the item with record_execution_evidence (manual_check for agreement, manual_fail for a refusal).";
    return {
      success: false, error: "recovery_gate_not_applicable",
      message: "The data-review specialist design gate is not offered for the doc-only profile. A data-owner sign-off in the acceptance criteria belongs to acceptance evidence.",
      data: { ...identity, nextAction: args.status === "done"
        ? `${recordVerdict} This item is already done. The link is supplemental evidence, not a new gate receipt or a reason to reopen the item.`
        : `${recordVerdict} Cite the evidence in the normal completion flow, and use objective-mapping if independent acceptance is owed. An acceptance review does not substitute for the data owner's decision.` },
    };
  }
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

/** Called only after exact-room content and current connection admission. */
export async function finalizeOriginalRecoveryRoute(
  route: InitiativeReviewerRecovery["reviewerRoutes"][number],
  issued: Awaited<ReturnType<typeof issueOriginalReviewRecoveryTarget>>,
  itemId: string,
  isCurrent?: () => Promise<boolean>,
): Promise<ToolResult | null> {
  if (issued.kind === "refused") return { success: false, error: "original_review_recovery_required",
    message: "The existing review needs reconciliation before any new dispatch. No replacement request was delivered.",
    data: { reason: issued.reason, itemId, recoveryGate: route.gate,
      ...(issued.originalResult ? { originalResult: issued.originalResult } : {}),
      ...(issued.resultRead ? { resultRead: issued.resultRead } : {}) } };
  if (issued.kind === "target") {
    route.requestCoworker = { ...route.requestCoworker, ...{ reviewRecovery: issued.target } };
    return null;
  }
  const binding = route.requestCoworker.initiativeReviewBinding;
  if (issued.kind !== "none" || route.gate !== "spec-approval" || !binding?.expectedCurrentBaselineId) return null;
  // This previews required input without changing the immutable request. The
  // admission path checks it again before committing to new reviewer work.
  const { reviewDocumentPreflight } = await import("@/lib/mcp-task-review-document");
  const { refusal, supersession } = await reviewDocumentPreflight(binding);
  if (isCurrent && !await isCurrent()) return (await import("./backlog-workroom-read-source")).selectionRefusal;
  if (refusal) {
    const { error, message, ...details } = refusal;
    return { success: false, error, message, data: { ...details, itemId, recoveryGate: route.gate } };
  }
  if (supersession) Object.assign(route, { approvalInput: supersession });
  return null;
}
