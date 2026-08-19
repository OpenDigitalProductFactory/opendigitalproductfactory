import Link from "next/link";

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { StackCurrencyTable } from "@/components/ops/StackCurrencyTable";
import {
  assessPlatformStack,
  stackCurrencySummary,
  ACTIONABLE_CURRENCIES,
} from "@/lib/operate/platform-stack";

// Computed from live dates on each request — never statically cached.
export const dynamic = "force-dynamic";

export default async function StackCurrencyPage() {
  const assessed = assessPlatformStack();
  const summary = stackCurrencySummary(assessed);
  const actionable = assessed.filter((c) => ACTIONABLE_CURRENCIES.includes(c.currency));
  const unsourced = summary.unsourced;

  return (
    <div>
      <OpsTabNav />

      <div className="mt-4 mb-2">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Platform stack currency</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          The technology lifecycle this platform is <em>subject to</em> — our own runtimes and
          frameworks, on the canonical Currency axis. This is distinct from the discovered customer
          estate under{" "}
          <Link href="/ops/patches" className="text-[var(--dpf-accent)] hover:underline">
            Patches
          </Link>
          .
        </p>
      </div>

      {actionable.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
          <p className="text-sm text-[var(--dpf-text)]">
            {actionable.length} component{actionable.length === 1 ? "" : "s"} need an upgrade path —
            approaching or past end of life. Track them in the upgrade roadmap.
          </p>
        </div>
      )}

      <StackCurrencyTable rows={assessed} />

      {unsourced > 0 && (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          {unsourced} component{unsourced === 1 ? " has" : "s have"} no recorded support/EOL date.
          Record one (or wire an end-of-life feed) to track its currency.
        </p>
      )}
    </div>
  );
}
