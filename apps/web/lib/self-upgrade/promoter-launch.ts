import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { lockCanonicalRuntimeAdmission } from "@/lib/platform-runtime/work-admission";
import { runProcessWithBudget, type BudgetedProcessOptions } from "@/lib/shared/run-process-with-budget";
import { isRecord } from "@/lib/shared/coerce";
import type { PromoterParams, PromoterResult } from "./promoter";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";
import { resolvePromoterTimeoutMs } from "./promoter-timeout";

export type PromoterLaunchOwner = { kind: "self-upgrade"; runId: string }
  | { kind: "runtime-capability"; transitionId: string };

export type GuardedPromoterPorts = {
  run(args: string[], options: BudgetedProcessOptions): Promise<PromoterResult>;
  underAdmission<T>(work: () => Promise<T>): Promise<T>;
};

const containerId = /^[a-f0-9]{64}$/;
const bindingLabel = "dpf.promoter-binding";
const ownerLabel = "dpf.promoter-owner";
const projectLabel = "dpf.promoter-project";
const absent = /^Error: No such (?:object|container)(?::|\s*$)/m;
const pending = (): PromoterResult => ({
  exitCode: PROMOTER_ALREADY_RUNNING_EXIT_CODE,
  stdout: "",
  stderr: "The authorized promoter launch is awaiting exact container or admission confirmation.",
});

/** Only the checked admission owner can submit an exact-ID start. Once the
 * daemon acknowledges start, the existing active-row and canonical actor
 * observations fence subsequent requests while its work runs. */
export async function launchCheckedPromoter(input: { name: string; binding: string; ownerKey?: string; project?: string; argv: string[]; timeoutMs: number },
  ports: GuardedPromoterPorts): Promise<PromoterResult> {
  const { name, binding, ownerKey, project, argv, timeoutMs } = input;
  const nameIndex = argv.indexOf("--name");
  if (!/^dpf-promoter-[A-Za-z0-9-]{1,110}$/.test(name) || !containerId.test(binding)
    || argv[0] !== "run" || argv[1] !== "--rm" || nameIndex < 2 || argv[nameIndex + 1] !== name) return pending();
  const deadline = Date.now() + timeoutMs;
  const read = async (target: string) => ports.run(["inspect", "--type", "container", "--format",
    `{"id":{{json .Id}},"binding":{{json (index .Config.Labels "${bindingLabel}")}},"owner":{{json (index .Config.Labels "${ownerLabel}")}},"project":{{json (index .Config.Labels "${projectLabel}")}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}}}`, target],
  { timeoutMs: 3_000, maxStdoutBytes: 8192 });
  let id: string | null;
  try {
    id = await ports.underAdmission(async () => {
      const inspected = await read(name);
      let ownedId: string;
      if (inspected.exitCode === 0) {
        const actual: unknown = JSON.parse(inspected.stdout);
        if (!isRecord(actual) || typeof actual.id !== "string" || !containerId.test(actual.id)
          || actual.binding !== binding || (ownerKey && actual.owner !== ownerKey) || (project && actual.project !== project)
          || typeof actual.startedAt !== "string") return null;
        ownedId = actual.id;
        if (actual.startedAt !== "0001-01-01T00:00:00Z") return Date.parse(actual.startedAt) > 0 ? ownedId : null;
      } else {
        if (!absent.test(inspected.stderr)) return null;
        const labels = ["--label", `${bindingLabel}=${binding}`];
        if (ownerKey) labels.push("--label", `${ownerLabel}=${ownerKey}`);
        if (project) labels.push("--label", `${projectLabel}=${project}`);
        const created = await ports.run(["create", ...labels, ...argv.slice(2)],
          { timeoutMs: 5_000, maxStdoutBytes: 1024 });
        ownedId = created.stdout.trim();
        if (created.exitCode !== 0 || !containerId.test(ownedId)) return null;
      }
      const started = await ports.run(["start", ownedId], { timeoutMs: 5_000, maxStdoutBytes: 1024 });
      return started.exitCode === 0 ? ownedId : null;
    });
  } catch { return pending(); }
  if (!id) return pending();

  let stopVerified = false;
  const removeContainer = async (ownedId: string) => {
    if (ownedId !== id) return;
    try {
      await ports.run(["stop", "--time", "3", ownedId], { timeoutMs: 5_000, maxStdoutBytes: 1024 });
      const inspected = await read(ownedId);
      const observed: unknown = inspected.exitCode === 0 ? JSON.parse(inspected.stdout) : null;
      stopVerified = isRecord(observed) && observed.id === ownedId && observed.binding === binding && observed.running === false;
    } catch { /* Retain the active owner until an exact result is known. */ }
  };
  try {
    const waited = await ports.run(["wait", id], { timeoutMs: Math.max(1, deadline - Date.now()),
      maxStdoutBytes: 1024, containerName: id, removeContainer });
    if (waited.exitCode !== 0) return stopVerified
      ? { ...waited, stderr: "[promoter-timeout] The owned promoter stopped after exceeding its time budget." }
      : pending();
    const code = waited.stdout.trim();
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(code) || Number(code) > 255) return pending();
    const logs = await ports.run(["logs", id], { timeoutMs: 5_000, maxStdoutBytes: 8 * 1024 * 1024 });
    if (logs.exitCode !== 0) return pending();
    return { ...logs, exitCode: Number(code) };
  } catch { return pending(); }
}

const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const hash = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;

export async function runAdmittedPromoter(
  params: PromoterParams, owner: PromoterLaunchOwner, reference: string,
  build: (params: PromoterParams) => Promise<{ args: string[] }>,
): Promise<PromoterResult> {
  if (!imageId.test(reference)) {
    const inspected = await runProcessWithBudget("docker", ["image", "inspect", "--format", "{{.Id}}", reference], {
      timeoutMs: 5_000, maxStdoutBytes: 1024,
    }).catch(() => null);
    if (inspected?.exitCode !== 0 || !imageId.test(inspected.stdout.trim())) {
      return { ...pending(), exitCode: owner.kind === "runtime-capability" ? 75 : PROMOTER_ALREADY_RUNNING_EXIT_CODE };
    }
    reference = inspected.stdout.trim();
  }
  const pinned = { ...params, promoterImage: reference };
  return launchDurablePromoter(pinned, (await build(pinned)).args, owner);
}

/** The action identity selects its existing row. A request cannot supply a
 * different runtime envelope or restart an already terminal action. */
export async function launchDurablePromoter(params: PromoterParams, argv: string[], owner: PromoterLaunchOwner): Promise<PromoterResult> {
  const runtime = owner.kind === "runtime-capability";
  const name = params.containerName ?? "";
  const project = params.composeProject || "dpf";
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) return { ...pending(), exitCode: runtime ? 75 : PROMOTER_ALREADY_RUNNING_EXIT_CODE };
  const binding = digest({ owner, project, target: params.targetSha, image: params.promoterImage ?? "",
    action: params.runtimeCapabilityTransitionId ?? "", signature: params.runtimeCapabilitySignature ?? "",
    recoveryPoint: params.maintenanceRecoveryPointDigest ?? "" });
  const ownerKey = owner.kind === "self-upgrade" ? owner.runId : owner.transitionId;
  const result = await launchCheckedPromoter({ name, binding, ownerKey, project, argv, timeoutMs: resolvePromoterTimeoutMs(params) }, {
    run: (args, options) => runProcessWithBudget("docker", args, options),
    underAdmission: async work => {
      const { prisma } = await import("@dpf/db");
      return prisma.$transaction(async tx => {
        await lockCanonicalRuntimeAdmission(tx as unknown as Parameters<typeof lockCanonicalRuntimeAdmission>[0]);
        if (owner.kind === "self-upgrade") {
          if (!/^SUR-[A-Za-z0-9-]{1,100}$/.test(owner.runId) || name !== `dpf-promoter-${owner.runId}`
            || params.installStateMigrationRunId !== owner.runId || !params.maintenanceRecoveryPointDigest) throw new Error("promoter_admission_held");
          await tx.$queryRaw`SELECT id FROM "SelfUpgradeRun" WHERE "runId" = ${owner.runId} FOR UPDATE`;
          const run = await tx.selfUpgradeRun.findUnique({ where: { runId: owner.runId },
            select: { status: true, targetSha: true, completionEvidence: true } });
          const evidence = isRecord(run?.completionEvidence) ? run.completionEvidence : null;
          if (run?.status !== "running" || run.targetSha !== params.targetSha || !evidence?.recoveryPoint
            || digest(evidence.recoveryPoint) !== params.maintenanceRecoveryPointDigest) throw new Error("promoter_admission_held");
        } else {
          const actionId = params.runtimeCapabilityTransitionId;
          if (!actionId || name !== `dpf-promoter-${actionId}` || !params.runtimeCapabilityEnvelope
            || !hash.test(params.runtimeCapabilitySignature ?? "")) throw new Error("promoter_admission_held");
          const row = await tx.runtimeCapabilityTransition.findUnique({ where: { transitionId: owner.transitionId },
            select: { status: true, envelope: true, envelopeSignature: true, failure: true } });
          const compensation = isRecord(row?.failure) && isRecord(row.failure.compensation) ? row.failure.compensation : null;
          const action = row && ["pending", "applying"].includes(row.status) && actionId === owner.transitionId
            ? row : row?.status === "compensating" && actionId !== owner.transitionId ? compensation : null;
          const envelope = isRecord(action?.envelope) ? action.envelope : null;
          if (!envelope || envelope.transitionId !== actionId || typeof envelope.expiresAt !== "string"
            || !(Date.parse(envelope.expiresAt) > Date.now()) || action?.envelopeSignature !== params.runtimeCapabilitySignature
            || canonicalJson(envelope) !== canonicalJson(JSON.parse(Buffer.from(params.runtimeCapabilityEnvelope, "base64url").toString("utf8")))) {
            throw new Error("promoter_admission_held");
          }
        }
        return work();
      }, { timeout: 20_000 });
    },
  });
  return runtime && result.exitCode === PROMOTER_ALREADY_RUNNING_EXIT_CODE ? { ...result, exitCode: 75 } : result;
}
