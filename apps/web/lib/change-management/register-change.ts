import { prisma, Prisma } from "@dpf/db";
import {
  isValidTransition,
  stampTimestampsThrough,
  timestampFieldForStatus,
  makeRfcId,
} from "./lifecycle";

// ─────────────────────────────────────────────────────────────────────────────
// Source-agnostic change-registration primitive.
//
// This is the single, session-free path for any automated source to record a
// change in the change management register (ChangeRequest/ChangeItem). It is
// deliberately NOT a "use server" action and does NOT call auth() — it runs in
// background pipelines (Inngest, schedulers) where there is no web session. The
// session-gated operator path stays in apps/web/lib/actions/change-management.ts.
//
// First consumer: the platform self-upgrade mirror
// (apps/web/lib/self-upgrade/change-record.ts). The eventual customer-estate /
// external-system change detectors reuse the SAME primitive — one registration
// path for all change sources, per the design at
// docs/superpowers/specs/2026-06-16-self-upgrade-change-register-design.md.
// ─────────────────────────────────────────────────────────────────────────────

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface RegisterChangeItemInput {
  itemType: string;
  title: string;
  description?: string | null;
  impactDescription?: string | null;
  /** Platform configuration item (CMDB) this item touches. */
  inventoryEntityId?: string | null;
  /** Free-text reference to an external/estate system this item touches. */
  externalSystemRef?: string | null;
  rollbackPlan?: string | null;
  executionOrder?: number;
}

export interface RegisterChangeInput {
  title: string;
  description: string;
  /** ITIL change type: standard | normal | emergency. Default "standard". */
  type?: string;
  /** platform | service | external | both. Default "platform". */
  scope?: string;
  /** low | medium | high | critical. Default "low". */
  riskLevel?: string;
  /**
   * Initial lifecycle stage the record is fast-forwarded to. Must be a linear
   * pre-terminal stage ("scheduled" or "in-progress" for automated sources).
   * All prior-stage timestamps are stamped. Default "scheduled".
   */
  status?: string;
  impactReport?: Record<string, unknown> | null;
  items?: RegisterChangeItemInput[];
  /** Optional explicit RFC id; generated when omitted. */
  rfcId?: string;
}

/**
 * Create a ChangeRequest (+ optional ChangeItems) already fast-forwarded to the
 * given pre-terminal stage. Returns the new record's internal id and rfcId.
 */
export async function registerChange(
  input: RegisterChangeInput,
): Promise<{ id: string; rfcId: string }> {
  if (!input.title.trim()) throw new Error("registerChange: title is required");
  if (!input.description.trim()) throw new Error("registerChange: description is required");

  const now = new Date();
  const rfcId = input.rfcId ?? makeRfcId(now);
  const status = input.status ?? "scheduled";

  // Built as a plain record then cast — matches the change-management.ts idiom
  // and avoids spreading a Record<string,Date> into Prisma's strict CreateInput.
  const data: Record<string, unknown> = {
    rfcId,
    title: input.title.trim(),
    description: input.description.trim(),
    type: input.type ?? "standard",
    scope: input.scope ?? "platform",
    riskLevel: input.riskLevel ?? "low",
    status,
    ...stampTimestampsThrough(status, now),
  };
  if (input.impactReport) data.impactReport = toJson(input.impactReport);
  if (input.items && input.items.length > 0) {
    data.changeItems = {
      create: input.items.map((item, i) => ({
        itemType: item.itemType,
        title: item.title,
        description: item.description ?? null,
        impactDescription: item.impactDescription ?? null,
        inventoryEntityId: item.inventoryEntityId ?? null,
        externalSystemRef: item.externalSystemRef ?? null,
        rollbackPlan: item.rollbackPlan ?? null,
        executionOrder: item.executionOrder ?? i,
      })),
    };
  }

  return prisma.changeRequest.create({
    data: data as never,
    select: { id: true, rfcId: true },
  });
}

/**
 * Advance a ChangeRequest one legal forward step. Idempotent and lenient: a
 * no-op when the record is already at `targetStatus` or when the step is not a
 * valid transition from the current status (so a re-driving caller can issue a
 * sequence of advances without tracking the exact current state). Stamps the
 * per-status timestamp and applies any extra fields (outcome, outcomeNotes,
 * postChangeVerification).
 */
export async function advanceChange(
  ref: { id?: string; rfcId?: string },
  targetStatus: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const where = ref.id ? { id: ref.id } : ref.rfcId ? { rfcId: ref.rfcId } : null;
  if (!where) throw new Error("advanceChange: id or rfcId required");

  const rfc = await prisma.changeRequest.findUnique({
    where: where as never,
    select: { id: true, status: true },
  });
  if (!rfc) return;
  if (rfc.status === targetStatus) return; // already there — idempotent no-op
  if (!isValidTransition(rfc.status, targetStatus)) return; // not a legal step from here — skip

  const data: Record<string, unknown> = { status: targetStatus, ...(extra ?? {}) };
  const tsField = timestampFieldForStatus(targetStatus);
  if (tsField && !data[tsField]) data[tsField] = new Date();

  await prisma.changeRequest.update({ where: { id: rfc.id }, data: data as never });
}

/** Drive a ChangeRequest through a sequence of forward steps (each idempotent). */
export async function driveChangeThrough(
  ref: { id?: string; rfcId?: string },
  steps: Array<{ status: string; extra?: Record<string, unknown> }>,
): Promise<void> {
  for (const step of steps) {
    await advanceChange(ref, step.status, step.extra);
  }
}
