// Shared by the portal and packaged Node commands; Node APIs enforce its runtime boundary.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { attachMaintenanceEpochEvidence } from "@/lib/self-upgrade/maintenance-epoch-evidence";
import { verifyMaintenanceEpoch, observeMaintenanceEnvironments, assertNoCanonicalActuators } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
import { SCOPE_EPOCH_WRITER_PATHS, validateScopeEpochWriterContract, type ScopeEpochWriterContract } from "./scope-epoch-contract";
import type { CapsuleDb } from "./work-capsule-store-types";

type Run = { runId: string; status: string; targetSha: string | null; deployedSha: string | null;
  startedAt: Date | null; completionEvidence: unknown };
export type ScopeEpochEnrollmentPorts = {
  readFile: (path: string) => Promise<Buffer | string>;
  runDocker: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  attachRetirement: typeof attachMaintenanceEpochEvidence;
  readRun: (runId: string) => Promise<Run | null>;
  now: () => Date;
};
export type ScopeEpochEnrollmentProof = { assertCurrent(tx: CapsuleDb): Promise<void> };
const prepared = new WeakMap<object, ScopeEpochEnrollmentProof>();
/** Bound only by a server-owned receipt preparation callback, never a parameter. */
export function retainPreparedScopeEpochEnrollment(tx: object, proof: ScopeEpochEnrollmentProof): void { prepared.set(tx, proof); }
export function preparedScopeEpochEnrollment(tx: object): ScopeEpochEnrollmentProof | undefined { return prepared.get(tx); }
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function refuse(detail: string): never { throw new Error(`scope-epoch-enrollment-held:${detail}`); }
const record = (value: unknown) => isRecord(value) ? value : null;
const brands = new WeakSet<object>();
const currentInspect = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"hostname":{{json .Config.Hostname}},"labels":{{json .Config.Labels}}}';

/** Full kernel-provided container identity, never an arbitrary hostname prefix. */
export function currentScopeWriterContainerId(cgroup: string, mounts: string): string {
  const ids = new Set<string>();
  for (const match of cgroup.matchAll(/(?:\/docker\/|docker-)([a-f0-9]{64})(?:\.scope)?(?:\s|\/|$)/g)) ids.add(match[1]!);
  for (const match of mounts.matchAll(/\/containers\/([a-f0-9]{64})\/(?:hostname|hosts|resolv\.conf)(?:\s|$)/g)) ids.add(match[1]!);
  if (ids.size !== 1) refuse("current-container-identity-unproven");
  return [...ids][0]!;
}

function defaults(): ScopeEpochEnrollmentPorts {
  const deadline = Date.now() + 60_000;
  return { readFile, now: () => new Date(), attachRetirement: attachMaintenanceEpochEvidence,
    readRun: runId => prisma.selfUpgradeRun.findUnique({ where: { runId }, select: {
      runId: true, status: true, targetSha: true, deployedSha: true, startedAt: true, completionEvidence: true } }),
    runDocker: async args => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) refuse("observation-budget-expired");
      const index = args.indexOf("--name");
      const result = await runProcessWithBudget("docker", args, { timeoutMs: Math.min(remaining, args[0] === "run" ? 60_000 : 5_000),
        maxStdoutBytes: 2 * 1024 * 1024, ...(index >= 0 ? { containerName: args[index + 1] } : {}) });
      if (result.outputLimitExceeded) refuse("observation-oversized");
      return result;
    } };
}

/** Canonical identity/cohort qualification happens outside the scope transaction.
 * Its byte proof is independent of semantic, authority and retirement evidence. */
export async function assertScopeEpochEnrollmentReady(ports: ScopeEpochEnrollmentPorts = defaults()): Promise<ScopeEpochEnrollmentProof> {
  const docker = async (args: string[]) => {
    const result = await ports.runDocker(args);
    if (result.exitCode !== 0) refuse("docker-observation-unavailable");
    return result.stdout;
  };
  try {
    const [cgroup, mounts] = await Promise.all([ports.readFile("/proc/self/cgroup"), ports.readFile("/proc/self/mountinfo")]);
    const containerId = currentScopeWriterContainerId(cgroup.toString(), mounts.toString());
    const inspect = async () => {
      const value = record(JSON.parse(await docker(["inspect", "--type", "container", "--format", currentInspect, containerId])));
      const labels = record(value?.labels);
      if (!value || value.id !== containerId || value.running !== true || value.hostname !== hostname()
        || typeof value.image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.image)
        || labels?.["com.docker.compose.service"] !== "portal" || typeof labels["com.docker.compose.project"] !== "string") refuse("current-portal-unproven");
      return { image: value.image, project: labels["com.docker.compose.project"] as string };
    };
    const current = await inspect();
    const path = (name: string) => `/app/${name.replace(/^apps\/web\//, "apps/web-src/")}`;
    const [version, content, contract, ...writers] = await Promise.all([
      ports.readFile("/app/.dpf-image-version"), ports.readFile("/app/.dpf-source-content-hash"),
      ports.readFile(path("apps/web/lib/work-capsules/scope-epoch-contract.ts")),
      ...SCOPE_EPOCH_WRITER_PATHS.map(name => ports.readFile(path(name))),
    ]);
    const local = validateScopeEpochWriterContract({ schemaVersion: 1, version: 1,
      sourceSha: version.toString().trim(), sourceContentHash: content.toString().trim(), contractSha256: hash(contract),
      writers: Object.fromEntries(SCOPE_EPOCH_WRITER_PATHS.map((name, index) => [name, hash(writers[index]!)])) });
    const output = await docker(["run", "--rm", "--read-only", "--name", `dpf-scope-writer-probe-${randomUUID()}`,
      "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "1",
      "--pids-limit", "64", "--pull", "never", "--entrypoint", "node", current.image, "/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs"]);
    if (Buffer.byteLength(output) > 8192) refuse("packaged-proof-oversized");
    const observed: ScopeEpochWriterContract = validateScopeEpochWriterContract(JSON.parse(output));
    if (canonicalJson(local) !== canonicalJson(observed)) refuse("packaged-writer-mismatch");

    const imported = await ports.attachRetirement();
    if (imported.status !== "attached" && imported.status !== "replayed") refuse("final-retirement-unavailable");
    const run = await ports.readRun(imported.runId);
    const evidence = record(run?.completionEvidence), recovery = record(evidence?.recoveryPoint), readiness = record(evidence?.readiness);
    if (!run || run.status !== "succeeded" || run.targetSha !== local.sourceSha || run.deployedSha !== local.sourceSha || !run.startedAt
      || recovery?.schemaVersion !== 1 || recovery.status !== "ok" || recovery.trigger !== "pre-upgrade-recovery"
      || recovery.selfUpgradeRunId !== run.runId || typeof recovery.createdAt !== "string" || !Array.isArray(recovery.members)
      || !recovery.members.length || recovery.members.some(member => !isRecord(member) || member.target !== "postgres" || member.status !== "ok" || typeof member.runId !== "string" || !member.runId.trim())
      || readiness?.result !== "ready" || readiness.mode !== "enforced" || readiness.targetSha !== local.sourceSha || typeof readiness.imageDigest !== "string") refuse("matching-canonical-run-unproven");
    const secret = (await ports.readFile("/dpf-state/runtime-transition.secret")).toString().trim();
    const retired = verifyMaintenanceEpoch(evidence!.maintenanceEpochRetirement, secret, { runId: run.runId,
      targetSha: local.sourceSha, promoterDigest: readiness.imageDigest,
      recoveryPointDigest: hash(canonicalJson(recovery)), now: ports.now().getTime() });
    if (Date.parse(recovery.createdAt) > Date.parse(retired.capturedAt) || run.startedAt.getTime() > Date.parse(retired.capturedAt)) refuse("retirement-order-unproven");
    await assertNoCanonicalActuators({ runDocker: docker });
    const cohort = await observeMaintenanceEnvironments({ project: current.project, runDocker: docker });
    if (retired.project !== current.project || retired.daemonId !== cohort.daemonId
      || retired.after.portal.id !== containerId || canonicalJson(retired.after) !== canonicalJson(cohort.environments)
      || retired.retiredContainerIds.some((id: string) => cohort.inventory.includes(id))
      || canonicalJson(await inspect()) !== canonicalJson(current)) refuse("current-cohort-unproven");
    const pid = process.pid, processHostname = hostname();
    const proof: ScopeEpochEnrollmentProof = { async assertCurrent(tx) {
      if (!brands.has(proof) || pid !== process.pid || processHostname !== hostname()) refuse("process-proof-unproven");
      await lockScopeEpochEnrollmentAdmission(tx);
    } };
    Object.freeze(proof); brands.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("scope-epoch-enrollment-held:")) throw error;
    return refuse("canonical-writer-evidence-unavailable");
  }
}


/** Existing durable admission protocol, reused by the qualified scope writer. */
export async function lockScopeEpochEnrollmentAdmission(tx: CapsuleDb): Promise<void> {
  const admission = tx as unknown as {
    $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    selfUpgradeRun?: { findFirst(args: unknown): Promise<unknown> };
    runtimeCapabilityTransition?: { findFirst(args: unknown): Promise<unknown> };
  };
  if (!admission.$executeRaw || !admission.selfUpgradeRun?.findFirst || !admission.runtimeCapabilityTransition?.findFirst) refuse("transaction-admission-unavailable");
  // Existing admission keys, one order, no Docker or filesystem I/O here.
  await admission.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
  await admission.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('self-upgrade-admission'))`;
  if (await admission.runtimeCapabilityTransition.findFirst({ where: { OR: [{ status: { in: ["pending", "applying", "host_applied", "compensating"] } }, { status: "rollback_failed", failure: { path: ["recoveryRequired"], equals: true } }] }, select: { id: true } })
    || await admission.selfUpgradeRun.findFirst({ where: { status: { in: ["pending", "queued", "running"] } }, select: { id: true } })) refuse("canonical-transition-active");
  // A terminal history row is not a global revision. Continuing actuator
  // and actual portal compatibility floors, not a history heuristic, exclude
  // later unaware writers. Active/recovery admissions remain serialized.
}
