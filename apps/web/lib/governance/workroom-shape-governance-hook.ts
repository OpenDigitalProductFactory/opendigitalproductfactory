// Workroom shape governance hook (W14 — BI-E0BFFF77, EP-1C37C089).
//
// The Workroom governance anchor: when a consequential coworker tool call is
// made FROM a Workroom (context.authorizedSurfaceContext.workroomId), the
// room's work shape bounds the permitted action envelope. The room's DECLARED
// shape (scopeClaims "workroomShape" claim — lib/work-management/
// workroom-shape-claim.ts) takes precedence over the tool-name-derived shape
// from classifyConsequentialTool; bindWorkroomShape then checks whether the
// room's participants satisfy the shape's inclusion order.
//
// COMPOSITION (do not add a second kernel consult here): shape bounds what is
// permitted; the existing alignment gate (principle_decide family) at
// enforceTakPreexecution decides proceed-unattended WITHIN the envelope — this
// hook adds the envelope, not a second consult.
//
// SHADOW-FIRST (kernel consult DI-6D5D686464DC): DPF_WORKROOM_GATE_MODE
// defaults to "shadow" — a deliberate inversion of the completion-evidence
// gate's enforce default. This gate must EARN enforce via shadow telemetry,
// W2 (Workroom referential integrity, BI-640B011D) landing, and operator
// ratification. Shadow is audit-only by contract — an audit write cannot
// become a denial (bare catch around every shadow write). Room-less calls are
// never denied in any mode: they stay governed by the existing alignment gate.

import type { AutonomyLevel } from "@/lib/autonomy/trust-graduation";
import type {
  ToolLifecycleDecision,
  ToolLifecycleEvent,
  ToolLifecycleHook,
} from "@/lib/mcp-governed-execute";
import type { ToolDefinition } from "@/lib/mcp-tools";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";
import {
  autonomyLevelToDecisionMode,
  type WorkCaseAutonomyDecisionMode,
} from "@/lib/work-management/autonomy-envelope";
import { deriveRoomCoordinator } from "@/lib/work-management/room-coordinator";
import {
  bindWorkroomShape,
  type WorkroomShapeKey,
} from "@/lib/work-management/room-shapes";
import type {
  WorkroomParticipantRole,
  WorkroomParticipantView,
} from "@/lib/work-management/room-types";
import type { WorkroomAccessLevel } from "@/lib/work-management/room-participation";
import {
  hasPassingVerificationEvidence,
  joinAutonomy,
  resolveVerificationRequirement,
  type VerificationEvidence,
} from "@/lib/work-management/hitl-join";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { shapeBiasFor } from "@/lib/work-posture";
import { readWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";

export type WorkroomShapeGateMode = "enforce" | "shadow" | "off";

/**
 * Deliberate inversion of the completion-evidence default: this gate ships
 * shadow-first and must earn enforce (W2 + operator ratification).
 */
export function resolveWorkroomGateMode(
  env: Record<string, string | undefined> = process.env,
): WorkroomShapeGateMode {
  const raw = (env.DPF_WORKROOM_GATE_MODE ?? "shadow").trim().toLowerCase();
  return raw === "enforce" || raw === "off" ? raw : "shadow";
}

/** Minimal room projection the gate needs — loaded via injected deps only. */
export type WorkroomShapeGateRoom = {
  /** Workroom row id (cuid). */
  id: string;
  /** Human-quotable WC-* key, when known. */
  capsuleId: string | null;
  /** Raw scopeClaims JSON; the declared shape claim is read out of it. */
  scopeClaims: unknown;
  sensitivityCeiling?: string | null;
  /** Pre-W2 minimal participant projection (principal + roles). */
  participants: ReadonlyArray<{
    principalRef: string;
    roles: readonly WorkroomParticipantRole[];
  }>;
  /** Canonical receipts already related to this Workroom. */
  verificationEvidence?: readonly VerificationEvidence[];
};

export type WorkroomShapeVerdict = {
  mode: WorkroomShapeGateMode;
  toolName: string;
  workroomId: string | null;
  /** "no-room" = no room bound; "room-not-found" = bound id resolves to nothing (pre-W2 dangling ref). */
  roomResolution: "resolved" | "no-room" | "room-not-found";
  /** The shape the envelope was bound against (room claim wins over tool-derived). */
  declaredShape: WorkroomShapeKey | null;
  shapeSource: "room-claim" | "tool-derived" | "none";
  /** null when no room/shape was bound, so no envelope verdict exists. */
  withinEnvelope: boolean | null;
  gaps: readonly string[];
  authorityLadderLevel: WorkroomAccessLevel | null;
  stepUpRequired: boolean;
  /** The decision mode AFTER joining the room's posture — what actually governs. */
  decisionMode: WorkCaseAutonomyDecisionMode;
  /**
   * EP-WORK-POSTURE (BI-06C41FDC). Which ladder set `decisionMode`. Before this,
   * the hook computed a decision mode and only RECORDED it — it never affected
   * the decision. Recording which ladder won is how an operator can tell a room
   * constraint from a trust constraint.
   */
  autonomyConstrainedBy: "envelope" | "posture" | "both-agree";
  /** The action boundary the room's posture contributed, if any. */
  postureActionBoundary: string | null;
  /** The shared room posture value also rendered by the posture surface. */
  postureVerificationDepth: string | null;
  verificationRequired: boolean;
  verificationSatisfied: boolean;
};

export type WorkroomShapeShadowRecord = {
  verdict: WorkroomShapeVerdict;
  /** Workroom row id when the room resolved, else null (sink may fall back to a structured log). */
  roomRowId: string | null;
  userId: string;
  agentId: string | null;
  source: ToolLifecycleEvent["source"];
  callerClient: string | null;
};

export type WorkroomShapeGovernanceHookDeps = {
  /** Tool registry lookup — wired to PLATFORM_TOOLS at the registration site. */
  findTool: (
    toolName: string,
  ) => Pick<ToolDefinition, "sideEffect" | "consequence"> | undefined;
  /** Room loader — wired to prisma at the registration site (no prisma here). */
  loadRoom: (workroomId: string) => Promise<WorkroomShapeGateRoom | null>;
  /** Audit sink. Audit-only by contract: failures are swallowed, never denials. */
  recordShadow: (input: WorkroomShapeShadowRecord) => Promise<void>;
  /**
   * Autonomy level for the envelope's decision-mode projection. Defaults to
   * "propose" — every acumen's registry autonomyDefault and the conservative
   * reading for consequential work (shadow telemetry only; the alignment gate
   * remains the autonomy authority).
   */
  resolveAutonomyLevel?: (event: ToolLifecycleEvent) => AutonomyLevel;
  mode?: WorkroomShapeGateMode;
  now?: () => Date;
};

type ShapeRole = "coordinator" | "specialist" | "approver" | "reviewer";
const SHAPE_ROLES: readonly ShapeRole[] = [
  "coordinator",
  "specialist",
  "approver",
  "reviewer",
];

/** Expand the minimal projection into participant views the room helpers accept. */
function toParticipantViews(
  participants: WorkroomShapeGateRoom["participants"],
): WorkroomParticipantView[] {
  return participants.map((participant) => ({
    principalRef: participant.principalRef,
    displayName: participant.principalRef,
    kind: "person",
    roles: [...participant.roles],
    workState: "unknown",
    presence: "unknown",
    currentWorkSummary: null,
    enteredReason: null,
    sponsorPrincipalRef: null,
    authoritySummary: "Participates within assigned room authority",
    sourceRefs: [],
  }));
}

/** First holder of each shape role, after coordinator derivation. */
function shapeParticipants(
  room: WorkroomShapeGateRoom,
): Partial<Record<ShapeRole, string>> {
  let views = toParticipantViews(room.participants);
  try {
    views = deriveRoomCoordinator(views);
  } catch {
    // Multiple named coordinators is a room defect, not a gate failure — bind
    // against the participants as loaded.
  }
  const byRole: Partial<Record<ShapeRole, string>> = {};
  for (const role of SHAPE_ROLES) {
    const holder = views.find((view) => view.roles.includes(role));
    if (holder) byRole[role] = holder.principalRef;
  }
  return byRole;
}

function resolveWorkroomId(event: ToolLifecycleEvent): string | null {
  const raw = event.context?.authorizedSurfaceContext?.workroomId;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function gapSummary(gaps: readonly string[]): string {
  return gaps.join(", ");
}

export function createWorkroomShapeGovernanceHook(
  deps: WorkroomShapeGovernanceHookDeps,
): ToolLifecycleHook {
  const resolveAutonomy = deps.resolveAutonomyLevel ?? (() => "propose" as const);
  return {
    id: "workroom-shape-governance",
    onPreToolUse: async (
      event: ToolLifecycleEvent,
    ): Promise<ToolLifecycleDecision> => {
      // runPreToolHooks does not catch a throwing hook, so this wraps its own
      // body: any internal failure is allow (the alignment gate still governs).
      try {
        const mode = deps.mode ?? resolveWorkroomGateMode();
        if (mode === "off") return { decision: "allow" };

        const tool = deps.findTool(event.toolName);
        if (!tool) return { decision: "allow" };
        const classification = classifyConsequentialTool({
          tool,
          toolName: event.toolName,
          workCase: event.context?.workCase,
        });
        if (!classification.consequential) return { decision: "allow" };

        const decisionMode = autonomyLevelToDecisionMode(resolveAutonomy(event));
        const record = async (verdict: WorkroomShapeVerdict): Promise<void> => {
          try {
            await deps.recordShadow({
              verdict,
              roomRowId: verdict.roomResolution === "resolved" ? verdict.workroomId : null,
              userId: event.userId,
              agentId: event.context?.agentId ?? null,
              source: event.source,
              callerClient: event.context?.callerClient ?? null,
            });
          } catch {
            // Shadow is audit-only by contract — an audit write cannot become a denial.
          }
        };

        const workroomId = resolveWorkroomId(event);
        const room = workroomId ? await deps.loadRoom(workroomId) : null;
        if (!workroomId || !room) {
          // Room-less (or dangling pre-W2 ref): record in every active mode and
          // ALLOW even under enforce — non-room surfaces stay governed by the
          // existing alignment gate, never bricked by the envelope gate.
          await record({
            mode,
            toolName: event.toolName,
            workroomId,
            roomResolution: workroomId ? "room-not-found" : "no-room",
            declaredShape: null,
            shapeSource: "none",
            withinEnvelope: null,
            gaps: [],
            authorityLadderLevel: null,
            stepUpRequired: false,
            decisionMode,
            autonomyConstrainedBy: "envelope",
            postureActionBoundary: null,
            postureVerificationDepth: null,
            verificationRequired: false,
            verificationSatisfied: true,
          });
          return { decision: "allow" };
        }

        const roomClaim = readWorkroomShapeClaim(room.scopeClaims);
        const shape: WorkroomShapeKey =
          roomClaim ?? classification.collaborationShape ?? "change-consequential";
        const binding = bindWorkroomShape({
          shape,
          initiator: event.context?.agentId
            ? { principalRef: event.context.agentId, kind: "agent" }
            : { principalRef: event.userId, kind: "person" },
          participants: shapeParticipants(room),
          sensitivityCeiling: room.sensitivityCeiling ?? null,
        });
        // EP-WORK-POSTURE (BI-06C41FDC): the room's posture now GOVERNS this
        // turn instead of being computed and discarded. A posture the room
        // DECLARED wins; otherwise the shape it is bound against implies one.
        // Both are read synchronously from data the hook already holds — no I/O
        // is added to a PreToolUse path.
        const declaredPosture = readWorkroomPostureClaim(room.scopeClaims);
        const shapeBias = shapeBiasFor(shape);
        const postureActionBoundary =
          declaredPosture?.actionBoundary
          ?? shapeBias?.actionBoundary
          ?? null;
        const joined = joinAutonomy(decisionMode, postureActionBoundary);
        const postureVerificationDepth = shapeBias?.verificationDepth ?? null;
        const verificationRequirement = resolveVerificationRequirement({
          // A declared tool consequence is the executable projection of the
          // existing outbound/floor risk class; legacy name-only policies do
          // not acquire a new verification obligation.
          risk: tool.consequence ? "outbound-or-floor" : null,
          verificationDepth: postureVerificationDepth,
        });
        const verificationSatisfied =
          !verificationRequirement.required
          || hasPassingVerificationEvidence(room.verificationEvidence);

        const verdict: WorkroomShapeVerdict = {
          mode,
          toolName: event.toolName,
          workroomId: room.id,
          roomResolution: "resolved",
          declaredShape: shape,
          shapeSource: roomClaim ? "room-claim" : "tool-derived",
          withinEnvelope: binding.allowed,
          gaps: binding.gaps,
          authorityLadderLevel: binding.authorityLadderLevel,
          stepUpRequired: binding.stepUpRequired,
          decisionMode: joined.decisionMode,
          autonomyConstrainedBy: joined.constrainedBy,
          postureActionBoundary,
          postureVerificationDepth,
          verificationRequired: verificationRequirement.required,
          verificationSatisfied,
        };
        await record(verdict);

        if (mode === "shadow") {
          return {
            decision: "allow",
            reason: binding.allowed
              ? `workroom-shape: shadow — within ${shape} envelope`
              : `workroom-shape: shadow — ${shape} envelope gaps: ${gapSummary(binding.gaps)} (audit-only)`,
          };
        }
        // A room whose posture is advise-only joins to shadow-only: the action is
        // recorded, never taken. Denying is the only honest response to a
        // consequential call in that room — allowing it would take an action the
        // room explicitly said should only be advised on.
        if (joined.decisionMode === "shadow-only") {
          return {
            decision: "deny",
            reason:
              `Workroom posture gate (BI-06C41FDC): this consequential call is bound to room `
              + `${room.capsuleId ?? room.id}, whose posture is advise-only, so the action is `
              + `recorded rather than taken. ${joined.reason} `
              + "Change the room's posture, or raise the request with its accountable owner. "
              + "Operator override: DPF_WORKROOM_GATE_MODE=shadow (audit-only) or off.",
          };
        }

        if (!binding.allowed) {
          return {
            decision: "deny",
            reason:
              `Workroom shape gate (BI-E0BFFF77): this consequential call is bound to room ${room.capsuleId ?? room.id} `
              + `whose ${shape} shape requires participants the room has not admitted: ${gapSummary(binding.gaps)}. `
              + "Admit the missing roles (or correct the room's declared shape claim) and retry. "
              + "Operator override: DPF_WORKROOM_GATE_MODE=shadow (audit-only) or off.",
          };
        }
        if (!verificationSatisfied) {
          return {
            decision: "deny",
            reason:
              `Workroom verification gate (BI-13ED1BE1): missing_verification_evidence — `
              + `${event.toolName} is consequential stake work in room ${room.capsuleId ?? room.id} `
              + "and requires a passing verification receipt before the action may close. "
              + `${verificationRequirement.reason} `
              + "Record the verification against this Workroom and retry.",
          };
        }
        return { decision: "allow" };
      } catch {
        // Fail open — the envelope gate must never wedge the loop; the
        // alignment gate downstream remains authoritative.
        return { decision: "allow" };
      }
    },
  };
}
