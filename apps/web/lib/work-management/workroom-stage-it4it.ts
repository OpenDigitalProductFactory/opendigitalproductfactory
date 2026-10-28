/**
 * Where a work-shape stage sits on the IT4IT value streams (BI-B8B3FB70,
 * EP-MBSE-WORKROOM-SPINE Edge 1).
 *
 * The reference is The Open Group IT4IT Reference Architecture 3.0.1, seeded as
 * EaReferenceModel `it4it_v3_0_1`. Each value is a stage's `participationReference`
 * (for example "5.3.4"), which is what Edge 2 joins on. IT4IT 2.x's single
 * Requirement-to-Deploy stream is split in 3.0.1 into Integrate (5.3.x) and
 * Deploy (5.4.x); delivery work spans both.
 *
 * Kept beside the shapes rather than on WorkShapeStage: the GPP shape compiler
 * round-trips stage definitions, and the notation spec lets a stage name its
 * IT4IT reference without a format change. Keyed by shape key, not version: a
 * new version of a delivery shape does not move its stages across the stream.
 * A stage missing here has no binding, and the room resolves no stage rather
 * than a guessed one.
 */
export const IT4IT_REFERENCE_MODEL_SLUG = "it4it_v3_0_1";

const DESIGN_DEVELOP = "5.3.3";
const BUILD_INTEGRATE_TEST = "5.3.4";
const ACCEPT_PUBLISH_RELEASE = "5.3.5";
const FULFILL_DEPLOYMENT = "5.4.3";
const VALIDATE_DEPLOYMENT = "5.4.4";

export const WORK_SHAPE_STAGE_IT4IT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "delivery-break-fix": {
    reproduce: DESIGN_DEVELOP,
    repair: BUILD_INTEGRATE_TEST,
    merge: ACCEPT_PUBLISH_RELEASE,
    "post-implementation-review": VALIDATE_DEPLOYMENT,
  },
  "delivery-small": {
    reproduce: DESIGN_DEVELOP,
    repair: BUILD_INTEGRATE_TEST,
    merge: ACCEPT_PUBLISH_RELEASE,
    "runtime-check": VALIDATE_DEPLOYMENT,
  },
  "delivery-medium": {
    "design-note": DESIGN_DEVELOP,
    implement: BUILD_INTEGRATE_TEST,
    merge: ACCEPT_PUBLISH_RELEASE,
    accept: VALIDATE_DEPLOYMENT,
  },
  "delivery-large": {
    spec: DESIGN_DEVELOP,
    "spec-approval": DESIGN_DEVELOP,
    plan: DESIGN_DEVELOP,
    implement: BUILD_INTEGRATE_TEST,
    merge: ACCEPT_PUBLISH_RELEASE,
    deploy: FULFILL_DEPLOYMENT,
    accept: VALIDATE_DEPLOYMENT,
  },
};

/** The IT4IT participationReference a shape's stage sits at, or null when it has none. */
export function it4itStageRefFor(shapeRef: string | null, stageKey: string | null): string | null {
  if (!shapeRef || !stageKey) return null;
  const shapeKey = shapeRef.split("@")[0]!;
  return WORK_SHAPE_STAGE_IT4IT[shapeKey]?.[stageKey] ?? null;
}
