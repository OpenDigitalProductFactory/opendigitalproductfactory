/**
 * EP-WORK-POSTURE (BI-8C54B216) — resolve a room's collaboration shape when it
 * never declared one.
 *
 * WHY THIS EXISTS. `readWorkroomShapeClaim` reads an explicitly declared shape,
 * and on the reference install 0 of 330 rooms carry one — so every shape-driven
 * behaviour (the SHAPE_BIAS table in lib/work-posture/derive.ts) was unreachable
 * in practice. Backfilling 330 rows would fix today and drift tomorrow, because
 * a room created next week is null again. Deriving covers both.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not guess. Only mappings that follow
 * directly from the shape DEFINITIONS in room-shapes.ts are made; everything
 * else returns null, and an unshaped room is reported as unshaped rather than
 * assigned a plausible-looking shape. On the reference install the scope signals
 * this reads are present on roughly one room in eight, so most rooms will
 * correctly resolve to null until they are convened with a shape. A derivation
 * that invented the other seven would be an over-reporting measure — worse than
 * no measure, because nobody could tell the invented shapes from the real ones.
 */
import type { WorkroomShapeKey } from "./room-shapes";

export interface WorkroomShapeSignals {
  /** Workroom.activityKind — one of WORK_CAPSULE_SCOPE_ACTIVITY_KINDS. */
  activityKind?: string | null;
  /** Workroom.decisionScope — wwmd | wwwd | wsid. */
  decisionScope?: string | null;
  /** WorkroomMode — "finite" | "standing". */
  mode?: string | null;
}

export interface DerivedWorkroomShape {
  shape: WorkroomShapeKey;
  /** Stable code naming the signal that produced it, for provenance. */
  reasonCode: string;
  /** Operator-readable basis, so a derived shape never looks declared. */
  reason: string;
}

/**
 * Derive a shape, or null when the room does not say enough.
 *
 * Each mapping below is justified against the shape's own definition in
 * room-shapes.ts — not against intuition about the activity name.
 */
export function deriveWorkroomShape(
  signals: WorkroomShapeSignals | null | undefined,
): DerivedWorkroomShape | null {
  if (!signals) return null;

  const kind = signals.activityKind ?? null;
  const scope = signals.decisionScope ?? null;
  const standing = signals.mode === "standing";

  // craft-stewardship IS "the standing WSID craft-stewardship room: profession
  // specialists curate the corpus under a coordinator". A standing WSID room is
  // that room by definition, not by resemblance.
  if (standing && scope === "wsid") {
    return {
      shape: "craft-stewardship",
      reasonCode: "derived_standing_wsid",
      reason: "A standing profession-scoped room is craft stewardship by definition.",
    };
  }

  // craft-judgment is the profession's own call; specialist-alignment is
  // "route a corpus check to a qualified specialist before the accountable
  // approver receives the verdict" — the finite form of the same work.
  if (kind === "craft-judgment" || (scope === "wsid" && !standing)) {
    return {
      shape: "specialist-alignment",
      reasonCode: "derived_craft_judgment",
      reason: "Profession judgment routes through a qualified specialist before the approver.",
    };
  }

  // launch-readiness is a gate whose whole purpose is a sign-off; approval-sign-off
  // is "the domain specialist prepares evidence and an accountable approver signs off".
  if (kind === "launch-readiness") {
    return {
      shape: "approval-sign-off",
      reasonCode: "derived_launch_readiness",
      reason: "A readiness gate exists to be signed off by an accountable approver.",
    };
  }

  // change-consequential is "a consequential change is reviewed and confirmed
  // before execution". Governance work sets precedent and remediation changes a
  // system that is already wrong — both are changes confirmed before execution.
  if (kind === "governance" || kind === "remediation") {
    return {
      shape: "change-consequential",
      reasonCode: kind === "governance" ? "derived_governance" : "derived_remediation",
      reason:
        kind === "governance"
          ? "Governance work sets precedent, so it is reviewed and confirmed before it takes effect."
          : "Remediation changes a system already known to be wrong, so the change is confirmed first.",
    };
  }

  // Everything else — delivery, support, improvement, lifecycle, a bare wwmd/wwwd
  // scope, or no signal at all — does not identify a collaboration shape. Several
  // shapes could fit and the room has not said which. Return null and let the
  // surface say "no shape declared".
  return null;
}
