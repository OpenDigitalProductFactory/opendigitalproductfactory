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
  if (result.outputLimitExceeded) refuseReassessmentCompatibility();
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

/** A mount-free packaged component probe, never a workflow or retirement proof. */
export async function readReassessmentImageContract(configDigest: string, expectedSourceSha?: string,
  runDocker: ReassessmentContractPorts["runDocker"] = defaultRunDocker): Promise<ReassessmentRuntimeCompatibility> {
  try {
    if (currentReassessmentExecution() || !/^sha256:[a-f0-9]{64}$/.test(configDigest)) refuseReassessmentCompatibility();
    const args = ["run", "--rm", "--read-only", "--name", `dpf-reassessment-probe-${randomUUID()}`, "--network", "none",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "1", "--pids-limit", "64",
      "--pull", "never", "--entrypoint", "node", configDigest, "/app/scripts/reassessment-capability-probe.mjs"];
    const result = await runDocker(args);
    if (result.exitCode !== 0 || Buffer.byteLength(result.stdout) > 8192) refuseReassessmentCompatibility();
    const info = validateReassessmentCapabilityInfo(JSON.parse(result.stdout));
    if (expectedSourceSha !== undefined && info.sourceSha !== expectedSourceSha) refuseReassessmentCompatibility();
    return validateReassessmentRuntimeCompatibility({ ...info, configDigest });
  } catch { return refuseReassessmentCompatibility(); }
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
  } catch { return refuseReassessmentCompatibility(); }
}

/** No I/O or cache repair in Q/E or transaction callbacks. A new process must
 * establish its own packaged proof before entering qualification. */
export function assertCurrentReassessmentContract(sealed: unknown): void {
  const expected = validateReassessmentRuntimeCompatibility(sealed);
  if (!retained || !brands.has(retained.proof) || retained.pid !== process.pid || retained.hostname !== hostname()
    || expected.configDigest !== retained.proof.configDigest || !sameInfo(expected, retained.proof)) refuseReassessmentCompatibility();
}
