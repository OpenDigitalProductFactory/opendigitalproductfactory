"use client";

// apps/web/components/finance/BankRulesManager.tsx

import { useState } from "react";
import { createBankRule, deleteBankRule } from "@/lib/actions/banking";
import type { CreateBankRuleInput } from "@/lib/banking-validation";
import { MATCH_FIELDS, MATCH_TYPES } from "@/lib/banking-validation";

interface BankRule {
  id: string;
  name: string;
  matchField: string;
  matchType: string;
  matchValue: string;
  accountCode: string | null;
  category: string | null;
  isActive: boolean;
  hitCount: number;
}

interface Props {
  initialRules: BankRule[];
}

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-xs focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";

const labelClasses = "block text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1";

export function BankRulesManager({ initialRules }: Props) {
  const [rules, setRules] = useState<BankRule[]>(initialRules);
  const [submitting, setSubmitting] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  const [name, setName] = useState("");
  const [matchField, setMatchField] = useState<string>("description");
  const [matchType, setMatchType] = useState<string>("contains");
  const [matchValue, setMatchValue] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [category, setCategory] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !matchValue.trim()) {
      setFormError("Name and match value are required.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormSuccess(false);

    try {
      const input: CreateBankRuleInput = {
        name: name.trim(),
        matchField: matchField as CreateBankRuleInput["matchField"],
        matchType: matchType as CreateBankRuleInput["matchType"],
        matchValue: matchValue.trim(),
        accountCode: accountCode.trim() || undefined,
        category: category.trim() || undefined,
      };

      const newRule = await createBankRule(input);

      setRules((prev) =>
        [...prev, newRule as BankRule].sort((a, b) => b.hitCount - a.hitCount),
      );

      // Reset form
      setName("");
      setMatchField("description");
      setMatchType("contains");
      setMatchValue("");
      setAccountCode("");
      setCategory("");
      setFormSuccess(true);

      setTimeout(() => setFormSuccess(false), 3000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create rule.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(ruleId: string) {
    setDeleteInProgress(ruleId);
    try {
      await deleteBankRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch {
      // Silently ignore — rule stays in list
    } finally {
      setDeleteInProgress(null);
    }
  }

  return (
    <div>
      {/* New Rule Form */}
      <div className="mb-8 p-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-4">
          New Rule
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Name */}
            <div>
              <label className={labelClasses}>Rule Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AWS subscription"
                className={inputClasses}
                required
              />
            </div>

            {/* Match Field */}
            <div>
              <label className={labelClasses}>Match Field</label>
              <select
                value={matchField}
                onChange={(e) => setMatchField(e.target.value)}
                className={inputClasses}
              >
                {MATCH_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Match Type */}
            <div>
              <label className={labelClasses}>Match Type</label>
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value)}
                className={inputClasses}
              >
                {MATCH_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Match Value */}
            <div>
              <label className={labelClasses}>Match Value</label>
              <input
                type="text"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder="e.g. Amazon Web Services"
                className={inputClasses}
                required
              />
            </div>

            {/* Account Code */}
            <div>
              <label className={labelClasses}>Account Code (optional)</label>
              <input
                type="text"
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                placeholder="e.g. 7200"
                className={inputClasses}
              />
            </div>

            {/* Category */}
            <div>
              <label className={labelClasses}>Category (optional)</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. software"
                className={inputClasses}
              />
            </div>
          </div>

          {/* Form feedback */}
          {formError && (
            <p className="text-xs mb-3" style={{ color: "var(--dpf-error)" }}>
              {formError}
            </p>
          )}
          {formSuccess && (
            <p className="text-xs mb-3" style={{ color: "var(--dpf-success)" }}>
              Rule created successfully.
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Adding…" : "Add Rule"}
          </button>
        </form>
      </div>

      {/* Rules List */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Rules ({rules.length})
        </h2>

        {rules.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No rules yet. Add a rule above to start auto-categorising transactions.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Name
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Match Criteria
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Category
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Account Code
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Hits
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Status
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5 text-[var(--dpf-text)] font-medium">
                      {rule.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {rule.matchField} {rule.matchType} &apos;{rule.matchValue}&apos;
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {rule.category ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {rule.accountCode ? (
                        <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                          {rule.accountCode}
                        </span>
                      ) : (
                        <span className="text-[var(--dpf-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {rule.hitCount > 0 ? (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ color: "var(--dpf-info)", backgroundColor: "color-mix(in srgb, var(--dpf-info) 12%, transparent)" }}
                        >
                          {rule.hitCount}
                        </span>
                      ) : (
                        <span className="text-[var(--dpf-muted)]">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{
                          color: rule.isActive ? "var(--dpf-success)" : "var(--dpf-muted)",
                          backgroundColor: rule.isActive ? "color-mix(in srgb, var(--dpf-success) 12%, transparent)" : "color-mix(in srgb, var(--dpf-muted) 12%, transparent)",
                        }}
                      >
                        {rule.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(rule.id)}
                        disabled={deleteInProgress === rule.id}
                        className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] transition-colors disabled:opacity-40"
                      >
                        {deleteInProgress === rule.id ? "…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
