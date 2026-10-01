"use client";

// Who answers for each portfolio (BI-67B27832), beside its budget on Ops >
// Delivery Flow. One accountable person per portfolio owns its automatic work:
// scheduled builds, the rooms they open, and the approvals they raise.

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { fieldControlClass, fieldErrorClass, fieldLabelClass } from "@/components/ui/form/styles";
import { setPortfolioOwnerAction } from "@/lib/actions/portfolio-budget";
import { useT } from "@/lib/i18n/use-t";
import type { PortfolioOwnershipView } from "@/lib/portfolio/accountable-owner-view";

export function PortfolioOwnership({ view, canManage }: { view: PortfolioOwnershipView; canManage: boolean }) {
  const t = useT("portfolio");
  return (
    <section aria-labelledby="portfolio-owners-heading" className="space-y-2">
      <h2 id="portfolio-owners-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
        {t("owners.heading")}
      </h2>
      <p className="text-sm text-[var(--dpf-muted)]">
        {t("owners.body")} {view.standIn ? t("owners.standIn", { email: view.standIn.email }) : null}
      </p>
      <Surface as="section" padding="none">
        <ul className="divide-y divide-[var(--dpf-border)]">
          {view.rows.map((row) => (
            <OwnershipRow key={row.portfolioId} row={row} candidates={view.candidates} canManage={canManage} />
          ))}
        </ul>
      </Surface>
    </section>
  );
}

function OwnershipRow({
  row,
  candidates,
  canManage,
}: {
  row: PortfolioOwnershipView["rows"][number];
  candidates: PortfolioOwnershipView["candidates"];
  canManage: boolean;
}) {
  const t = useT("portfolio");
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(row.owner?.principalId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const personId = `owner-person-${row.portfolioId}`;
  const reasonId = `owner-reason-${row.portfolioId}`;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setPortfolioOwnerAction({ portfolioId: row.portfolioId, principalRef: choice || null, reason });
      if (result.ok) {
        setEditing(false);
        setReason("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-[var(--dpf-text)]">{row.name}</span>
        <span className="flex items-baseline gap-3 text-[var(--dpf-text)]">
          {row.owner ? row.owner.displayName : <span className="text-[var(--dpf-muted)]">{t("owners.notSet")}</span>}
          {canManage && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {t("owners.change")}
            </Button>
          ) : null}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1 sm:w-56">
            <label htmlFor={personId} className={fieldLabelClass}>{t("owners.person")}</label>
            <select id={personId} value={choice} onChange={(e) => setChoice(e.target.value)} className={fieldControlClass}>
              <option value="">{t("owners.nobody")}</option>
              {candidates.map((c) => (
                <option key={c.principalId} value={c.principalId}>
                  {c.displayName} ({c.email})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={reasonId} className={fieldLabelClass}>{t("owners.why")}</label>
            <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} required className={fieldControlClass} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={pending || !reason.trim()}>
              {t("owners.save")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setError(null); }}>
              {t("owners.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className={fieldErrorClass}>{error}</p> : null}
    </li>
  );
}
