/**
 * Enrichment service — the governed write path (BI-B2497DFB, AC5/AC7).
 *
 * The pure builders (completeness/offer/proposal/no-fabrication) never touch
 * the DB. This module is the thin prisma layer:
 *   - `loadRecordForEnrichment` reads current field values for proposal-building;
 *   - `fileEnrichmentProposal` files the proposal to the steward queue
 *     (`MdmStewardTask` kind `enrichment`) — nothing written to the record yet,
 *     preserving the platform invariant (propose-to-queue, human/authority
 *     applies);
 *   - `applyEnrichmentProposal` writes the accepted fields WITH provenance
 *     (`registerCustomerAccountSource` / the record's `source`), records the
 *     scant→enriched diff on the account timeline, and resolves the task.
 *
 * `applyEnrichmentProposal` is surfaced only through the `crm_write`-granted
 * `apply_crm_enrichment` tool, so it routes through `governedExecuteTool`
 * (user-cap → grant → coworker authority → audit) — the consequential-write
 * gate, per EP-1C37C089's existing enforcement path.
 */
import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  type EnrichableField,
  type EnrichmentProposal,
  type EnrichmentRecordKind,
  type EnrichmentTaskReasons,
} from "./types";

export const ENRICHMENT_TASK_KIND = "enrichment";
export const ENRICHMENT_RESOLUTION = "resolved_enriched";

/**
 * Fields written to a real scalar column. Anything enrichable but not listed
 * here (e.g. `location`) is folded into a provenance-tagged `notes` annotation
 * rather than dropped, so a researched-but-columnless fact still lands.
 */
const ACCOUNT_SCALAR_COLUMNS: Partial<Record<EnrichableField, "string" | "int">> = {
  name: "string",
  website: "string",
  industry: "string",
  employeeCount: "int",
};
const CONTACT_SCALAR_COLUMNS: Partial<Record<EnrichableField, "string" | "int">> = {
  firstName: "string",
  lastName: "string",
  jobTitle: "string",
  phone: "string",
  linkedinUrl: "string",
};

function newTaskId(): string {
  return `STEW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export type LoadedRecord = {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  label: string;
  /** account id for timeline attribution (self for accounts, parent for contacts). */
  accountId: string | null;
  current: Record<string, unknown>;
};

/** Load current field values for proposal-building. Returns null if not found. */
export async function loadRecordForEnrichment(
  recordKind: EnrichmentRecordKind,
  recordId: string,
): Promise<LoadedRecord | null> {
  if (recordKind === "customer-account") {
    const acct = await prisma.customerAccount.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        name: true,
        website: true,
        industry: true,
        employeeCount: true,
        notes: true,
        status: true,
      },
    });
    if (!acct || acct.status === "superseded") return null;
    return {
      recordKind,
      recordId,
      label: acct.name,
      accountId: acct.id,
      current: {
        name: acct.name,
        website: acct.website,
        industry: acct.industry,
        employeeCount: acct.employeeCount,
        notes: acct.notes,
      },
    };
  }
  const contact = await prisma.customerContact.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      accountId: true,
      name: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      phone: true,
      linkedinUrl: true,
      email: true,
      mergedIntoId: true,
    },
  });
  if (!contact || contact.mergedIntoId) return null;
  const composedName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return {
    recordKind,
    recordId,
    label: contact.name || composedName || contact.email,
    accountId: contact.accountId,
    current: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
    },
  };
}

/**
 * File the proposal to the steward queue as an open `enrichment` task
 * (idempotent per record — re-proposing refreshes the open task). Returns the
 * task id, or null if there is nothing to propose (no changes and no gaps).
 */
export async function fileEnrichmentProposal(
  proposal: EnrichmentProposal,
  meta?: { proactivity?: { level: string; policyId: string } },
): Promise<string | null> {
  if (proposal.changes.length === 0 && proposal.unresolvedGaps.length === 0) {
    return null;
  }
  const reasons: EnrichmentTaskReasons = {
    changes: proposal.changes,
    unresolvedGaps: proposal.unresolvedGaps,
    scope: proposal.scope,
    ...(meta?.proactivity ? { proactivity: meta.proactivity } : {}),
  };
  const note =
    `Enrichment: ${proposal.changes.length} proposed change(s), ` +
    `${proposal.unresolvedGaps.length} unverified gap(s). Apply with apply_crm_enrichment ` +
    `or from /admin/data-stewardship — nothing written yet.`;

  const existing = await prisma.mdmStewardTask.findUnique({
    where: {
      domain_kind_subjectId_candidateId: {
        domain: proposal.recordKind,
        kind: ENRICHMENT_TASK_KIND,
        subjectId: proposal.recordId,
        candidateId: "",
      },
    },
  });
  if (existing) {
    await prisma.mdmStewardTask.update({
      where: { id: existing.id },
      data: { reasons: reasons as unknown as object, note, status: "open" },
    });
    return existing.taskId;
  }
  const taskId = newTaskId();
  await prisma.mdmStewardTask.create({
    data: {
      taskId,
      domain: proposal.recordKind,
      kind: ENRICHMENT_TASK_KIND,
      subjectId: proposal.recordId,
      candidateId: "",
      reasons: reasons as unknown as object,
      note,
    },
  });
  return taskId;
}

/**
 * Parse a value into a single integer for an Int column. Accepts a lone number
 * with optional thousands separators and a trailing word ("12", "1,200",
 * "12 employees"). REJECTS ranges/buckets ("11-50", "50–100", "1,001-5,000")
 * — digit-stripping those produces a fabricated headcount ("11-50" → 1150), so
 * the caller keeps the researched value as a text note instead of writing junk
 * to the column. Returns null when the value is not a single clean integer.
 */
function parseSingleInt(value: string): number | null {
  const trimmed = value.trim();
  // A range/bucket (two number groups joined by a dash/"to") is not a single int.
  if (/\d[\s]*(?:[-–—]|to)[\s]*\d/.test(trimmed)) return null;
  const match = trimmed.replace(/,/g, "").match(/\d+/g);
  if (!match || match.length !== 1) return null;
  const n = Number.parseInt(match[0]!, 10);
  return Number.isFinite(n) ? n : null;
}

export type ApplyResult = {
  taskId: string;
  recordKind: EnrichmentRecordKind;
  recordId: string;
  applied: Array<{ field: EnrichableField; value: string; source: string; sourceRef: string }>;
  annotatedToNotes: EnrichableField[];
};

/**
 * Apply an open enrichment task: write the accepted fields, register provenance,
 * record the diff on the timeline, resolve the task. Governed by the caller's
 * `crm_write` grant (via `governedExecuteTool`).
 */
export async function applyEnrichmentProposal(
  taskId: string,
  opts: { resolvedBy: string | null },
): Promise<{ ok: true; result: ApplyResult } | { ok: false; message: string }> {
  const task = await prisma.mdmStewardTask.findUnique({ where: { taskId } });
  if (!task) return { ok: false, message: `No steward task ${taskId}.` };
  if (task.kind !== ENRICHMENT_TASK_KIND) {
    return { ok: false, message: `${taskId} is a ${task.kind} task, not an enrichment proposal.` };
  }
  if (task.status !== "open") return { ok: false, message: `${taskId} is already ${task.status}.` };

  const reasons = (task.reasons ?? {}) as EnrichmentTaskReasons;
  const changes = Array.isArray(reasons.changes) ? reasons.changes : [];
  if (changes.length === 0) {
    return { ok: false, message: `${taskId} has no proposed changes to apply.` };
  }
  const recordKind = task.domain as EnrichmentRecordKind;
  const scalarMap = recordKind === "customer-account" ? ACCOUNT_SCALAR_COLUMNS : CONTACT_SCALAR_COLUMNS;

  const columnData: Record<string, string | number> = {};
  const noteAnnotations: string[] = [];
  const annotatedToNotes: EnrichableField[] = [];
  const applied: ApplyResult["applied"] = [];

  for (const change of changes) {
    // Defensive: a malformed persisted task could carry a non-string value.
    if (typeof change.proposed !== "string" || change.proposed.trim().length === 0) continue;
    const columnKind = scalarMap[change.field];
    let toNote = false;
    if (columnKind === "string") {
      columnData[change.field] = change.proposed.trim();
    } else if (columnKind === "int") {
      const parsed = parseSingleInt(change.proposed);
      if (parsed !== null) {
        columnData[change.field] = parsed;
      } else {
        // A range/bucket ("11-50 employees") — keep the researched value as a
        // text note rather than fabricating a precise integer for the column.
        toNote = true;
      }
    } else {
      toNote = true; // no scalar column (e.g. location)
    }
    if (toNote) {
      noteAnnotations.push(`${change.field}: ${change.proposed.trim()} [${change.source}: ${change.sourceRef}]`);
      annotatedToNotes.push(change.field);
    }
    applied.push({
      field: change.field,
      value: change.proposed.trim(),
      source: change.source,
      sourceRef: change.sourceRef,
    });
  }

  if (applied.length === 0) {
    return { ok: false, message: `${taskId}: no applicable field values after validation.` };
  }

  try {
    // Reads first (outside the write transaction): current notes for the
    // append-merge, and the account id for the timeline attribution.
    let accountId: string | null = null;
    let recordUpdate: unknown;
    if (recordKind === "customer-account") {
      const existing = await prisma.customerAccount.findUnique({
        where: { id: task.subjectId },
        select: { notes: true },
      });
      const notes = mergeNotes(existing?.notes ?? null, noteAnnotations);
      accountId = task.subjectId;
      recordUpdate = prisma.customerAccount.update({
        where: { id: task.subjectId },
        data: {
          ...columnData,
          ...(notes !== null ? { notes } : {}),
          sourceSystem: "coworker-tool",
        },
      });
    } else {
      accountId =
        (await prisma.customerContact.findUnique({
          where: { id: task.subjectId },
          select: { accountId: true },
        }))?.accountId ?? null;
      // Do NOT clobber the contact's original `source` (web/referral/import);
      // enrichment provenance is carried by the timeline activity + the diff.
      recordUpdate = prisma.customerContact.update({
        where: { id: task.subjectId },
        data: { ...columnData },
      });
    }

    // Diff on the account timeline (AC5 — visible scant→enriched record).
    // `createdById` stays null (system-generated): the acting MCP identity may
    // be a coworker/agent id, not a real User row, and Activity.createdById FKs
    // to User — a bad id would throw here after the record was already written.
    const body = applied.map((a) => `${a.field} ← "${a.value}" (${a.source}: ${a.sourceRef})`).join("\n");
    const writes: unknown[] = [recordUpdate];
    if (accountId) {
      writes.push(
        prisma.activity.create({
          data: {
            activityId: `ACT-${crypto.randomUUID()}`,
            type: "system",
            subject: `Record enriched from public sources (${applied.length} field(s))`,
            body,
            accountId,
            contactId: recordKind === "customer-contact" ? task.subjectId : null,
            createdById: null,
          },
        }),
      );
    }
    writes.push(
      prisma.mdmStewardTask.update({
        where: { id: task.id },
        data: { status: ENRICHMENT_RESOLUTION, resolvedBy: opts.resolvedBy, resolvedAt: new Date() },
      }),
    );

    // Atomic: record write + timeline + task resolution land together, so a
    // failure cannot leave the record mutated while the task stays re-appliable.
    await prisma.$transaction(writes as never);

    // Provenance crosswalk is best-effort (own try/catch inside) and must never
    // fail the applied write, so it runs after the transaction commits.
    if (recordKind === "customer-account") {
      await registerCustomerAccountSource({
        accountId: task.subjectId,
        sourceSystem: "coworker-tool",
        sourceEntityId: `enrichment:${taskId}`,
        sourceEntityType: "enrichment-proposal",
      });
    }
  } catch (err) {
    return { ok: false, message: `Enrichment apply failed: ${getErrorMessage(err)}` };
  }

  return {
    ok: true,
    result: { taskId, recordKind, recordId: task.subjectId, applied, annotatedToNotes },
  };
}

/** Append provenance annotations to notes without clobbering existing content. */
function mergeNotes(existing: string | null, annotations: string[]): string | null {
  if (annotations.length === 0) return null;
  const block = annotations.join("\n");
  return existing && existing.trim().length > 0 ? `${existing.trim()}\n${block}` : block;
}
