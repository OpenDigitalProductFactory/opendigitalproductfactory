/**
 * Controlled-substance discrepancy command (EP-CSC-CUSTODY, BI-CSC-004).
 *
 * Moves a discrepancy case through its lifecycle. Classifying a case as
 * suspected theft or significant loss stamps the 21 CFR 1301.76(b) deadlines,
 * computed in the register's timezone; closing it needs the reporting evidence.
 */

import type {
  ControlledSubstanceDiscrepancyClass,
  ControlledSubstanceDiscrepancyStatus,
} from "@dpf/db/controlled-substance-enums";

import {
  CustodyCommandError,
  date,
  loadGrants,
  loadPrincipals,
  lock,
  refused,
  serializable,
  setOrganizationContext,
  text,
  type CustodyClient,
  type CustodyContext,
} from "./custody-core";
import {
  evaluateDiscrepancyTransition,
  lossReportingDeadlines,
  requiresLossReporting,
  type DiscrepancyState,
} from "./discrepancy-policy";
import { holdsScope, isEligibleHandler } from "./ledger-policy";

// ─── Discrepancies ──────────────────────────────────────────────────────────

export type DiscrepancyCommand = {
  discrepancyRef: string;
  to: ControlledSubstanceDiscrepancyStatus;
  classification?: ControlledSubstanceDiscrepancyClass;
  classificationRationale?: string | null;
  significanceFactors?: Record<string, string> | null;
  regulatorNoticeGivenAt?: string | null;
  regulatorNoticeRef?: string | null;
  lossReportFiledAt?: string | null;
  lossReportRef?: string | null;
  resolution?: string | null;
};

export type DiscrepancyRecord = {
  discrepancyRef: string;
  status: ControlledSubstanceDiscrepancyStatus;
  classification: ControlledSubstanceDiscrepancyClass;
  regulatorNoticeDueAt: Date | null;
  lossReportDueAt: Date | null;
};

/**
 * Move a discrepancy case through its lifecycle. Classifying a case as
 * suspected theft or significant loss stamps the 21 CFR 1301.76(b) deadlines,
 * computed in the register's timezone.
 */
export async function transitionControlledDiscrepancy(input: {
  db: CustodyClient;
  context: CustodyContext & { timeZone?: string; holidays?: readonly string[] };
  command: DiscrepancyCommand;
}): Promise<DiscrepancyRecord> {
  const { context, command } = input;
  const now = context.now ?? new Date();

  return serializable(input.db, async (tx) => {
    await setOrganizationContext(tx, context.organizationId);
    const current = (await tx.controlledSubstanceDiscrepancy.findFirst({
      where: { organizationId: context.organizationId, discrepancyRef: command.discrepancyRef },
      select: {
        id: true,
        registerId: true,
        status: true,
        classification: true,
        classificationRationale: true,
        discoveredAt: true,
        regulatorNoticeDueAt: true,
        regulatorNoticeGivenAt: true,
        regulatorNoticeRef: true,
        lossReportDueAt: true,
        lossReportFiledAt: true,
        lossReportRef: true,
        resolution: true,
        register: { select: { careLocation: { select: { timezone: true } } } },
      },
    })) as
      | (DiscrepancyState & {
          id: string;
          registerId: string;
          discoveredAt: Date;
          regulatorNoticeDueAt: Date | null;
          lossReportDueAt: Date | null;
          register: { careLocation: { timezone: string } | null };
        })
      | null;
    if (!current) throw new CustodyCommandError("discrepancy_not_found", "That discrepancy case was not found.");

    await lock(tx, `controlled-substance-discrepancy:${current.id}`);

    const principals = await loadPrincipals(tx, [context.actorPrincipalId]);
    const actor = principals.get(context.actorPrincipalId)!;
    const grants = await loadGrants(tx, current.registerId, [actor.id]);
    if (!isEligibleHandler(actor) || !holdsScope(grants, actor.id, "reconcile", now)) {
      throw refused([{ code: "illegal_transition", message: "You are not authorized to reconcile this register." }]);
    }

    const next: DiscrepancyState = {
      status: command.to,
      classification: command.classification ?? current.classification,
      classificationRationale:
        command.classificationRationale !== undefined ? text(command.classificationRationale) : current.classificationRationale,
      regulatorNoticeGivenAt:
        command.regulatorNoticeGivenAt !== undefined
          ? command.regulatorNoticeGivenAt
            ? date(command.regulatorNoticeGivenAt, "Notice given at", now)
            : null
          : current.regulatorNoticeGivenAt,
      regulatorNoticeRef: command.regulatorNoticeRef !== undefined ? text(command.regulatorNoticeRef) : current.regulatorNoticeRef,
      lossReportFiledAt:
        command.lossReportFiledAt !== undefined
          ? command.lossReportFiledAt
            ? date(command.lossReportFiledAt, "Form 106 filed at", now)
            : null
          : current.lossReportFiledAt,
      lossReportRef: command.lossReportRef !== undefined ? text(command.lossReportRef) : current.lossReportRef,
      resolution: command.resolution !== undefined ? text(command.resolution) : current.resolution,
    };

    const evaluation = evaluateDiscrepancyTransition(current.status, command.to, next);
    if (!evaluation.allowed) throw refused(evaluation.refusals);

    let regulatorNoticeDueAt = current.regulatorNoticeDueAt;
    let lossReportDueAt = current.lossReportDueAt;
    if (requiresLossReporting(next.classification) && !regulatorNoticeDueAt) {
      const timeZone = current.register.careLocation?.timezone ?? context.timeZone;
      if (!timeZone) {
        throw new CustodyCommandError("invalid_input", "The register's timezone is needed to compute the reporting deadlines.");
      }
      const deadlines = lossReportingDeadlines({ discoveredAt: current.discoveredAt, timeZone, holidays: context.holidays });
      regulatorNoticeDueAt = deadlines.regulatorNoticeDueAt;
      lossReportDueAt = deadlines.lossReportDueAt;
    }

    const closing = command.to === "reconciled" || command.to === "closed";
    await tx.controlledSubstanceDiscrepancy.update({
      where: { id: current.id },
      data: {
        status: command.to,
        classification: next.classification,
        classificationRationale: next.classificationRationale,
        ...(command.significanceFactors !== undefined ? { significanceFactors: command.significanceFactors } : {}),
        regulatorNoticeDueAt,
        regulatorNoticeGivenAt: next.regulatorNoticeGivenAt,
        regulatorNoticeRef: next.regulatorNoticeRef,
        lossReportDueAt,
        lossReportFiledAt: next.lossReportFiledAt,
        lossReportRef: next.lossReportRef,
        resolution: next.resolution,
        ...(closing ? { resolvedByPrincipalId: actor.id } : {}),
        ...(command.to === "closed" ? { closedAt: now } : {}),
      },
    });

    return {
      discrepancyRef: command.discrepancyRef,
      status: command.to,
      classification: next.classification,
      regulatorNoticeDueAt,
      lossReportDueAt,
    };
  });
}

