// BI-FEDD8F45 — the platform write behind the `guardOutcomes` payload of
// `record_external_development_evidence` (DI-C7020CB136AA).
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.2.
//
// A client submits; the platform writes. The actor and recorder come from the
// authenticated caller, never from the payload. The row id derives from the
// runId, so a resubmitted run collides on the primary key. The collision is
// acknowledged only when the stored row has the same actor and canonical
// content; anything else under that identity is an integrity refusal (design
// §4.2, §5.1). Refusals say whether they are permanent, so the client
// quarantines them instead of resubmitting forever.

import type { Prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import {
  GUARD_OUTCOME_OPERATION,
  MAX_DECLARATIONS_BYTES,
  MAX_RECORDS_PER_CALL,
  guardDeclarationsRowId,
  guardOutcomeRunRowId,
  sha256Hex,
  validateGuardOutcomeRun,
  type GuardOutcomeRun,
} from "./guard-outcome-run";

export type GuardOutcomeWriteDb = {
  externalEvidenceRecord: {
    create(args: { data: Prisma.ExternalEvidenceRecordUncheckedCreateInput }): Promise<{ id: string }>;
    findUnique(args: {
      where: { id: string };
      select: { details: true; actorUserId: true; recordedByAgentId: true };
    }): Promise<{ details: Prisma.JsonValue | null; actorUserId: string; recordedByAgentId: string | null } | null>;
  };
};

export type RecordGuardOutcomesInput = {
  records: unknown;
  declarations?: unknown;
  actorUserId: string;
  provider: string;
  routeContext: string;
  recordedByPrincipalId?: string;
  recordedByAgentId?: string;
};

/** permanent: the same payload can never be accepted; quarantine it. */
export type GuardOutcomeRefusal = { runId: string | null; reason: string; permanent: boolean };

export type RecordGuardOutcomesResult = ActionResult<{
  acknowledged: string[];
  refused: GuardOutcomeRefusal[];
  declarations: "stored" | "already-stored" | "absent" | "refused" | "integrity-conflict";
}>;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Key-sorted JSON, so content equality does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A collision is a replay only when the same actor sent the same content. */
async function isExactReplay(
  db: GuardOutcomeWriteDb,
  id: string,
  content: unknown,
  input: RecordGuardOutcomesInput,
): Promise<boolean> {
  const existing = await db.externalEvidenceRecord.findUnique({
    where: { id },
    select: { details: true, actorUserId: true, recordedByAgentId: true },
  });
  return Boolean(
    existing
      && existing.actorUserId === input.actorUserId
      && (existing.recordedByAgentId ?? null) === (input.recordedByAgentId ?? null)
      && canonicalJson(existing.details) === canonicalJson(content),
  );
}

function summarize(run: GuardOutcomeRun): string {
  const refused = run.guards.filter((g) => g.verdict === "refused").length;
  const override = run.override ? `, override ${run.override.code}` : "";
  return `${run.runner}: ${run.guards.length} guard result(s), ${refused} refused${override}`.slice(0, 240);
}

async function storeDeclarations(
  raw: unknown,
  input: RecordGuardOutcomesInput,
  db: GuardOutcomeWriteDb,
): Promise<"stored" | "already-stored" | "absent" | "refused" | "integrity-conflict"> {
  if (raw === undefined || raw === null) return "absent";
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_DECLARATIONS_BYTES) return "refused";
  let guards: unknown;
  try {
    guards = (JSON.parse(raw) as { guards?: unknown })?.guards;
  } catch {
    return "refused";
  }
  if (!guards || typeof guards !== "object" || Array.isArray(guards)) return "refused";
  const digest = sha256Hex(raw);
  const content = { digest, guards };
  try {
    await db.externalEvidenceRecord.create({
      data: {
        id: guardDeclarationsRowId(digest),
        actorUserId: input.actorUserId,
        routeContext: input.routeContext,
        operationType: GUARD_OUTCOME_OPERATION.declarations,
        target: digest,
        provider: input.provider,
        resultSummary: `guard declarations ${digest.slice(0, 12)}`,
        details: content as Prisma.InputJsonValue,
        ...(input.recordedByPrincipalId ? { recordedByPrincipalId: input.recordedByPrincipalId } : {}),
        ...(input.recordedByAgentId ? { recordedByAgentId: input.recordedByAgentId } : {}),
      },
    });
    return "stored";
  } catch (error) {
    if (isUniqueViolation(error)) {
      return (await isExactReplay(db, guardDeclarationsRowId(digest), content, input)) ? "already-stored" : "integrity-conflict";
    }
    throw error;
  }
}

export async function recordGuardOutcomes(
  input: RecordGuardOutcomesInput,
  db: GuardOutcomeWriteDb,
): Promise<RecordGuardOutcomesResult> {
  if (!Array.isArray(input.records) || input.records.length === 0) {
    return err("records must be a non-empty array");
  }
  if (input.records.length > MAX_RECORDS_PER_CALL) {
    return err(`at most ${MAX_RECORDS_PER_CALL} records per call`);
  }

  const declarations = await storeDeclarations(input.declarations, input, db);
  const acknowledged: string[] = [];
  const refused: GuardOutcomeRefusal[] = [];

  for (const candidate of input.records) {
    const validation = validateGuardOutcomeRun(candidate);
    if (!validation.valid) {
      refused.push({ runId: validation.runId, reason: validation.reason, permanent: true });
      continue;
    }
    const run = validation.run;
    try {
      await db.externalEvidenceRecord.create({
        data: {
          id: guardOutcomeRunRowId(run.runId),
          actorUserId: input.actorUserId,
          routeContext: input.routeContext,
          operationType: GUARD_OUTCOME_OPERATION.run,
          target: `${run.diff.cloneKey}:${run.diff.branch}`,
          provider: input.provider,
          resultSummary: summarize(run),
          details: run as unknown as Prisma.InputJsonValue,
          ...(input.recordedByPrincipalId ? { recordedByPrincipalId: input.recordedByPrincipalId } : {}),
          ...(input.recordedByAgentId ? { recordedByAgentId: input.recordedByAgentId } : {}),
        },
      });
      acknowledged.push(run.runId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (await isExactReplay(db, guardOutcomeRunRowId(run.runId), run, input)) acknowledged.push(run.runId);
        else refused.push({ runId: run.runId, reason: "integrity-conflict", permanent: true });
        continue;
      }
      throw error;
    }
  }

  return ok({ acknowledged, refused, declarations });
}
