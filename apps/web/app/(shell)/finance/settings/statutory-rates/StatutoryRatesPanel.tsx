"use client";

// The person-facing half of the propose/ratify split (BI-8E1FD1BD).
//
// Proposed figures come first and show their citation in full — the URL, when it
// was read, and the quoted passage — because confirming a figure means checking
// the reading against the source, and a button with no evidence beside it would
// make ratification a click rather than a check.
//
// Every value and date arrives already formatted by the page, in the viewer's
// locale, so this component carries copy and controls only.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
import {
  ratifyStatutoryRuleAction,
  recordStatutoryRuleAction,
  rejectStatutoryRuleAction,
} from "@/lib/actions/statutory-rates";
import type { StatutoryRuleKind } from "@/lib/finance/statutory-rules";

export interface StatutoryRuleView {
  payrollTaxRuleId: string;
  status: string;
  /** "Social Security · Rate · employee" — already translated. */
  heading: string;
  /** "6.2%" or "$176,100.00" — formatted for the viewer. */
  valueLabel: string;
  meta: string;
  provenance: string;
  sourceUrl: string | null;
  readOn: string | null;
  sourceExcerpt: string | null;
  rejectedReason: string | null;
}

export interface JurisdictionOption {
  jurisdictionRefId: string;
  label: string;
}

const TAX_TYPES = [
  "social_security", "medicare", "additional_medicare", "futa",
  "federal_withholding", "state_withholding", "suta", "local_withholding",
] as const;
const RULE_KINDS = ["rate", "wage_base", "threshold", "amount"] as const satisfies readonly StatutoryRuleKind[];

const FIELD = "rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1.5 text-sm text-[var(--dpf-text)]";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]";

function RuleCard({ rule, onDone }: { rule: StatutoryRuleView; onDone: (msg: string | null) => void }) {
  const t = useT("statutoryRates");
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const ratify = () => start(async () => {
    const res = await ratifyStatutoryRuleAction(rule.payrollTaxRuleId);
    onDone(res.ok ? null : res.error);
  });
  const reject = () => start(async () => {
    const res = await rejectStatutoryRuleAction(rule.payrollTaxRuleId, reason);
    if (res.ok) setRejecting(false);
    onDone(res.ok ? null : res.error);
  });

  return (
    <Surface as="li" padding="md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">{rule.heading}</p>
        <p className="text-base font-bold text-[var(--dpf-text)]">{rule.valueLabel}</p>
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">{rule.meta} · {rule.provenance}</p>

      <div className="mt-3 rounded border border-[var(--dpf-border)] p-3 text-sm">
        {rule.sourceUrl ? (
          <a
            href={rule.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-[var(--dpf-accent)] underline"
          >
            {rule.sourceUrl}
          </a>
        ) : (
          <span className="text-[var(--dpf-muted)]">{t("card.noSource")}</span>
        )}
        {rule.readOn ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">{rule.readOn}</p> : null}
        {rule.sourceExcerpt ? (
          <blockquote className="mt-2 border-s-2 border-[var(--dpf-border)] ps-3 text-[var(--dpf-text)]">
            {rule.sourceExcerpt}
          </blockquote>
        ) : null}
      </div>

      {rule.status === "rejected" && rule.rejectedReason ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{t("card.rejectedReason", { reason: rule.rejectedReason })}</p>
      ) : null}

      {rule.status === "proposed" ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <Button size="sm" disabled={pending || !rule.sourceUrl} onClick={ratify}>
            {t("card.confirm")}
          </Button>
          {rejecting ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <label className="sr-only" htmlFor={`reject-${rule.payrollTaxRuleId}`}>{t("card.rejectPrompt")}</label>
              <input
                id={`reject-${rule.payrollTaxRuleId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("card.rejectPrompt")}
                className={`min-w-[16rem] ${FIELD}`}
              />
              <Button size="sm" variant="secondary" disabled={pending || reason.trim().length === 0} onClick={reject}>
                {t("card.reject")}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
              {t("card.rejectOpen")}
            </Button>
          )}
        </div>
      ) : null}
    </Surface>
  );
}

function EntryForm({
  jurisdictions,
  onDone,
}: {
  jurisdictions: JurisdictionOption[];
  onDone: (msg: string | null) => void;
}) {
  const t = useT("statutoryRates");
  const [pending, start] = useTransition();
  const year = new Date().getUTCFullYear();
  const [form, setForm] = useState({
    jurisdictionRefId: jurisdictions.find((j) => j.jurisdictionRefId === "TAX-JUR-US-FEDERAL")?.jurisdictionRefId
      ?? jurisdictions[0]?.jurisdictionRefId ?? "",
    taxType: "social_security",
    ruleKind: "rate" as StatutoryRuleKind,
    side: "employee_withheld",
    taxYear: String(year),
    value: "",
    currency: "USD",
    effectiveFrom: `${year}-01-01`,
    sourceUrl: "",
    sourceExcerpt: "",
    retrievedAt: new Date().toISOString().slice(0, 10),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Rates are typed as the authority prints them (6.2) and stored as a fraction
  // (0.062), so nobody has to remember the convention and get it wrong by 100x.
  const submit = () => start(async () => {
    const raw = Number(form.value);
    const res = await recordStatutoryRuleAction({
      jurisdictionRefId: form.jurisdictionRefId,
      taxType: form.taxType,
      ruleKind: form.ruleKind,
      side: form.side === "" ? null : form.side,
      taxYear: Number(form.taxYear),
      value: form.ruleKind === "rate" ? raw / 100 : raw,
      currency: form.ruleKind === "rate" ? null : form.currency || null,
      effectiveFrom: new Date(`${form.effectiveFrom}T00:00:00.000Z`).toISOString(),
      effectiveTo: null,
      sourceUrl: form.sourceUrl.trim(),
      sourceExcerpt: form.sourceExcerpt.trim(),
      retrievedAt: new Date(`${form.retrievedAt}T00:00:00.000Z`).toISOString(),
      notes: null,
    });
    if (res.ok) setForm((f) => ({ ...f, value: "", sourceUrl: "", sourceExcerpt: "" }));
    onDone(res.ok ? null : res.error);
  });

  // Collapsed by default. The page's primary job is confirming what a coworker
  // researched — three groups and two buttons. Typing a figure in yourself is the
  // fallback for when no coworker could, so its ten fields stay out of the
  // default view until someone asks for them.
  return (
    <Surface as="section" padding="md" className="mt-6">
      <details id="statutory-entry">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">{t("entry.summary")}</summary>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">{t("entry.help")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={LABEL}>{t("entry.jurisdiction")}
            <select value={form.jurisdictionRefId} onChange={set("jurisdictionRefId")} className={FIELD}>
              {jurisdictions.map((j) => <option key={j.jurisdictionRefId} value={j.jurisdictionRefId}>{j.label}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t("entry.tax")}
            <select value={form.taxType} onChange={set("taxType")} className={FIELD}>
              {TAX_TYPES.map((k) => <option key={k} value={k}>{t(`taxType.${k}`)}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t("entry.kind")}
            <select value={form.ruleKind} onChange={set("ruleKind")} className={FIELD}>
              {RULE_KINDS.map((k) => <option key={k} value={k}>{t(`ruleKind.${k}`)}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t("entry.side")}
            <select value={form.side} onChange={set("side")} className={FIELD}>
              <option value="employee_withheld">{t("entry.sideEmployee")}</option>
              <option value="employer_contribution">{t("entry.sideEmployer")}</option>
              <option value="">{t("entry.sideNone")}</option>
            </select>
          </label>
          <label className={LABEL}>{form.ruleKind === "rate" ? t("entry.rate") : t("entry.amount")}
            <input inputMode="decimal" value={form.value} onChange={set("value")} className={FIELD} />
          </label>
          <label className={LABEL}>{t("entry.taxYear")}
            <input inputMode="numeric" value={form.taxYear} onChange={set("taxYear")} className={FIELD} />
          </label>
          <label className={LABEL}>{t("entry.effectiveFrom")}
            <input type="date" value={form.effectiveFrom} onChange={set("effectiveFrom")} className={FIELD} />
          </label>
          <label className={LABEL}>{t("entry.readOn")}
            <input type="date" value={form.retrievedAt} onChange={set("retrievedAt")} className={FIELD} />
          </label>
          <label className={`${LABEL} sm:col-span-2 lg:col-span-1`}>{t("entry.sourceUrl")}
            <input type="url" value={form.sourceUrl} onChange={set("sourceUrl")} className={FIELD}
              placeholder={t("entry.sourceUrlHint")} />
          </label>
          <label className={`${LABEL} sm:col-span-2 lg:col-span-3`}>{t("entry.excerpt")}
            <textarea value={form.sourceExcerpt} onChange={set("sourceExcerpt")} rows={3} className={FIELD} />
          </label>
        </div>
        <Button
          size="sm"
          className="mt-3"
          onClick={submit}
          disabled={pending || !form.value || !form.sourceUrl.trim() || !form.sourceExcerpt.trim()}
        >
          {t("entry.submit")}
        </Button>
      </details>
    </Surface>
  );
}

export function StatutoryRatesPanel({
  rules,
  jurisdictions,
}: {
  rules: StatutoryRuleView[];
  jurisdictions: JurisdictionOption[];
}) {
  const t = useT("statutoryRates");
  const [message, setMessage] = useState<string | null>(null);
  const proposed = rules.filter((r) => r.status === "proposed");
  const ratified = rules.filter((r) => r.status === "ratified");
  const rejected = rules.filter((r) => r.status === "rejected");

  const group = (title: string, items: StatutoryRuleView[], empty: string, id?: string) => (
    <section className="mt-6" aria-label={title} id={id}>
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{title} ({items.length})</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {items.map((r) => <RuleCard key={r.payrollTaxRuleId} rule={r} onDone={setMessage} />)}
        </ul>
      )}
    </section>
  );

  return (
    <div>
      {message ? (
        <Surface padding="sm" role="alert" className="mt-4 text-sm text-[var(--dpf-text)]">{message}</Surface>
      ) : null}
      {group(t("groups.waiting"), proposed, t("groups.waitingEmpty"), "statutory-waiting")}
      {group(t("groups.confirmed"), ratified, t("groups.confirmedEmpty"))}
      {rejected.length > 0 ? group(t("groups.rejected"), rejected, "") : null}
      <EntryForm jurisdictions={jurisdictions} onDone={setMessage} />
    </div>
  );
}
