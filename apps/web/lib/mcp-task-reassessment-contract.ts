import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { readCurrentContainerConfigDigest } from "./self-upgrade/runtime-image-identity";
import { runProcessWithBudget } from "./shared/run-process-with-budget";
import { currentReassessmentExecution } from "./routing/reassessment-execution-scope";
import { REASSESSMENT_OWNERS, REASSESSMENT_OWNER_PATHS, REASSESSMENT_OWNER_VERSIONS,
  refuseReassessmentCompatibility, validateReassessmentCapabilityInfo, validateReassessmentRuntimeCompatibility,
  type ReassessmentCapabilityInfo, type ReassessmentRuntimeCompatibility } from "./shared/reassessment-owner-versions";
export type ReassessmentContractPorts = {
  readCurrentConfigDigest: () => Promise<string | null>;
  readFile: (path: string) => Promise<Buffer | string>;
  runDocker: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
};
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const brands = new WeakSet<object>();
let retained: { pid: number; hostname: string; proof: ReassessmentRuntimeCompatibility } | null = null;
const defaultRunDocker: ReassessmentContractPorts["runDocker"] = async args => {
  const nameIndex = args.indexOf("--name"), containerName = nameIndex < 0 ? undefined : args[nameIndex + 1];
  const result = await runProcessWithBudget("docker", args, { timeoutMs: 60_000, maxStdoutBytes: 8192, containerName });
  if (result.outputLimitExceeded) refuseReassessmentWithDetail("docker-output-oversized");
  return result;
};
const defaultPorts: ReassessmentContractPorts = {
  readCurrentConfigDigest: () => readCurrentContainerConfigDigest(defaultRunDocker), readFile, runDocker: defaultRunDocker,
};
function sameInfo(left: ReassessmentCapabilityInfo, right: ReassessmentCapabilityInfo): boolean {
  return left.sourceSha === right.sourceSha && left.sourceContentHash === right.sourceContentHash && left.contractSha256 === right.contractSha256
    && REASSESSMENT_OWNERS.every(owner => left.owners[owner].version === right.owners[owner].version
      && left.owners[owner].sourceSha256 === right.owners[owner].sourceSha256);
}

/** BI-578131A3: a refusal keeps its typed code but names its cause. SUR-F2A0D477
 * recorded only the bare code, and "No such image" from Docker was lost. */
export function refuseReassessmentWithDetail(detail: string): never {
  throw Object.assign(new Error("reassessment-compatibility-unproven"), { code: "reassessment-compatibility-unproven", detail: detail.slice(0, 600) });
}
export function reassessmentRefusalDetail(error: unknown): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error && error.message !== "reassessment-compatibility-unproven" ? `unexpected: ${error.message}` : "unspecified";
}
const outputTail = (text: string) => text.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400);
function parseProbeOutput(stdout: string): ReassessmentCapabilityInfo {
  try { return validateReassessmentCapabilityInfo(JSON.parse(stdout)); } catch { return refuseReassessmentWithDetail(`probe-output-invalid: ${outputTail(stdout)}`); }
}

/** A mount-free packaged component probe, never a workflow or retirement proof. */
export async function readReassessmentImageContract(configDigest: string, expectedSourceSha?: string,
  runDocker: ReassessmentContractPorts["runDocker"] = defaultRunDocker): Promise<ReassessmentRuntimeCompatibility> {
  try {
    if (currentReassessmentExecution()) refuseReassessmentWithDetail("inside-reassessment-execution");
    if (!/^sha256:[a-f0-9]{64}$/.test(configDigest)) refuseReassessmentWithDetail("image-reference-invalid");
    const args = ["run", "--rm", "--read-only", "--name", `dpf-reassessment-probe-${randomUUID()}`, "--network", "none",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "1", "--pids-limit", "64",
      "--pull", "never", "--entrypoint", "node", configDigest, "/app/scripts/reassessment-capability-probe.mjs"];
    const result = await runDocker(args);
    if (result.exitCode !== 0) refuseReassessmentWithDetail(`probe-exit-${result.exitCode} (${configDigest}): ${outputTail(result.stderr)}`);
    if (Buffer.byteLength(result.stdout) > 8192) refuseReassessmentWithDetail("probe-output-oversized");
    const info = parseProbeOutput(result.stdout);
    if (expectedSourceSha !== undefined && info.sourceSha !== expectedSourceSha) {
      refuseReassessmentWithDetail(`probe-source-mismatch: expected ${expectedSourceSha}, image reports ${info.sourceSha}`);
    }
    return validateReassessmentRuntimeCompatibility({ ...info, configDigest });
  } catch (error) { return refuseReassessmentWithDetail(reassessmentRefusalDetail(error)); }
}

/** PRE-Q only. A server-owned probe brands retained initial proof for this
 * process/image. Privileged mutation of its packaged bytes is the declared
 * trusted-administrator boundary, not fresh per-effect host attestation. */
export async function readCurrentReassessmentContract(ports: ReassessmentContractPorts = defaultPorts): Promise<ReassessmentRuntimeCompatibility> {
  retained = null;
  try {
    if (currentReassessmentExecution()) refuseReassessmentCompatibility();
    const configDigest = await ports.readCurrentConfigDigest();
    if (!configDigest) refuseReassessmentCompatibility();
    const [version, source, contract, ...ownerBytes] = await Promise.all([
      ports.readFile("/app/.dpf-image-version"), ports.readFile("/app/.dpf-source-content-hash"),
      ports.readFile("/app/apps/web-src/lib/shared/reassessment-owner-versions.ts"),
      ...REASSESSMENT_OWNERS.map(owner => ports.readFile(`/app/apps/web-src/lib/${REASSESSMENT_OWNER_PATHS[owner]}`)),
    ]);
    const expected = validateReassessmentCapabilityInfo({ schemaVersion: 1, sourceSha: version.toString().trim(),
      sourceContentHash: source.toString().trim(), contractSha256: digest(contract), owners: Object.fromEntries(REASSESSMENT_OWNERS.map((owner, index) =>
        [owner, { version: REASSESSMENT_OWNER_VERSIONS[owner], sourceSha256: digest(ownerBytes[index]!) }])) });
    const observed = await readReassessmentImageContract(configDigest, expected.sourceSha, ports.runDocker);
    if (!sameInfo(expected, observed) || await ports.readCurrentConfigDigest() !== configDigest) refuseReassessmentCompatibility();
    for (const owner of REASSESSMENT_OWNERS) Object.freeze(observed.owners[owner]);
    Object.freeze(observed.owners); Object.freeze(observed); brands.add(observed);
    retained = { pid: process.pid, hostname: hostname(), proof: observed };
    return observed;
  } catch (error) { return refuseReassessmentWithDetail(reassessmentRefusalDetail(error)); }
}

/** No I/O or cache repair in Q/E or transaction callbacks. A new process must
 * establish its own packaged proof before entering qualification. */
export function assertCurrentReassessmentContract(sealed: unknown): void {
  const expected = validateReassessmentRuntimeCompatibility(sealed);
  if (!retained || !brands.has(retained.proof) || retained.pid !== process.pid || retained.hostname !== hostname()
    || expected.configDigest !== retained.proof.configDigest || !sameInfo(expected, retained.proof)) refuseReassessmentCompatibility();
}
