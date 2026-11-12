// BI-F5D58F29 (spec 2026-10-27 §7.1): a question a supervised runtime holds
// for a room decision lives on a CoworkerActionEnvelope, not in process
// memory, so it survives a portal restart and stays decidable. The decision
// also reaches the person's inbox through the envelope's existing attention
// source. Approving there records the decision and runs nothing: the runtime
// call passes the next time the session asks it with the same fingerprint.

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { DURABLE_APPROVAL_LIFETIME_MS } from "@/lib/coworker/approval-lifetime";

import { providerClientAgentId, type SupervisionActor } from "./supervised-session";
import type { RuntimeDecision, RuntimeProvider, RuntimeRequest } from "./types";

export type HeldRuntimeRequest = RuntimeRequest & {
  /** Fingerprint of the call: an approved envelope with it lets the same call pass. */
  callKey: string;
  /** Claude's permission tool is asked again; a Codex request waits on its provider id. */
  answeredBy: "re-ask" | "provider";
};

export type HeldRequestRecord = { status: string; request: HeldRuntimeRequest };

export type SettleOutcome = "settled" | "already-decided" | "not-found";

export interface HeldRequestStore {
  hold(input: { capsuleId: string; provider: RuntimeProvider; providerThreadId: string | null; actor: SupervisionActor; request: HeldRuntimeRequest; reason: string }): Promise<void>;
  find(capsuleId: string, requestId: string): Promise<HeldRequestRecord | null>;
  listOpen(capsuleId: string): Promise<Array<Pick<RuntimeRequest, "requestId" | "kind" | "summary">>>;
  settle(input: { capsuleId: string; requestId: string; decision: RuntimeDecision; decidedBy: string; reason: string }): Promise<SettleOutcome>;
  isApproved(capsuleId: string, callKey: string): Promise<boolean>;
}

/** Envelopes are keyed to the room: the provider thread changes when a session resumes. */
export const runtimeEnvelopeThreadId = (capsuleId: string) => `workroom-runtime:${capsuleId}`;

const STATUS_FOR: Record<RuntimeDecision, "approved" | "declined" | "cancelled"> = {
  accept: "approved",
  decline: "declined",
  cancel: "cancelled",
};

function readHeld(argsJson: unknown): HeldRuntimeRequest | null {
  const record = argsJson && typeof argsJson === "object" ? (argsJson as Record<string, unknown>)["workroomRuntime"] : null;
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  if (typeof r["requestId"] !== "string" || typeof r["callKey"] !== "string") return null;
  return {
    requestId: r["requestId"],
    kind: (r["kind"] as RuntimeRequest["kind"]) ?? "permission",
    turnId: typeof r["turnId"] === "string" ? r["turnId"] : null,
    summary: typeof r["summary"] === "string" ? r["summary"] : "",
    detail: r["detail"] && typeof r["detail"] === "object" ? (r["detail"] as Record<string, unknown>) : {},
    callKey: r["callKey"],
    answeredBy: r["answeredBy"] === "provider" ? "provider" : "re-ask",
  };
}

// Structural: production passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function createEnvelopeHeldRequestStore(db: Db = prisma, now: () => Date = () => new Date()): HeldRequestStore {
  const live = () => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] });
  async function row(capsuleId: string, requestId: string) {
    return db.coworkerActionEnvelope.findFirst({
      where: { threadId: runtimeEnvelopeThreadId(capsuleId), argsJson: { path: ["workroomRuntime", "requestId"], equals: requestId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, argsJson: true },
    });
  }
  return {
    async hold({ capsuleId, provider, providerThreadId, actor, request, reason }) {
      await db.coworkerActionEnvelope.create({
        data: {
          coworkerAgentId: providerClientAgentId(provider),
          delegatingUserId: actor.userId,
          threadId: runtimeEnvelopeThreadId(capsuleId),
          manifestActionId: `workroom-runtime.${request.kind}`,
          argsJson: { workroomRuntime: { capsuleId, provider, providerThreadId, ...request } } as Prisma.InputJsonValue,
          rationale: `The ${provider} runtime in ${capsuleId} asks: ${request.summary.slice(0, 500)} (${reason}).`,
          expiresAt: new Date(now().getTime() + DURABLE_APPROVAL_LIFETIME_MS),
        },
      });
    },
    async find(capsuleId, requestId) {
      const found = await row(capsuleId, requestId);
      const request = found ? readHeld(found.argsJson) : null;
      return found && request ? { status: found.status, request } : null;
    },
    async listOpen(capsuleId) {
      const rows: Array<{ argsJson: unknown }> = await db.coworkerActionEnvelope.findMany({
        where: { threadId: runtimeEnvelopeThreadId(capsuleId), status: "proposed", ...live() },
        orderBy: { createdAt: "asc" },
        select: { argsJson: true },
      });
      return rows.map((r) => readHeld(r.argsJson)).filter((r): r is HeldRuntimeRequest => r !== null)
        .map(({ requestId, kind, summary }) => ({ requestId, kind, summary }));
    },
    async settle({ capsuleId, requestId, decision, decidedBy, reason }) {
      const found = await row(capsuleId, requestId);
      if (!found) return "not-found";
      const status = STATUS_FOR[decision];
      const args = found.argsJson && typeof found.argsJson === "object" ? (found.argsJson as Record<string, unknown>) : {};
      const claimed = await db.coworkerActionEnvelope.updateMany({
        where: { id: found.id, status: "proposed", resolvedAt: null, ...live() },
        data: {
          status,
          // An approval stays unresolved, as envelope-actions leaves it: resolvedAt marks execution.
          ...(status === "approved" ? {} : { resolvedAt: now() }),
          argsJson: { ...args, roomDecision: { decision, decidedBy, reason, at: now().toISOString() } } as Prisma.InputJsonValue,
        },
      });
      return claimed.count === 1 ? "settled" : "already-decided";
    },
    async isApproved(capsuleId, callKey) {
      const found = await db.coworkerActionEnvelope.findFirst({
        where: {
          threadId: runtimeEnvelopeThreadId(capsuleId),
          status: "approved",
          argsJson: { path: ["workroomRuntime", "callKey"], equals: callKey },
          ...live(),
        },
        select: { id: true },
      });
      return Boolean(found);
    },
  };
}
