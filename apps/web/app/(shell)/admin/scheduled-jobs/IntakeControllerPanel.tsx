"use client";

// Issue intake controller panel (BI-FD40397B AC-1, plan 2026-10-12 step 4).
//
// The register's one place to commission the inbound issue-intake controller.
// Collapsed by default (progressive disclosure): the summary line says whether
// intake is commissioned; opening it shows the AC-1 predicate as a checklist,
// one row per clause, evaluated as if the signed-in person commissioned now.
// The rows come from evaluateIntakeControllerClauses via the readiness
// presenter, so this component never re-derives the rule. Copy lives in the
// admin catalog (scheduledWork.intakeController.*).

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import {
  becomeIntakeControllerOwnerAction,
  commissionIntakeControllerAction,
  loadIntakeControllerPanelAction,
  type IntakeControllerPanelState,
} from "@/lib/actions/scheduled-jobs";
import type { IntakeControllerChecklistRow } from "@/lib/ecosystem/intake-controller-readiness";
import { useT } from "@/lib/i18n/use-t";
import type { Intent } from "@/lib/ui-model/statusColors";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const ROW_INTENT: Record<IntakeControllerChecklistRow["status"], Intent> = {
  pass: "success",
  fail: "danger",
  unchecked: "neutral",
};

type Outcome = { kind: "ok" | "error"; text: string } | null;

export function IntakeControllerPanel({ onChanged }: { onChanged?: () => unknown }) {
  const t = useT("admin");
  const k = "scheduledWork.intakeController" as const;
  const [state, setState] = useState<IntakeControllerPanelState | null>(null);
  const [busy, setBusy] = useState<"owner" | "commission" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const load = useCallback(async () => {
    try {
      setState(await loadIntakeControllerPanelAction());
    } catch (error) {
      setState({ ok: false, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (kind: "owner" | "commission", run: () => Promise<{ ok: boolean; data?: string; error?: string }>) => {
    setBusy(kind);
    setOutcome(null);
    try {
      const result = await run();
      setOutcome(result.ok ? { kind: "ok", text: result.data ?? "" } : { kind: "error", text: result.error ?? "" });
      await load();
      if (result.ok) await onChanged?.();
    } catch (error) {
      setOutcome({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const clauseLabel = (row: IntakeControllerChecklistRow) => t(`${k}.clause.${row.id}`);
  const readiness = state?.ok ? state.data.readiness : null;
  const canManage = state?.ok ? state.data.canManage : false;
  const commissioned = Boolean(readiness?.commission?.holds);

  const becomeOwner = async (capsuleId: string, handsOverFrom: string[]) => {
    // Confirm OUTSIDE any transition (theme-aware styling runbook).
    const confirmed = await confirmDialog({
      title: t(`${k}.ownerConfirmTitle`),
      message: handsOverFrom.length > 0
        ? t(`${k}.ownerConfirmHandover`, { room: capsuleId, names: handsOverFrom.join(", ") })
        : t(`${k}.ownerConfirm`, { room: capsuleId }),
      confirmLabel: t(`${k}.becomeOwner`),
    });
    if (!confirmed) return;
    await act("owner", () => becomeIntakeControllerOwnerAction(capsuleId));
  };

  return (
    <Surface as="section" padding="sm" className="mt-4" aria-labelledby="intake-controller-heading">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
          <span id="intake-controller-heading" className="font-medium text-[var(--dpf-text)]">
            {t(`${k}.title`)}
          </span>
          {state === null ? (
            <StatusBadge intent="neutral" label={t(`${k}.loading`)} />
          ) : (
            <StatusBadge
              intent={commissioned ? "success" : "warning"}
              label={t(commissioned ? `${k}.commissioned` : `${k}.notCommissioned`)}
            />
          )}
        </summary>

        <div className="mt-3 flex flex-col gap-3 text-sm text-[var(--dpf-text)]">
          <p className="text-xs text-[var(--dpf-muted)]">{t(`${k}.intro`)}</p>

          {state === null && <p className="text-xs text-[var(--dpf-muted)]">{t(`${k}.loading`)}</p>}

          {state && !state.ok && (
            <Notice variant="error" title={t(`${k}.loadFailed`)}>
              <p>{state.error}</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => void load()}>
                {t(`${k}.retry`)}
              </Button>
            </Notice>
          )}

          {readiness && state?.ok && (
            <>
              {readiness.commission && (
                <Notice
                  variant={readiness.commission.holds ? "success" : "warn"}
                  title={t(readiness.commission.holds ? `${k}.commissioned` : `${k}.lapsed`)}
                >
                  <p>
                    {t(`${k}.commissionDetail`, {
                      room: readiness.commission.workroomCapsuleId,
                      repository: readiness.commission.repositoryFullName,
                      by: readiness.commission.commissionedBy,
                    })}{" "}
                    <LocalTime value={readiness.commission.commissionedAt} />
                  </p>
                  {readiness.commission.reason && <p className="mt-1">{readiness.commission.reason}</p>}
                </Notice>
              )}

              <p>
                {readiness.room
                  ? t(`${k}.room`, { room: readiness.room.capsuleId, repository: readiness.room.repositoryFullName ?? "—" })
                  : t(`${k}.noRoom`)}
              </p>

              <ul className="flex flex-col gap-2" aria-label={t(`${k}.checklist`)}>
                {readiness.rows.map((row) => (
                  <li key={row.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-2">
                    <span className="shrink-0">
                      <StatusBadge intent={ROW_INTENT[row.status]} label={t(`${k}.status.${row.status}`)} />
                    </span>
                    <span className="min-w-0">
                      <span>{clauseLabel(row)}</span>
                      {row.reason && (
                        <span className="block break-words text-xs text-[var(--dpf-muted)]">{row.reason}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {!canManage && <Notice variant="info">{t(`${k}.readOnly`)}</Notice>}

              {canManage && readiness.room && (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  {readiness.ownership.canBecomeOwner && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void becomeOwner(readiness.room!.capsuleId, readiness.ownership.handsOverFrom)}
                    >
                      {busy === "owner" ? t(`${k}.working`) : t(`${k}.becomeOwner`)}
                    </Button>
                  )}
                  {!commissioned && (
                    <Button
                      size="sm"
                      disabled={busy !== null || !readiness.canCommission}
                      aria-describedby={readiness.blocking ? "intake-controller-blocked" : undefined}
                      onClick={() => void act("commission", () => commissionIntakeControllerAction(readiness.room!.capsuleId))}
                    >
                      {busy === "commission" ? t(`${k}.working`) : t(`${k}.commission`)}
                    </Button>
                  )}
                  {!commissioned && readiness.blocking && (
                    <span id="intake-controller-blocked" className="text-xs text-[var(--dpf-muted)]">
                      {t(`${k}.blockedBy`, { clause: clauseLabel(readiness.blocking) })}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          <div role="status" aria-live="polite">
            {outcome && (
              <Notice variant={outcome.kind === "ok" ? "success" : "error"}>{outcome.text}</Notice>
            )}
          </div>
        </div>
      </details>
    </Surface>
  );
}
