"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/form";
import { rebindWorkroomShape } from "@/lib/actions/workroom-shape-rebind";
import { useT } from "@/lib/i18n/use-t";
import type { WorkroomShapeRebindView } from "@/lib/work-management/workroom-shape-rebind";

/**
 * A newer version of the room's work shape, inside the room's Attention card
 * (BI-CB5C0DCE). Progressive disclosure, as the stage decision beside it: ONE
 * line saying what is ready and whether it widens, and a "Review" button. The
 * per-stage changes and the rationale stay behind it. Anyone who may not
 * decide sees the line and who decides; the server refuses them anyway.
 */
export function WorkroomShapeRebind({ view }: { view: WorkroomShapeRebindView }) {
  const t = useT("workrooms");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const widens = view.classification === "widening";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await rebindWorkroomShape(view.caseKey, view.roomRowId, {
        toVersion: view.toVersion,
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {t("shapeRebind.available", { from: view.fromRef, to: view.toVersion })}{" "}
          <span className="text-[var(--dpf-muted)]">{widens ? t("shapeRebind.widens") : t("shapeRebind.narrows")}</span>
        </p>
        {!open ? (
          <Button size="sm" variant={view.canRebind ? "primary" : "ghost"} onClick={() => setOpen(true)}>{t("shapeRebind.review")}</Button>
        ) : null}
      </div>
      {!view.canRebind && view.refusal ? (
        <p className="text-xs text-[var(--dpf-muted)]">{view.refusal} {t("shapeRebind.keepsRunning", { from: view.fromRef })}</p>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-[var(--dpf-border)] pt-3">
          <div>
            <p className="text-xs font-semibold text-[var(--dpf-muted)]">{t("shapeRebind.changes")}</p>
            <ul className="mt-1 space-y-1">
              {view.changes.map((change, index) => (
                <li key={`${change.kind}:${change.stageKey ?? ""}:${index}`} className="text-xs text-[var(--dpf-text)]">
                  <span className="text-[var(--dpf-muted)]">
                    {change.stageKey ? t("shapeRebind.stage", { stage: change.stageKey }) : t("shapeRebind.shapeLevel")}:{" "}
                  </span>
                  {t(`shapeRebind.kinds.${change.kind}`, { detail: change.detail })}
                </li>
              ))}
            </ul>
          </div>

          {view.canRebind ? (
            <>
              <TextField
                name="shape-rebind-rationale"
                label={t("shapeRebind.rationale")}
                {...(widens ? { required: true, hint: t("shapeRebind.rationaleHint") } : { optional: true })}
                value={rationale}
                onValueChange={setRationale}
                maxLength={500}
                autoComplete="off"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={submit} disabled={pending || (widens && !rationale.trim())}>
                  {t("shapeRebind.rebind", { to: view.toVersion })}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  {t("shapeRebind.cancel")}
                </Button>
              </div>
              <FormStatus error={error} />
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("shapeRebind.cancel")}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
