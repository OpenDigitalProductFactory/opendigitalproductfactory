"use client";

import { useState, useTransition } from "react";

import {
  addPrivatePathRule,
  removePrivatePathRule,
  type PrivatePathRuleView,
} from "@/lib/actions/platform-dev-config";

// Private-paths editor (EP-1A78BAE1). Operator-only surface to manage glob
// rules that mark paths as proprietary — they are never shared at public-hive
// egress, regardless of a change's Keep/Share decision.

export function PrivatePathsEditor({ rules }: { rules: PrivatePathRuleView[] }) {
  const [pattern, setPattern] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    setError(null);
    startTransition(async () => {
      const res = await addPrivatePathRule(pattern, reason);
      if (!res.ok) {
        setError(res.error ?? "Could not add the rule.");
        return;
      }
      setPattern("");
      setReason("");
    });
  };

  const handleRemove = (id: string) => {
    startTransition(async () => {
      await removePrivatePathRule(id);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Keep these paths private</h3>
        <p className="text-xs text-[var(--dpf-muted)]">
          Files matching these patterns are never shared with the community, no matter what you
          choose when shipping a change. One gitignore-style pattern per rule (e.g.{" "}
          <span className="font-mono">proprietary/</span> or{" "}
          <span className="font-mono">**/*.secret</span>). These merge with the built-in{" "}
          <span className="font-mono">.dpf/private-paths</span> list.
        </p>
      </div>

      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5"
            >
              <div className="min-w-0">
                <span className="font-mono text-xs text-[var(--dpf-text)]">{r.pattern}</span>
                {r.reason && (
                  <span className="ml-2 text-xs text-[var(--dpf-muted)] truncate">— {r.reason}</span>
                )}
              </div>
              <button
                onClick={() => handleRemove(r.id)}
                disabled={isPending}
                className="text-xs text-[var(--dpf-accent)] hover:underline shrink-0"
                data-testid="remove-private-path"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1">Pattern</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => { setPattern(e.target.value); setError(null); }}
            placeholder="proprietary/ or **/*.secret"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none font-mono"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this stays private"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={isPending || !pattern.trim()}
          className={[
            "rounded px-4 py-1.5 text-sm font-medium transition-colors shrink-0",
            isPending || !pattern.trim()
              ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
              : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
          ].join(" ")}
        >
          Add
        </button>
      </div>

      {error && <p className="text-xs text-[var(--dpf-accent)]">{error}</p>}
    </div>
  );
}
