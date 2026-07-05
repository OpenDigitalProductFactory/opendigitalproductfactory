import Link from "next/link";
import { scanCustomerAccountDuplicates } from "@/lib/mdm/batch-scan";

/**
 * Retroactive duplicate surface on the accounts list (BI-7BF995B9): the
 * write-time gate protects new records; this shows pairs already in the data.
 * Renders nothing when the data is clean — no standing empty panel. Resolving
 * a pair happens on the account detail page ("Merge into…"), so this stays a
 * pointer, not a second merge surface.
 */
export async function DuplicateAccountsPanel() {
  let pairs: Awaited<ReturnType<typeof scanCustomerAccountDuplicates>>;
  try {
    pairs = await scanCustomerAccountDuplicates();
  } catch {
    // Scan is advisory — never break the accounts page over it.
    return null;
  }
  if (pairs.length === 0) return null;

  const shown = pairs.slice(0, 5);
  return (
    <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
      <p className="text-xs font-semibold text-[var(--dpf-text)] mb-1.5">
        {pairs.length} possible duplicate account pair{pairs.length !== 1 ? "s" : ""} found
      </p>
      <ul className="space-y-1">
        {shown.map((p) => (
          <li key={`${p.a.id}-${p.b.id}`} className="text-xs text-[var(--dpf-muted)]">
            <Link href={`/customer/${p.a.id}`} className="text-[var(--dpf-accent)] hover:underline">
              {p.a.label}
            </Link>{" "}
            ↔{" "}
            <Link href={`/customer/${p.b.id}`} className="text-[var(--dpf-accent)] hover:underline">
              {p.b.label}
            </Link>{" "}
            — {p.recommendation === "likely-duplicate" ? "likely the same" : "possibly the same"}; open
            either account and use “Merge into…” to resolve.
          </li>
        ))}
        {pairs.length > shown.length && (
          <li className="text-xs text-[var(--dpf-muted)]">…and {pairs.length - shown.length} more.</li>
        )}
      </ul>
    </div>
  );
}
