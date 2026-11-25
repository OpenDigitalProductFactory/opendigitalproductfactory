// The candidate promoter stage of a self-upgrade run, through the private
// actuator (BI-224F56F1, kernel decision DI-B3171A8F09DC).
//
// A source-mode upgrade builds its candidate promoter image from the upgrade
// workspace. In the qualified portal neither the portal nor the actuator can
// read that workspace, so the actuator launches the build as an admitted
// stage: a short-lived container from the installed promoter image, pinned to
// its local image ID, with the workspace mounted read-only and the promoter's
// Docker socket. It runs /promoter/promoter-candidate-build.mjs and
// nothing else. The actuator then resolves and validates the built image
// itself and returns only the verified artifact.
//
// Admission re-reads the run: it must be running, and the requested target
// must be the stamp the run expects to deploy. Paths and images come from the
// install's own configuration, never from the request.

import type { SelfUpgradeConfig } from "./config";
import type { PromoterInstallBinding } from "./promoter-actuator";
import type { ResolvedPromoterArtifact } from "./promoter-artifact";
import { isRecord } from "@/lib/shared/coerce";

export type CandidateRequest = { owner: { kind: "self-upgrade"; runId: string }; input: { targetSha: string } };
type ProcessResult = { exitCode: number; stdout: string; stderr: string };

const DEFAULT_PROMOTER_IMAGE = "dpf-promoter";
const RUN_ID = /^SUR-[A-Za-z0-9-]{1,100}$/;
const SHA = /^[a-f0-9]{40}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const refuse = (): never => { throw new Error("promoter_candidate_admission_refused"); };
const trimSlash = (path: string) => path.replace(/[\\/]$/, "");

/** One fixed recipe: the workspace read-only, the socket, nothing else. */
export function buildCandidateArgs(launch: { name: string; runId: string; project: string; workspaceHostPath: string;
  builderImageId: string; targetSha: string }): string[] {
  return ["run", "--rm", "--name", launch.name,
    "--label", `dpf.promoter-candidate-owner=${launch.runId}`, "--label", `dpf.promoter-project=${launch.project}`,
    "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=1g",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "4g", "--pids-limit", "1024",
    "-e", "HOME=/tmp", "-e", `DPF_CANDIDATE_INPUT=${JSON.stringify({ targetSha: launch.targetSha })}`,
    "-v", `${launch.workspaceHostPath}:/workspace:ro`,
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "--entrypoint", "node", launch.builderImageId, "/promoter/promoter-candidate-build.mjs"];
}

/** Actuator side. A refused request never reaches Docker. */
export function createCandidateLauncher(deps: {
  binding: PromoterInstallBinding;
  readConfig: () => Promise<SelfUpgradeConfig>;
  readRun: (runId: string) => Promise<{ status: string; deployedSha: string | null } | null>;
  inspectImageId: (reference: string) => Promise<string | null>;
  run: (args: string[], options: { timeoutMs: number; maxStdoutBytes: number; containerName: string }) => Promise<ProcessResult>;
  resolve: (params: { promoterImage: string; targetSha: string }) => Promise<ResolvedPromoterArtifact>;
}) {
  return async (value: unknown): Promise<ResolvedPromoterArtifact> => {
    if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner) || !isRecord(value.input)) return refuse();
    const { owner, input } = value;
    if (Object.keys(owner).length !== 2 || owner.kind !== "self-upgrade" || typeof owner.runId !== "string" || !RUN_ID.test(owner.runId)
      || Object.keys(input).length !== 1 || typeof input.targetSha !== "string" || !SHA.test(input.targetSha)) return refuse();
    const runId = owner.runId, targetSha = input.targetSha;
    const run = await deps.readRun(runId);
    if (run?.status !== "running" || run.deployedSha !== targetSha) return refuse();

    const config = await deps.readConfig();
    if (config.sourceMode !== "upstream" && config.sourceMode !== "local") return refuse();
    const configured = config.promoterImage?.trim() || DEFAULT_PROMOTER_IMAGE;
    // A custom or registry promoter is the operator's image: resolve it, never build.
    if (configured !== DEFAULT_PROMOTER_IMAGE) return deps.resolve({ promoterImage: configured, targetSha });

    const canonical = trimSlash(config.hostInstallPath ?? deps.binding.installPath);
    const workspaceHostPath = config.useIsolatedWorkspace
      ? config.upgradeWorkspaceHostPath ?? `${canonical}/.upgrade-workspace` : canonical;
    // Only the install checkout or its default workspace is ever mounted.
    if (workspaceHostPath !== `${canonical}/.upgrade-workspace` && workspaceHostPath !== canonical) return refuse();
    const builderImageId = await deps.inspectImageId(DEFAULT_PROMOTER_IMAGE);
    if (!builderImageId || !IMAGE_ID.test(builderImageId)) throw new Error("promoter_candidate_builder_missing");

    const name = `dpf-promoter-${runId}-candidate`;
    const result = await deps.run(buildCandidateArgs({ name, runId, project: deps.binding.project, workspaceHostPath, builderImageId, targetSha }),
      { timeoutMs: 35 * 60_000, maxStdoutBytes: 64 * 1024, containerName: name });
    let built: unknown;
    try { built = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? ""); } catch { built = null; }
    if (!isRecord(built) || built.ok !== true || built.image !== `${DEFAULT_PROMOTER_IMAGE}:${targetSha}`
      || typeof built.imageId !== "string" || !IMAGE_ID.test(built.imageId)) {
      const reason = isRecord(built) && typeof built.reason === "string" ? built.reason : "result-invalid";
      throw new Error(`promoter_candidate_build_failed: ${reason}`);
    }
    // Resolve and validate the embedded contract here; the portal receives only the verified artifact.
    const artifact = await deps.resolve({ promoterImage: built.image, targetSha });
    if (artifact.digest !== built.imageId) throw new Error("promoter_candidate_identity_mismatch");
    return artifact;
  };
}

type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

/** Portal side. Null keeps the local build (no actuator mounted). A lost or
 * malformed reply is an error: preflight fails the run, never builds locally. */
export async function candidateThroughPrivateActuator(request: { runId: string; targetSha: string },
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<ResolvedPromoterArtifact | null> {
  const observation = await import("../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  const body: CandidateRequest = { owner: { kind: "self-upgrade", runId: request.runId }, input: { targetSha: request.targetSha } };
  const result = await (send ?? ((value, ms) => observation.buildActuatorPromoterCandidate(value, { timeoutMs: ms })))(body, 36 * 60_000);
  if (!isRecord(result) || typeof result.digest !== "string" || !IMAGE_ID.test(result.digest) || result.sourceSha !== request.targetSha) {
    throw new Error("promoter_candidate_unconfirmed");
  }
  return result as unknown as ResolvedPromoterArtifact;
}
