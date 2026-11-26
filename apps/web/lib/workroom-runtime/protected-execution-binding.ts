import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

import { executionHostIdentity, executionHostRef, readExecutionHostObservation, type ExecutionHostRoute } from "@/lib/agent-toolchain/execution-host-registry";
import { isRecord } from "@/lib/shared/coerce";

const hostSchema = executionHostIdentity.extend({ registrationRef: executionHostRef });
const commitId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const worktreeSchema = z.strictObject({
  worktreeRef: executionHostRef,
  repositoryFullName: z.string().max(192).regex(/^[\w.-]+\/[\w.-]+$/),
  sourceCommit: commitId,
  sourceTree: commitId,
});
const targetSchema = z.strictObject({
  installationRef: executionHostRef,
  roomRef: executionHostRef,
  sessionRef: executionHostRef,
  stageAttemptRef: executionHostRef,
  originRef: executionHostRef,
  worktree: worktreeSchema,
});
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const routesSchema = z.custom<ExecutionHostRoute[]>(value => readExecutionHostObservation(value) !== null);
const bindingSchema = targetSchema.extend({
  registrationRef: executionHostRef,
  hostRef: executionHostRef,
  receiverRef: executionHostRef,
  qualificationRef: executionHostRef,
  qualificationEpoch: revisionSchema,
  routes: routesSchema,
});
const launchSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("queued") }),
  z.strictObject({ phase: z.literal("possibly-started"), projectionDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export const protectedObservationCursor = z.strictObject({ storeEpoch: executionHostRef,
  sequence: z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/), ref: executionHostRef });
const usageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observed"), ref: executionHostRef }), z.strictObject({ kind: z.literal("unknown") }),
]);
export const protectedObservation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("nonterminal"), state: z.enum(["accepted", "resumable"]), receiptRef: executionHostRef,
    cursor: protectedObservationCursor.optional(), usage: usageSchema }),
  z.strictObject({ kind: z.literal("final-matching"), state: z.enum(["succeeded", "failed", "interrupted", "not-started", "capacity-hold"]),
    receiptRef: executionHostRef, usage: usageSchema }),
]);
const storedBindingSchema = bindingSchema.extend({ launch: launchSchema, observation: protectedObservation.optional() })
  .refine(value => !value.observation || value.launch.phase === "possibly-started");
const qualificationSchema = hostSchema.extend({
  qualificationRef: executionHostRef,
  revision: revisionSchema,
  status: z.enum(["active", "revoked"]),
  worktreeRef: executionHostRef,
  expiresAt: z.number().int().positive(),
  allowedRoutes: routesSchema,
});
const candidateSchema = hostSchema.extend({ routes: routesSchema });
const ownerSchema = z.strictObject({ host: hostSchema, worktree: worktreeSchema });

const MAX_BINDINGS = 64;
const attemptKey = (value: ProtectedExecutionTarget) => JSON.stringify([value.sessionRef, value.stageAttemptRef]);
const storedSchema = z.strictObject({ version: z.literal(1), bindings: z.array(storedBindingSchema).max(MAX_BINDINGS) })
  .refine(value => new Set(value.bindings.map(attemptKey)).size === value.bindings.length);

export type RegisteredExecutionHost = z.infer<typeof hostSchema>;
export type ProtectedExecutionTarget = z.infer<typeof targetSchema>;
export type ProtectedExecutionBinding = z.infer<typeof bindingSchema>;
export type StoredProtectedExecutionBinding = z.infer<typeof storedBindingSchema>;
export type ObservationCursor = z.infer<typeof protectedObservationCursor>;
export type ProtectedObservation = z.infer<typeof protectedObservation>;
export type ProtectedExecutionBindings = z.infer<typeof storedSchema>;
export type ExecutionHostQualification = z.infer<typeof qualificationSchema>;
export type ExecutionHostCandidate = z.infer<typeof candidateSchema>;
export type ExecutionWorktreeOwner = z.infer<typeof ownerSchema>;

export function readProtectedExecutionTarget(value: unknown): ProtectedExecutionTarget | null {
  const result = targetSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function protectedBindingIdentity({ launch: _state, observation: _observation, ...binding }: StoredProtectedExecutionBinding): ProtectedExecutionBinding {
  return binding;
}

export function findProtectedExecutionBinding(record: ProtectedExecutionBindings, target: Pick<ProtectedExecutionTarget, "sessionRef" | "stageAttemptRef">) {
  return record.bindings.find(entry => entry.sessionRef === target.sessionRef && entry.stageAttemptRef === target.stageAttemptRef) ?? null;
}

export type ProtectedBindingInput = {
  localInstallationRef: string;
  target: ProtectedExecutionTarget;
  now: Date;
  workspaceState: unknown;
  /** Resolved exact-source ownership, not an owner named by the request. Two matches are enough to hold. */
  owners: readonly ExecutionWorktreeOwner[];
  candidate: ExecutionHostCandidate | null;
  /** The current exact issuer-owned record; host observation cannot supply this value. */
  qualification: ExecutionHostQualification | null;
};

const sameHost = (a: RegisteredExecutionHost, b: RegisteredExecutionHost) => a.registrationRef === b.registrationRef &&
  a.installationRef === b.installationRef && a.hostRef === b.hostRef && a.receiverRef === b.receiverRef;
const sameWorktree = (a: ProtectedExecutionTarget["worktree"], b: ProtectedExecutionTarget["worktree"]) =>
  a.worktreeRef === b.worktreeRef && a.repositoryFullName === b.repositoryFullName &&
  a.sourceCommit === b.sourceCommit && a.sourceTree === b.sourceTree;

/** No implicit conversion between a protected binding and local runtimeSession. */
export function readProtectedExecutionBindings(workspaceState: unknown): ProtectedExecutionBindings | null {
  if (workspaceState != null && !isRecord(workspaceState)) return null;
  const stored = workspaceState?.["protectedExecution"];
  if (stored === undefined) return { version: 1, bindings: [] };
  const parsed = storedSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export type ProtectedBindingDecision =
  | { ok: true; created: boolean; binding: ProtectedExecutionBinding; record: ProtectedExecutionBindings }
  | { ok: false; reason: "invalid-binding" | "ambiguous-owner" | "unverified-owner" | "unqualified-host" |
    "no-qualified-route" | "binding-conflict" | "binding-limit" };

/** Decide from current, transaction-local Workroom and trusted registry/issuer facts. No effects run here. */
export function decideProtectedExecutionBinding(input: ProtectedBindingInput): ProtectedBindingDecision {
  const parsedTarget = targetSchema.safeParse(input.target);
  const record = readProtectedExecutionBindings(input.workspaceState);
  const now = input.now.getTime();
  if (!parsedTarget.success || !record || !Number.isFinite(now) || parsedTarget.data.installationRef !== input.localInstallationRef) {
    return { ok: false, reason: "invalid-binding" };
  }
  const target = parsedTarget.data;
  if (input.owners.length > 1) return { ok: false, reason: "ambiguous-owner" };
  const owner = ownerSchema.safeParse(input.owners[0]);
  const candidate = candidateSchema.safeParse(input.candidate);
  if (!owner.success || !candidate.success || owner.data.host.installationRef !== target.installationRef ||
    !sameHost(owner.data.host, candidate.data) || !sameWorktree(owner.data.worktree, target.worktree)) {
    return { ok: false, reason: "unverified-owner" };
  }
  const qualification = qualificationSchema.safeParse(input.qualification);
  if (!qualification.success || !sameHost(owner.data.host, qualification.data) || qualification.data.status !== "active" ||
    qualification.data.expiresAt <= now || qualification.data.worktreeRef !== target.worktree.worktreeRef) {
    return { ok: false, reason: "unqualified-host" };
  }
  const observedRoutes = readExecutionHostObservation(candidate.data.routes) ?? [];
  const routes = observedRoutes.filter(observed => qualification.data.allowedRoutes.some(allowed =>
    observed.kind === allowed.kind && observed.endpointRef === allowed.endpointRef));
  if (routes.length === 0) return { ok: false, reason: "no-qualified-route" };
  const binding: ProtectedExecutionBinding = {
    ...target, ...owner.data.host, qualificationRef: qualification.data.qualificationRef,
    qualificationEpoch: qualification.data.revision, routes,
  };
  const existing = findProtectedExecutionBinding(record, target);
  if (existing) return canonicalJson(protectedBindingIdentity(existing)) === canonicalJson(binding)
    ? { ok: true, created: false, binding, record }
    : { ok: false, reason: "binding-conflict" };
  if (record.bindings.length >= MAX_BINDINGS) return { ok: false, reason: "binding-limit" };
  return { ok: true, created: true, binding, record: { version: 1, bindings: [...record.bindings, { ...binding, launch: { phase: "queued" } }] } };
}
