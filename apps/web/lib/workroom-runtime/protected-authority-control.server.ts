import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

import { executionHostRef } from "@/lib/agent-toolchain/execution-host-registry";
import { enqueueOwnedPostgresJob, type OwnedJobEvent, type TransactionalJobDb } from "@/lib/jobs/transactional-enqueue.server";
import type { ProtectedExecutionBinding } from "./protected-execution-binding";

export type ProtectedAuthorityKey = { sourceInstallationRef: string; receiverHostRef: string;
  authorityKind: "qualification-epoch" | "subject-binding"; authorityScopeRef: string };
export type ProtectedFloorRequest = { version: 1; revocationId: string; key: ProtectedAuthorityKey; minimumAcceptedRevision: number };
export type AffectedProtectedAttempt = { sessionRef: string; stageAttemptRef: string; attemptRef: string };
export type ProtectedFloorAck = { version: 1; revocationId: string; key: ProtectedAuthorityKey; appliedFloor: number;
  commitRef: string; affected: AffectedProtectedAttempt[] };
// Local semantic adapter, not DPF2's wire shape. The N1 fixture owns paging syntax and digest encoding.
export type ProtectedFloorPage = Omit<ProtectedFloorAck, "affected"> & {
  after: string | null; next: string | null; count: number; digest: string; affected: AffectedProtectedAttempt[];
};
export type ProtectedFloorReceiptPort = {
  readPage(after: string | null, commitRef: string | null): Promise<ProtectedFloorPage | null>;
  isCurrentCommitRef(commitRef: string): Promise<boolean>;
  verifyDigest(affected: AffectedProtectedAttempt[], digest: string): boolean;
};

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const keySchema = z.strictObject({ sourceInstallationRef: executionHostRef, receiverHostRef: executionHostRef,
  authorityKind: z.enum(["qualification-epoch", "subject-binding"]), authorityScopeRef: executionHostRef });
const floorRequest = z.strictObject({ version: z.literal(1), revocationId: executionHostRef, key: keySchema, minimumAcceptedRevision: revision });
const opaque = z.string().min(1).max(512).regex(/^[^\x00-\x20\x7f]+$/);
const affectedAttempt = z.strictObject({ sessionRef: executionHostRef, stageAttemptRef: executionHostRef, attemptRef: executionHostRef });
const MAX_AFFECTED = 16_384;
const MAX_PAGES = 128;
const pageSchema = z.strictObject({ version: z.literal(1), revocationId: executionHostRef, key: keySchema,
  appliedFloor: revision, commitRef: opaque, after: opaque.nullable(), next: opaque.nullable(),
  count: z.number().int().min(0).max(MAX_AFFECTED), digest: opaque, affected: z.array(affectedAttempt).max(MAX_AFFECTED) });

/** Confirm only complete, matching receiver-fence proof. Return null for unknown; never an attempt result. */
export async function readCompleteProtectedFloorAck(request: ProtectedFloorRequest, port: ProtectedFloorReceiptPort): Promise<ProtectedFloorAck | null> {
  const expected = floorRequest.safeParse(request);
  if (!expected.success) return null;
  let after: string | null = null;
  let snapshot: Pick<ProtectedFloorPage, "appliedFloor" | "commitRef" | "count" | "digest"> | null = null;
  const affected: AffectedProtectedAttempt[] = [];
  const handles = new Set<string>();
  const cursors = new Set<string>();
  try {
    for (let index = 0; index < MAX_PAGES; index++) {
      const parsed: ReturnType<typeof pageSchema.safeParse> = pageSchema.safeParse(await port.readPage(after, snapshot?.commitRef ?? null));
      if (!parsed.success) return null;
      const page = parsed.data;
      if (page.revocationId !== expected.data.revocationId || canonicalJson(page.key) !== canonicalJson(expected.data.key) ||
        page.appliedFloor < expected.data.minimumAcceptedRevision || page.after !== after) return null;
      if (!snapshot) snapshot = page;
      if (page.commitRef !== snapshot.commitRef || page.appliedFloor !== snapshot.appliedFloor ||
        page.count !== snapshot.count || page.digest !== snapshot.digest || affected.length + page.affected.length > snapshot.count) return null;
      for (const attempt of page.affected) {
        const exact = JSON.stringify([attempt.sessionRef, attempt.stageAttemptRef]);
        if (handles.has(exact)) return null;
        handles.add(exact);
        affected.push(attempt);
      }
      if (page.next === null) {
        if (affected.length !== snapshot.count || !port.verifyDigest(affected, snapshot.digest) || !await port.isCurrentCommitRef(snapshot.commitRef)) return null;
        return { version: 1, revocationId: expected.data.revocationId, key: expected.data.key, appliedFloor: snapshot.appliedFloor,
          commitRef: snapshot.commitRef, affected };
      }
      if (cursors.has(page.next) || affected.length >= snapshot.count || page.affected.length === 0) return null;
      cursors.add(page.next);
      after = page.next;
    }
  } catch { return null; }
  return null;
}

export const HOST_AUTHORITY_FLOOR_JOB = "protected-authority-floor";
export const HOST_AUTHORITY_FLOOR_EVENT = "protected/authority.revoked";
type DurableSourceFence = { status: "revoked"; previousEpoch: number; request: ProtectedFloorRequest };

function matchesSourceFence(fence: DurableSourceFence | null, request: ProtectedFloorRequest): boolean {
  return !!fence && fence.status === "revoked" && revision.safeParse(fence.previousEpoch).success &&
    fence.previousEpoch < request.minimumAcceptedRevision && canonicalJson(fence.request) === canonicalJson(request);
}

/** Called by the qualification owner after fencing, using the same database transaction. No room is needed. */
export async function queueFencedHostRevocation(tx: TransactionalJobDb, input: {
  request: ProtectedFloorRequest;
  readDurableFence: (tx: TransactionalJobDb) => Promise<DurableSourceFence | null>;
  enqueue?: (tx: TransactionalJobDb, event: OwnedJobEvent) => Promise<"inserted" | "replay">;
}): Promise<"inserted" | "replay"> {
  const request = floorRequest.safeParse(input.request);
  if (!request.success || request.data.key.authorityKind !== "qualification-epoch") throw new Error("source-fence-unavailable");
  const fence = await input.readDurableFence(tx);
  if (!matchesSourceFence(fence, request.data)) throw new Error("source-fence-unavailable");
  // Changed key, version or floor for the same issuer revocation ID conflicts at the durable carrier.
  const id = createHash("sha256").update(canonicalJson([request.data.key.sourceInstallationRef, request.data.revocationId])).digest("hex");
  const event = { id: `protected-floor:${id}`, name: HOST_AUTHORITY_FLOOR_EVENT, data: request.data };
  return input.enqueue ? input.enqueue(tx, event) : enqueueOwnedPostgresJob(tx, { functionId: HOST_AUTHORITY_FLOOR_JOB, event, now: new Date() });
}

/** Consumer for the qualification-scoped durable job. No acknowledgement, including an empty one, is an outcome. */
export async function deliverFencedHostRevocation(event: unknown, deps: {
  readPendingFence(request: ProtectedFloorRequest): Promise<DurableSourceFence | null>;
  // Opens only the current authenticated control route for this pinned receiver. First readPage sends the exact revoke or replays it.
  openAuthenticatedReceipt(request: ProtectedFloorRequest): Promise<ProtectedFloorReceiptPort | null>;
  // Compare-and-set on the issuer's exact pending revocation. The ACK makes no statement about remote stop/outcome.
  persistVerifiedAck(ack: ProtectedFloorAck): Promise<boolean>;
}): Promise<"source-fence-unavailable" | "receiver-fence-unknown" | "receiver-fenced"> {
  const request = floorRequest.safeParse(event);
  if (!request.success || request.data.key.authorityKind !== "qualification-epoch") return "source-fence-unavailable";
  try {
    if (!matchesSourceFence(await deps.readPendingFence(request.data), request.data)) return "source-fence-unavailable";
    const port = await deps.openAuthenticatedReceipt(request.data);
    if (!port) return "receiver-fence-unknown";
    const ack = await readCompleteProtectedFloorAck(request.data, port);
    return ack && await deps.persistVerifiedAck(ack) ? "receiver-fenced" : "receiver-fence-unknown";
  } catch { return "receiver-fence-unknown"; }
}

type ReceiverIdentity = Pick<ProtectedExecutionBinding, "installationRef" | "hostRef" | "receiverRef" | "registrationRef">;

/** A source-side authority resolver, called afresh behind the authenticated receiver route. This is not a lease or a bearer credential. */
export async function readLiveProtectedHostAuthority(input: { binding: ProtectedExecutionBinding; authenticatedReceiver: ReceiverIdentity }, deps: {
  // Must re-resolve the current owning records and the full exact admission. An issued projection is not authority.
  readCurrent(binding: ProtectedExecutionBinding): Promise<{ binding: ProtectedExecutionBinding; expiresAt: number } | null>;
  now?: () => number;
}): Promise<{ key: ProtectedAuthorityKey; revision: number; expiresAt: number } | null> {
  const { binding, authenticatedReceiver: receiver } = input;
  if (!receiver || receiver.installationRef !== binding.installationRef || receiver.hostRef !== binding.hostRef ||
    receiver.receiverRef !== binding.receiverRef || receiver.registrationRef !== binding.registrationRef ||
    !revision.safeParse(binding.qualificationEpoch).success) return null;
  try {
    const current = await deps.readCurrent(binding);
    const at = (deps.now ?? Date.now)();
    if (!current || !Number.isFinite(at) || !Number.isSafeInteger(current.expiresAt) || current.expiresAt <= at ||
      canonicalJson(current.binding) !== canonicalJson(binding)) return null;
    return { key: { sourceInstallationRef: binding.installationRef, receiverHostRef: binding.hostRef,
      authorityKind: "qualification-epoch", authorityScopeRef: binding.qualificationRef },
    revision: binding.qualificationEpoch, expiresAt: current.expiresAt };
  } catch { return null; }
}
