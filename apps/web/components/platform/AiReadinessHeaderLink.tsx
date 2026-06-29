import Link from "next/link";

export function AiReadinessHeaderLink() {
  return (
    <Link
      href="/platform/ai/readiness"
      className="inline-flex items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
    >
      AI Readiness
    </Link>
  );
}
