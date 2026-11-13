"use client";

// The person-facing half of the propose/ratify split (BI-8E1FD1BD).
//
// Proposed figures come first and show their citation in full — the URL, when it
// was read, and the quoted passage — because confirming a figure means checking
// the reading against the source, and a button with no evidence beside it would
// make ratification a click rather than a check.

import { useState, useTransition } from "react";
import {
  ratifyStatutoryRuleAction,
  recordStatutoryRuleAction,
  rejectStatutoryRuleAction,
} from "@/lib/actions/statutory-rates";
import type { StatutoryRuleKind } from "@/lib/finance/statutory-rules";

export interface StatutoryRuleView {
  payrollTaxRuleId: string;
  jurisdictionRefId: string;
  taxType: string;
  ruleKind: string;
  side: string | null;
  taxYear: number;
  value: string;
  currency: string | null;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string | null;
  sourceExcerpt: string | null;
  retrievedAt: string | null;
  proposedBy: "coworker" | "person";
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
const RULE_KINDS: StatutoryRuleKind[] = ["rate", "wage_base", "threshold", "amount"];

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

/** A rate is stored as a fraction; show it the way the authority prints it. */
function displayValue(rule: Pick<StatutoryRuleView, "ruleKind" | "value" | "currency">): string {
  const n = Number(rule.value);
  if (rule.ruleKind === "rate") return `${(n * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
  return `${rule.currency ?? ""} ${n.toLocaleString()}`.trim();
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function RuleCard({ rule, onDone }: { rule: StatutoryRuleView; onDone: (msg: string | null) => void }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const ratify = () => start(async () => {
    const res = await ratifyStatutoryRuleAction(rule.payrollTaxRuleId);
    onDone("error" in res ? res.error : null);
  });
  const reject = () => start(async () => {
    const res = await rejectStatutoryRuleAction(rule.payrollTaxRuleId, reason);
    if (!("error" in res)) setRejecting(false);
    onDone("error" in res ? res.error : null);
  });

  return (
    <li className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">
          {humanise(rule.taxType)} · {humanise(rule.ruleKind)}{rule.side ? ` · ${humanise(rule.side)}` : ""}
        </p>
        <p className="text-base font-bold text-[var(--dpf-text)]">{displayValue(rule)}</p>
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        {rule.jurisdictionRefId} · tax year {rule.taxYear} · from {day(rule.effectiveFrom)}
        {rule.effectiveTo ? ` to ${day(rule.effectiveTo)}` : ""} · entered by a {rule.proposedBy}
      </p>

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
          <span className="text-[var(--dpf-muted)]">No source recorded — this cannot be confirmed.</span>
        )}
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">Read {day(rule.retrievedAt)}</p>
        {rule.sourceExcerpt ? (
          <blockquote className="mt-2 border-l-2 border-[var(--dpf-border)] pl-3 text-[var(--dpf-text)]">
            {rule.sourceExcerpt}
          </blockquote>
        ) : null}
      </div>

      {rule.status === "rejected" && rule.rejectedReason ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">Rejected: {rule.rejectedReason}</p>
      ) : null}

      {rule.status === "proposed" ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <button
            type="button"
            disabled={pending || !rule.sourceUrl}
            onClick={ratify}
            className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-on-accent)] disabled:opacity-50"
          >
            Confirm figure
          </button>
          {rejecting ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <label className="sr-only" htmlFor={`reject-${rule.payrollTaxRuleId}`}>Why is this figure wrong?</label>
              <input
                id={`reject-${rule.payrollTaxRuleId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this figure wrong?"
                className="min-w-[16rem] rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1.5 text-sm text-[var(--dpf-text)]"
              />
              <button
                type="button"
                disabled={pending || reason.trim().length === 0}
                onClick={reject}
                className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setRejecting(true)}
              className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
            >
              Reject…
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function EntryForm({
  jurisdictions,
  onDone,
}: {
  jurisdictions: JurisdictionOption[];
  onDone: (msg: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    jurisdictionRefId: jurisdictions.find((j) => j.jurisdictionRefId === "TAX-JUR-US-FEDERAL")?.jurisdictionRefId
      ?? jurisdictions[0]?.jurisdictionRefId ?? "",
    taxType: "social_security",
    ruleKind: "rate" as StatutoryRuleKind,
    side: "employee_withheld",
    taxYear: String(new Date().getFullYear()),
    value: "",
    currency: "USD",
    effectiveFrom: `${new Date().getFullYear()}-01-01`,
    sourceUrl: "",
    sourceExcerpt: "",
    retrievedAt: today,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Rates are typed as the authority prints them (6.2) and stored as a fraction
  // (0.062), so nobody has to remember the convention and get it wrong by 100x.
  const submit = () => start(async () => {
    const raw = Number(form.value);
    const value = form.ruleKind === "rate" ? raw / 100 : raw;
    const res = await recordStatutoryRuleAction({
      jurisdictionRefId: form.jurisdictionRefId,
      taxType: form.taxType,
      ruleKind: form.ruleKind,
      side: form.side === "" ? null : form.side,
      taxYear: Number(form.taxYear),
      value,
      currency: form.ruleKind === "rate" ? null : form.currency || null,
      effectiveFrom: new Date(`${form.effectiveFrom}T00:00:00.000Z`).toISOString(),
      effectiveTo: null,
      sourceUrl: form.sourceUrl.trim(),
      sourceExcerpt: form.sourceExcerpt.trim(),
      retrievedAt: new Date(`${form.retrievedAt}T00:00:00.000Z`).toISOString(),
      notes: null,
    });
    if (!("error" in res)) setForm((f) => ({ ...f, value: "", sourceUrl: "", sourceExcerpt: "" }));
    onDone("error" in res ? res.error : null);
  });

  const field = "rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1.5 text-sm text-[var(--dpf-text)]";
  const label = "flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]";

  // Collapsed by default. The page's primary job is confirming what a coworker
  // researched — three groups and two buttons. Typing a figure in yourself is the
  // fallback for when no coworker could, so its ten fields stay out of the
  // default view until someone asks for them.
  return (
    <details id="statutory-entry" className="mt-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
        Enter a figure you have read yourself
      </summary>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        Same bar as a coworker&apos;s proposal: the authority&apos;s own page, and the passage that states the figure.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={label}>Jurisdiction
          <select value={form.jurisdictionRefId} onChange={set("jurisdictionRefId")} className={field}>
            {jurisdictions.map((j) => <option key={j.jurisdictionRefId} value={j.jurisdictionRefId}>{j.label}</option>)}
          </select>
        </label>
        <label className={label}>Tax
          <select value={form.taxType} onChange={set("taxType")} className={field}>
            {TAX_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
          </select>
        </label>
        <label className={label}>Kind
          <select value={form.ruleKind} onChange={set("ruleKind")} className={field}>
            {RULE_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
          </select>
        </label>
        <label className={label}>Who pays
          <select value={form.side} onChange={set("side")} className={field}>
            <option value="employee_withheld">employee (withheld)</option>
            <option value="employer_contribution">employer</option>
            <option value="">not side-specific</option>
          </select>
        </label>
        <label className={label}>{form.ruleKind === "rate" ? "Rate (%)" : "Amount"}
          <input inputMode="decimal" value={form.value} onChange={set("value")} className={field}
            placeholder={form.ruleKind === "rate" ? "6.2" : "176100"} />
        </label>
        <label className={label}>Tax year
          <input inputMode="numeric" value={form.taxYear} onChange={set("taxYear")} className={field} />
        </label>
        <label className={label}>Effective from
          <input type="date" value={form.effectiveFrom} onChange={set("effectiveFrom")} className={field} />
        </label>
        <label className={label}>Read on
          <input type="date" value={form.retrievedAt} onChange={set("retrievedAt")} className={field} />
        </label>
        <label className={`${label} sm:col-span-2 lg:col-span-1`}>Source URL
          <input type="url" value={form.sourceUrl} onChange={set("sourceUrl")} className={field}
            placeholder="https://www.irs.gov/…" />
        </label>
        <label className={`${label} sm:col-span-2 lg:col-span-3`}>Passage that states the figure
          <textarea value={form.sourceExcerpt} onChange={set("sourceExcerpt")} rows={3} className={field} />
        </label>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !form.value || !form.sourceUrl.trim() || !form.sourceExcerpt.trim()}
        className="mt-3 rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-on-accent)] disabled:opacity-50"
      >
        Record and confirm
      </button>
    </details>
  );
}

export function StatutoryRatesPanel({
  rules,
  jurisdictions,
}: {
  rules: StatutoryRuleView[];
  jurisdictions: JurisdictionOption[];
}) {
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
        <p role="alert" className="mt-4 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-sm text-[var(--dpf-text)]">
          {message}
        </p>
      ) : null}
      {group("Waiting for you", proposed, "Nothing is waiting. A coworker's researched figure appears here for you to check.", "statutory-waiting")}
      {group("Confirmed — in use by payroll", ratified, "No figure is confirmed yet, so payroll cannot compute these taxes.")}
      {rejected.length > 0 ? group("Rejected", rejected, "") : null}
      <EntryForm jurisdictions={jurisdictions} onDone={setMessage} />
    </div>
  );
}
