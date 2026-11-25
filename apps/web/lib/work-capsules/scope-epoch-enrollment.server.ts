// Shared by the portal and packaged Node commands; Node APIs enforce its runtime boundary.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { attachMaintenanceEpochEvidence } from "@/lib/self-upgrade/maintenance-epoch-evidence";
import { lockCanonicalRuntimeAdmission } from "@/lib/platform-runtime/work-admission";
import { readSuccessfulMaintenanceRecoveryPoint } from "@/lib/self-upgrade/recovery-eligibility";
import { verifyMaintenanceEpoch, readAttestedMaintenanceRetirement, observeMaintenanceEnvironments, assertNoCanonicalActuators, hasContinuousMaintenanceStarts } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
import { hasPrivateActuatorMount, readScopeWriterObservation, readScopeWriterRetirement } from "../../../../scripts/lib/scope-writer-observation.mjs";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { SCOPE_EPOCH_WRITER_PATHS, validateScopeEpochWriterContract, type ScopeEpochWriterContract } from "./scope-epoch-contract";
import type { CapsuleDb } from "./work-capsule-store-types";

type WriterProbe = typeof import("./scope-epoch-writer-probe.mjs");
type Run = { runId: string; status: string; targetSha: string | null; deployedSha: string | null;
  startedAt: Date | null; completionEvidence: unknown };
export type ScopeEpochEnrollmentPorts = {
  readFile: (path: string) => Promise<Buffer | string>;
  runDocker: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  attachRetirement: typeof attachMaintenanceEpochEvidence;
  readRun: (runId: string) => Promise<Run | null>;
  now: () => Date;
  attestProcess?: WriterProbe["attestScopeWriterProcess"];
  inspectServed?: WriterProbe["inspectServedScopeWriter"];
  readClosing?: () => Promise<unknown>;
  readAttested?: () => Promise<unknown>;
};
export type ScopeEpochEnrollmentProof = { assertCurrent(tx: CapsuleDb): Promise<void> };
const prepared = new WeakMap<object, ScopeEpochEnrollmentProof>();
/** Bound only by a server-owned receipt preparation callback, never a parameter. */
export function retainPreparedScopeEpochEnrollment(tx: object, proof: ScopeEpochEnrollmentProof): void { prepared.set(tx, proof); }
export function preparedScopeEpochEnrollment(tx: object): ScopeEpochEnrollmentProof | undefined { return prepared.get(tx); }
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const governedUpgrade = "The live install needs an owner-authorized governed self-upgrade (request_self_upgrade) whose completion evidence carries maintenance-epoch retirement for the running source.";
const reportProbe = "Probe error: report this reason to the installation operator.";
const recovery = {
  "current-container-identity-unproven": "Report the container identity probe failure to the installation operator.",
  "current-portal-unproven": "Report that the probe could not bind the executing process to the running portal.",
  "packaged-writer-mismatch": "Report the packaged writer mismatch to the installation operator before retrying.",
  "final-retirement-unavailable": governedUpgrade,
  "retirement-attachment-raced": "Retry the claim to read the retirement evidence after the concurrent update.",
  "matching-canonical-run-unproven": governedUpgrade,
  "retirement-order-unproven": governedUpgrade,
  "current-cohort-unproven": governedUpgrade,
  "docker-observation-unavailable": "Report the Docker observation failure to the installation operator.",
  "canonical-actuator-present": "If a governed self-upgrade is active, wait for it to finish and retry. Otherwise report the remaining actuator to the installation operator.",
  "observation-budget-expired": "Retry the claim once, then report the Docker observation timeout if it persists.",
  "observation-oversized": "Report the Docker observation output limit to the installation operator.",
  "packaged-proof-oversized": "Report the packaged writer proof output limit to the installation operator.",
  "canonical-transition-active": "Wait for the governed transition to finish, then retry the claim.",
  "process-proof-unproven": "Retry the claim to prepare a fresh process-bound proof.",
  "transaction-admission-unavailable": "Report the unavailable transaction admission to the installation operator.",
} as const;
type ProbeStep = "read-process-cgroup" | "read-process-mounts" | "identify-container" | "inspect-portal" | "parse-portal-inspect"
  | "read-image-version" | "read-source-content-hash" | "read-writer-contract" | "read-writer-source"
  | "validate-local-writer-contract" | "run-packaged-writer" | "parse-packaged-writer" | "validate-packaged-writer-contract"
  | "attach-retirement" | "read-retirement-receipt" | "parse-retirement-receipt" | "read-upgrade-run"
  | "read-transition-secret" | "verify-maintenance-retirement" | "observe-canonical-actuators" | "observe-current-cohort"
  | "assemble-enrollment-proof";
const safeProbeCodes = ["ENOENT", "EACCES", "EPERM", "EIO", "ENOTDIR", "EISDIR", "ETIMEDOUT", "ECONNREFUSED"] as const;
const safeProbeMarkers = ["scope-writer-compatibility-unproven", "maintenance_epoch_evidence_invalid",
  "runtime_transition_secret_too_short", "runtime_transition_payload_tampered", "maintenance_epoch_observation_unavailable"] as const;
type ProbeCode = (typeof safeProbeCodes)[number] | (typeof safeProbeMarkers)[number] | "SyntaxError" | "TypeError" | "Error" | "unknown";
type EnrollmentReason = { kind: keyof typeof recovery } | { kind: "canonical-writer-evidence-unavailable"; step: ProbeStep; code: ProbeCode };

class ScopeEpochEnrollmentError extends Error {
  constructor(readonly reason: EnrollmentReason, next: string) {
    const detail = "step" in reason ? `${reason.kind}:${reason.step}:${reason.code}` : reason.kind;
    super(`scope-epoch-enrollment-held:${detail}. ${next}`);
  }
}
export function scopeEpochEnrollmentRefusal(error: unknown): ToolResult | null {
  return error instanceof ScopeEpochEnrollmentError ? {
    success: false, error: "scope_claim_precondition_failed", message: error.message, data: { reason: error.reason },
  } : null;
}
function refuse(kind: keyof typeof recovery): never {
  throw new ScopeEpochEnrollmentError({ kind }, recovery[kind]);
}
function probeCode(error: unknown): ProbeCode {
  // Never copy unknown error names, codes, messages, paths, stacks or causes.
  try {
    if (error instanceof Error) {
      const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
      const message = Object.getOwnPropertyDescriptor(error, "message")?.value;
      return safeProbeCodes.find(known => known === code) ?? safeProbeMarkers.find(known => known === message)
        ?? (error instanceof SyntaxError ? "SyntaxError" : error instanceof TypeError ? "TypeError" : "Error");
    }
  } catch { /* Error-like inputs can themselves throw on introspection. */ }
  return "unknown";
}
function refuseProbe(step: ProbeStep, error: unknown): never {
  if (error instanceof ScopeEpochEnrollmentError) throw error;
  const code = probeCode(error);
  if (step === "observe-canonical-actuators" && code === "maintenance_epoch_observation_unavailable") refuse("canonical-actuator-present");
  throw new ScopeEpochEnrollmentError({ kind: "canonical-writer-evidence-unavailable", step, code }, reportProbe);
}
async function probe<T>(step: ProbeStep, run: () => T | Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { return refuseProbe(step, error); }
}
const record = (value: unknown) => isRecord(value) ? value : null;
const brands = new WeakSet<object>();
const currentInspect = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"hostname":{{json .Config.Hostname}},"labels":{{json .Config.Labels}}}';
let installedWriter: ReturnType<WriterProbe["inspectServedScopeWriter"]> | undefined;

// Cache the emitted bytes only after proving the loader namespace for the
// lifetime of this process. A failed initial qualification can be retried.
function inspectInstalledWriter() {
  installedWriter ??= import("./scope-epoch-writer-probe.mjs").then(async probe => {
    await probe.attestScopeWriterProcess();
    return probe.inspectServedScopeWriter();
  }).catch(error => {
    installedWriter = undefined;
    throw error;
  });
  return installedWriter;
}

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

async function authenticatedRetirement(ports: ScopeEpochEnrollmentPorts, sourceSha: string, attested?: Record<string, unknown>) {
  const imported = await probe("attach-retirement", () => ports.attachRetirement({ onProbeFailure: refuseProbe,
    ...(attested ? { readAttested: async () => attested } : {}) }));
  if (imported.status === "raced") refuse("retirement-attachment-raced");
  if (imported.status !== "attached" && imported.status !== "replayed") refuse("final-retirement-unavailable");
  const run = await probe("read-upgrade-run", () => ports.readRun(imported.runId));
  const evidence = record(run?.completionEvidence), readiness = record(evidence?.readiness);
  const recovery = run ? readSuccessfulMaintenanceRecoveryPoint(evidence?.recoveryPoint, run.runId) : null;
  if (!run || run.status !== "succeeded" || run.targetSha !== sourceSha || run.deployedSha !== sourceSha || !run.startedAt
    || !recovery
    || readiness?.result !== "ready" || readiness.mode !== "enforced" || readiness.targetSha !== sourceSha || typeof readiness.imageDigest !== "string") refuse("matching-canonical-run-unproven");
  const envelope = evidence!.maintenanceEpochRetirement;
  const expected = { runId: run.runId, targetSha: sourceSha, promoterDigest: readiness.imageDigest,
    recoveryPointDigest: hash(canonicalJson(recovery)), now: ports.now().getTime() };
  const retirementDigest = hash(canonicalJson(envelope));
  if (attested && attested.retirementDigest !== retirementDigest) refuse("final-retirement-unavailable");
  // The qualified portal verifies the actuator's attestation; the legacy recipe reads the host secret itself.
  const secret = attested ? "" : (await probe("read-transition-secret", () => ports.readFile("/dpf-state/runtime-transition.secret"))).toString().trim();
  const retired = await probe("verify-maintenance-retirement", () => attested
    ? readAttestedMaintenanceRetirement(attested, expected) : verifyMaintenanceEpoch(envelope, secret, expected));
  if (Date.parse(recovery.createdAt) > Date.parse(retired.capturedAt) || run.startedAt.getTime() > Date.parse(retired.capturedAt)) refuse("retirement-order-unproven");
  return { retired, retirementDigest };
}

function createEnrollmentProof(close?: () => Promise<void>): ScopeEpochEnrollmentProof {
  const pid = process.pid, processHostname = hostname();
  const checks = new WeakMap<CapsuleDb, Promise<void>>();
  const proof: ScopeEpochEnrollmentProof = { async assertCurrent(tx) {
    if (!brands.has(proof) || pid !== process.pid || processHostname !== hostname()) refuse("process-proof-unproven");
    let checked = checks.get(tx);
    if (!checked) {
      checked = lockScopeEpochEnrollmentAdmission(tx).then(close);
      checks.set(tx, checked);
    }
    return checked;
  } };
  Object.freeze(proof); brands.add(proof);
  return proof;
}

async function prepareHardenedEnrollment(ports: ScopeEpochEnrollmentPorts, containerId: string) {
  const observedBundle = ports.attestProcess && ports.inspectServed
    ? ports.attestProcess().then(() => ports.inspectServed!()) : inspectInstalledWriter();
  const [bundle, version, attested] = await Promise.all([observedBundle, ports.readFile("/app/.dpf-image-version"),
    (ports.readAttested ?? readScopeWriterRetirement)().then(record)]);
  const source = version.toString().trim();
  if (!attested) refuse("final-retirement-unavailable");
  const { retired, retirementDigest } = await authenticatedRetirement(ports, source, attested);
  if (retired.after.portal.id !== containerId) refuse("current-portal-unproven");
  return createEnrollmentProof(async () => {
    try {
      const current = record(await (ports.readClosing ?? readScopeWriterObservation)());
      const launch = record(current?.launch), served = record(current?.served);
      const cohort = record(current?.cohort), portal = record(cohort?.portal);
      const now = ports.now().getTime();
      if (!current || current.runId !== retired.runId || current.sourceSha !== source
        || current.retirementDigest !== retirementDigest || current.project !== retired.project
        || current.daemonId !== retired.daemonId || typeof current.observedAt !== "number"
        || !Number.isSafeInteger(current.observedAt) || now - current.observedAt < 0 || now - current.observedAt > 2_500
        || !launch || launch.id !== containerId || launch.startedAt !== portal?.startedAt
        || typeof launch.image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(launch.image)
        || typeof launch.recipeDigest !== "string" || !/^[a-f0-9]{64}$/.test(launch.recipeDigest)
        || canonicalJson(served) !== canonicalJson({ image: launch.image, ...bundle })
        || !hasContinuousMaintenanceStarts(retired.after, current.cohort, current.observedAt)) refuse("current-cohort-unproven");
    } catch { refuse("current-cohort-unproven"); }
  });
}

/** Prepare identity before the claim locks and close the hardened observation
 * inside the same transaction that will publish the epoch. */
export async function assertScopeEpochEnrollmentReady(ports: ScopeEpochEnrollmentPorts = defaults()): Promise<ScopeEpochEnrollmentProof> {
  const docker = async (args: string[]) => {
    const result = await ports.runDocker(args);
    if (result.exitCode !== 0) refuse("docker-observation-unavailable");
    return result.stdout;
  };
  try {
    const read = (step: ProbeStep, file: string) => probe(step, () => ports.readFile(file));
    const [cgroup, mounts] = await Promise.all([
      read("read-process-cgroup", "/proc/self/cgroup"), read("read-process-mounts", "/proc/self/mountinfo"),
    ]);
    const containerId = await probe("identify-container", () => currentScopeWriterContainerId(cgroup.toString(), mounts.toString()));
    if (hasPrivateActuatorMount(mounts)) {
      return await prepareHardenedEnrollment(ports, containerId);
    }
    const inspect = async () => {
      const output = await probe("inspect-portal", () => docker(["inspect", "--type", "container", "--format", currentInspect, containerId]));
      const value = record(await probe("parse-portal-inspect", () => JSON.parse(output)));
      const labels = record(value?.labels);
      if (!value || value.id !== containerId || value.running !== true || value.hostname !== hostname()
        || typeof value.image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.image)
        || labels?.["com.docker.compose.service"] !== "portal" || typeof labels["com.docker.compose.project"] !== "string") refuse("current-portal-unproven");
      return { image: value.image, project: labels["com.docker.compose.project"] as string };
    };
    const current = await inspect();
    const path = (name: string) => `/app/${name.replace(/^apps\/web\//, "apps/web-src/")}`;
    const [version, content, contract, ...writers] = await Promise.all([
      read("read-image-version", "/app/.dpf-image-version"), read("read-source-content-hash", "/app/.dpf-source-content-hash"),
      read("read-writer-contract", path("apps/web/lib/work-capsules/scope-epoch-contract.ts")),
      ...SCOPE_EPOCH_WRITER_PATHS.map(name => read("read-writer-source", path(name))),
    ]);
    const local = await probe("validate-local-writer-contract", () => validateScopeEpochWriterContract({ schemaVersion: 1, version: 1,
      sourceSha: version.toString().trim(), sourceContentHash: content.toString().trim(), contractSha256: hash(contract),
      writers: Object.fromEntries(SCOPE_EPOCH_WRITER_PATHS.map((name, index) => [name, hash(writers[index]!)])) }));
    const output = await probe("run-packaged-writer", () => docker(["run", "--rm", "--read-only", "--name", `dpf-scope-writer-probe-${randomUUID()}`,
      "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "1",
      "--pids-limit", "64", "--pull", "never", "--entrypoint", "node", current.image, "/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs"]));
    if (Buffer.byteLength(output) > 8192) refuse("packaged-proof-oversized");
    const packaged = await probe("parse-packaged-writer", () => JSON.parse(output));
    const observed: ScopeEpochWriterContract = await probe("validate-packaged-writer-contract", () => validateScopeEpochWriterContract(packaged));
    if (canonicalJson(local) !== canonicalJson(observed)) refuse("packaged-writer-mismatch");

    const { retired } = await authenticatedRetirement(ports, local.sourceSha);
    await probe("observe-canonical-actuators", () => assertNoCanonicalActuators({ runDocker: docker }));
    const cohort = await probe("observe-current-cohort", () => observeMaintenanceEnvironments({ project: current.project, runDocker: docker }));
    if (retired.project !== current.project || retired.daemonId !== cohort.daemonId || cohort.activeProjectPromoter
      || retired.after.portal.id !== containerId || canonicalJson(retired.after) !== canonicalJson(cohort.environments)
      || retired.retiredContainerIds.some((id: string) => cohort.inventory.includes(id))
      || canonicalJson(await inspect()) !== canonicalJson(current)) refuse("current-cohort-unproven");
    return createEnrollmentProof();
  } catch (error) {
    return refuseProbe("assemble-enrollment-proof", error);
  }
}


/** Existing durable admission protocol, reused by the qualified scope writer. */
export async function lockScopeEpochEnrollmentAdmission(tx: CapsuleDb): Promise<void> {
  const admission = tx as unknown as Partial<Parameters<typeof lockCanonicalRuntimeAdmission>[0]> & {
    selfUpgradeRun?: { findFirst(args: unknown): Promise<unknown> };
    runtimeCapabilityTransition?: { findFirst(args: unknown): Promise<unknown> };
  };
  if (!admission.$executeRaw || !admission.$queryRaw || !admission.selfUpgradeRun?.findFirst
    || !admission.runtimeCapabilityTransition?.findFirst) refuse("transaction-admission-unavailable");
  // Share the producer's table-before-advisory order to avoid inversion with
  // transition settlement. The Workroom row is still taken afterwards.
  await lockCanonicalRuntimeAdmission(admission as Parameters<typeof lockCanonicalRuntimeAdmission>[0]);
  if (await admission.runtimeCapabilityTransition.findFirst({ where: { OR: [{ status: { in: ["pending", "applying", "host_applied", "compensating"] } }, { status: "rollback_failed", failure: { path: ["recoveryRequired"], equals: true } }] }, select: { id: true } })
    || await admission.selfUpgradeRun.findFirst({ where: { status: { in: ["pending", "queued", "running", "completing"] } }, select: { id: true } })) refuse("canonical-transition-active");
  // A terminal history row is not a global revision. Continuing actuator
  // and actual portal compatibility floors, not a history heuristic, exclude
  // later unaware writers. Active/recovery admissions remain serialized.
}
