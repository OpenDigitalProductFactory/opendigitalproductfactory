// The candidate reassessment proof of a self-upgrade run, through the private
// actuator (BI-224F56F1).
//
// Preflight proves that the candidate portal image carries the reassessment
// owners it claims, by starting the image's fixed probe with no network,
// mounts or capabilities. In the qualified portal that probe runs in the
// actuator. Admission re-reads the run: it must be running and the requested
// target must be the stamp it expects to deploy. The image is the install's
// own built portal (source) or the fresh verified release whose source commit
// is that target (release); the request names neither.

import type { VerifiedReleaseIdentity } from "./promoter";
import type { VerifiedReleaseTargetEvidence } from "@/lib/release-health/state";
import { validateReassessmentRuntimeCompatibility, type ReassessmentRuntimeCompatibility } from "@/lib/shared/reassessment-owner-versions";
import { isRecord } from "@/lib/shared/coerce";

const RUN_ID = /^SUR-[A-Za-z0-9-]{1,100}$/;
const SHA = /^[a-f0-9]{40}$/;
const refuse = (): never => { throw new Error("reassessment_candidate_admission_refused"); };

/** Actuator side. A refused request never reaches Docker. */
export function createReassessmentCandidateProver(deps: {
  project: string;
  readRun: (runId: string) => Promise<{ status: string; deployedSha: string | null } | null>;
  readVerifiedRelease: () => Promise<VerifiedReleaseTargetEvidence | null>;
  prove: (input: { targetSha: string; composeProject: string; release?: VerifiedReleaseIdentity }) => Promise<ReassessmentRuntimeCompatibility>;
}) {
  return async (value: unknown): Promise<ReassessmentRuntimeCompatibility> => {
    if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner) || !isRecord(value.input)) return refuse();
    const { owner, input } = value;
    if (Object.keys(owner).length !== 2 || owner.kind !== "self-upgrade" || typeof owner.runId !== "string" || !RUN_ID.test(owner.runId)
      || Object.keys(input).length !== 2 || typeof input.targetSha !== "string" || !SHA.test(input.targetSha)
      || typeof input.release !== "boolean") return refuse();
    const run = await deps.readRun(owner.runId);
    if (run?.status !== "running" || run.deployedSha !== input.targetSha) return refuse();
    if (!input.release) return deps.prove({ targetSha: input.targetSha, composeProject: deps.project });
    const evidence = await deps.readVerifiedRelease();
    if (!evidence || evidence.candidate.sourceSha !== input.targetSha) return refuse();
    const { tag, channelDigest, platformManifestDigest, configDigest, platformOs, platformArchitecture } = evidence.candidate;
    return deps.prove({ targetSha: input.targetSha, composeProject: deps.project, release: {
      tag, ghcrOwner: evidence.ghcrOwner.toLowerCase(), channelDigest, platformManifestDigest, configDigest, platformOs, platformArchitecture } });
  };
}

type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

/** Portal side. Null keeps the local proof (no actuator mounted). A lost reply
 * or a malformed proof is a refusal; the portal never probes locally then. */
export async function reassessmentThroughPrivateActuator(request: { runId: string; targetSha: string; release: boolean },
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<ReassessmentRuntimeCompatibility | null> {
  const observation = await import("@/lib/platform-runtime/actuator-client");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  const { refuseReassessmentWithDetail } = await import("@/lib/mcp-task-reassessment-contract");
  let result: unknown;
  try {
    result = await (send ?? ((body, ms) => observation.proveActuatorReassessmentCandidate(body, { timeoutMs: ms })))(
      { owner: { kind: "self-upgrade", runId: request.runId }, input: { targetSha: request.targetSha, release: request.release } }, 3 * 60_000);
  } catch {
    return refuseReassessmentWithDetail("actuator-proof-unavailable");
  }
  try {
    const proof = validateReassessmentRuntimeCompatibility(result);
    if (proof.sourceSha !== request.targetSha) return refuseReassessmentWithDetail("actuator-proof-target-mismatch");
    return proof;
  } catch {
    return refuseReassessmentWithDetail("actuator-proof-invalid");
  }
}
