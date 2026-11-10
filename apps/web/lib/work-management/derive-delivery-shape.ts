/**
 * Delivery-shape resolution at claim time (BI-02470C7E, design §3.3 / §3.4).
 *
 * Order: the caller declared it → recorded as declared. Not declared but every
 * classification rule agrees → derived, with the signals used. Otherwise the
 * claim is refused with the five-shape pick list so the agent can put the
 * choice to a person and re-claim. It never guesses: a shape is an explicit act.
 *
 * Mirrors derive-workroom-shape.ts for the collaboration axis — only mappings
 * that follow from the rules in the design are made; the rest resolve to
 * `ambiguous` rather than a plausible-looking answer.
 */

import {
  DELIVERY_SHAPES,
  DELIVERY_SHAPE_KEYS,
  DELIVERY_SHAPE_REFS,
  DELIVERY_SHAPE_VERSION,
  type DeliveryShapeKey,
  isDeliveryShapeKey,
} from "./delivery-shapes";
import { parseWorkShapeRef } from "./workroom-shape-claim";

export type DeliveryShapeSignals = {
  /** BacklogItem.effortSize — small | medium | large | xlarge, or null when unsized. */
  effortSize?: string | null;
  /** BacklogItem.workType — bug | feature | chore | doc | tool | skill | refactor. */
  workType?: string | null;
  /** Derived deliverable sensitivity; recorded, and raises gates, never the shape. */
  sensitivity?: "low" | "elevated" | "high" | null;
  /** Rule 4: the work adds substrate (model, enum value, tool, route, agent role, archetype). */
  addsSubstrate?: boolean | null;
  /** Rule 1: an operator declared the expedite lane. */
  expedite?: boolean | null;
};

export type DeliveryShapeResolution =
  | { kind: "declared"; key: DeliveryShapeKey; ref: string }
  | { kind: "derived"; key: DeliveryShapeKey; ref: string; reasonCode: string; reason: string; signals: DeliveryShapeSignals }
  | { kind: "invalid"; declared: string; message: string }
  | { kind: "ambiguous"; reasonCode: string; reason: string; signals: DeliveryShapeSignals };

export type DeliveryShapePick = {
  ref: string;
  key: DeliveryShapeKey;
  title: string;
  definition: string;
  appetite: string;
  owes: string;
};

const APPETITE: Record<DeliveryShapeKey, string> = {
  "delivery-break-fix": "hours; one PR; Workroom optional",
  "delivery-small": "up to two days; one PR; one Workroom",
  "delivery-medium": "up to one week; one to three PRs; one Workroom",
  "delivery-large": "up to three weeks; one Workroom, may spawn children",
  "delivery-xlarge": "multi-week; an epic with two or more shaped children",
};

const OWES: Record<DeliveryShapeKey, string> = {
  "delivery-break-fix": "reproduction on a named ref; PR gate; post-implementation review receipt within 48h; WIP 1 per installation",
  "delivery-small": "failing-to-passing proof; PR gate; merged SHA on main; runtime check",
  "delivery-medium": "design note and acceptance criteria in the item body; PR gate; independent acceptance receipt on the live install",
  "delivery-large": "canonical spec with research; independent spec approval; plan with coverage; architecture review; deploy; acceptance against the baseline",
  "delivery-xlarge": "hypothesis and appetite; approved decomposition into shaped children; outcome reconciliation; never enters implementation itself",
};

/** The structured pick list a `work_shape_required` refusal carries. */
export const DELIVERY_SHAPE_PICK_LIST: readonly DeliveryShapePick[] = DELIVERY_SHAPE_KEYS.map((key) => ({
  ref: `${key}@${DELIVERY_SHAPE_VERSION}`,
  key,
  title: DELIVERY_SHAPES[key].title,
  definition: DELIVERY_SHAPES[key].description.split(". ")[0] + ".",
  appetite: APPETITE[key],
  owes: OWES[key],
}));

const SIZE_TO_SHAPE: Record<string, DeliveryShapeKey> = {
  small: "delivery-small",
  medium: "delivery-medium",
  large: "delivery-large",
  xlarge: "delivery-xlarge",
};

const RANK: Record<DeliveryShapeKey, number> = {
  "delivery-break-fix": 0,
  "delivery-small": 1,
  "delivery-medium": 2,
  "delivery-large": 3,
  "delivery-xlarge": 4,
};

function raiseTo(shape: DeliveryShapeKey, floor: DeliveryShapeKey): DeliveryShapeKey {
  return RANK[shape] >= RANK[floor] ? shape : floor;
}

/**
 * Derive the shape from the item's own signals, or null when the rules do not
 * agree. Each mapping is justified against design §3.4.
 */
export function deriveDeliveryShape(
  signals: DeliveryShapeSignals | null | undefined,
): { key: DeliveryShapeKey; reasonCode: string; reason: string } | null {
  if (!signals) return null;
  const size = signals.effortSize && SIZE_TO_SHAPE[signals.effortSize] ? SIZE_TO_SHAPE[signals.effortSize]! : null;
  const workType = signals.workType ?? null;

  let base: { key: DeliveryShapeKey; reasonCode: string; reason: string } | null = null;
  if (workType === "bug") {
    // Rule 1: a bug is small; break-fix only when the expedite lane is declared.
    if (signals.expedite === true) {
      base = { key: "delivery-break-fix", reasonCode: "derived_bug_expedited", reason: "A bug with the expedite lane declared is a break-fix." };
    } else if (size && size !== "delivery-small") {
      // Rule 1 says small, rule 3 says the recorded size: they disagree, so nothing is derived.
      return null;
    } else {
      base = { key: "delivery-small", reasonCode: "derived_bug_small", reason: "A bug without the expedite lane is a small fix." };
    }
  } else if (workType === "doc" || workType === "chore") {
    // Rule 2: doc and chore are small unless effortSize says otherwise.
    base = size
      ? { key: size, reasonCode: "derived_effort_size", reason: `effortSize ${signals.effortSize} sets the shape.` }
      : { key: "delivery-small", reasonCode: "derived_doc_chore_small", reason: `A ${workType} item without a recorded size is small.` };
  } else if (size) {
    // Rule 3: effortSize drives everything else.
    base = { key: size, reasonCode: "derived_effort_size", reason: `effortSize ${signals.effortSize} sets the shape.` };
  } else {
    return null;
  }

  // Rule 4: adding substrate is at least large.
  if (signals.addsSubstrate === true && RANK[base.key] < RANK["delivery-large"]) {
    return { key: "delivery-large", reasonCode: "derived_adds_substrate", reason: "The work adds substrate, which is at least large." };
  }
  return { ...base, key: raiseTo(base.key, base.key) };
}

/** Resolve a declared or derived shape for a claim; never guesses. */
export function resolveDeliveryShape(args: {
  declared?: unknown;
  signals: DeliveryShapeSignals | null | undefined;
}): DeliveryShapeResolution {
  if (args.declared != null && args.declared !== "") {
    const declared = String(args.declared).trim();
    const ref = parseWorkShapeRef(declared);
    if (!ref || !isDeliveryShapeKey(ref.key) || ref.version !== DELIVERY_SHAPE_VERSION) {
      return {
        kind: "invalid",
        declared,
        message: `workShape must be one of: ${DELIVERY_SHAPE_REFS.join(", ")}.`,
      };
    }
    return { kind: "declared", key: ref.key, ref: `${ref.key}@${ref.version}` };
  }
  const derived = deriveDeliveryShape(args.signals);
  const signals = args.signals ?? {};
  if (!derived) {
    return {
      kind: "ambiguous",
      reasonCode: "shape_not_derivable",
      reason: "The item's signals do not agree on one shape. Put the pick list to the owner and re-claim with workShape.",
      signals,
    };
  }
  return { ...derived, kind: "derived", ref: `${derived.key}@${DELIVERY_SHAPE_VERSION}`, signals };
}

export type DeliveryShapeClaimEntry = {
  workShape: string;
  recordedAt: string;
  source: "declared" | "derived";
  reasonCode?: string;
  signals?: DeliveryShapeSignals;
};

/** The scopeClaims entry a resolved shape persists as; `readWorkShapeClaim` reads it unchanged. */
export function buildDeliveryShapeClaim(
  resolution: Extract<DeliveryShapeResolution, { kind: "declared" | "derived" }>,
  now: Date = new Date(),
): DeliveryShapeClaimEntry {
  return resolution.kind === "declared"
    ? { workShape: resolution.ref, recordedAt: now.toISOString(), source: "declared" }
    : { workShape: resolution.ref, recordedAt: now.toISOString(), source: "derived", reasonCode: resolution.reasonCode, signals: resolution.signals };
}
