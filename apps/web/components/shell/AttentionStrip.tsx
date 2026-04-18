// apps/web/components/shell/AttentionStrip.tsx
import Link from "next/link";

type AttentionItem = {
  id: string;
  label: string;
  description: string;
  href: string;
};

type Props = { items: AttentionItem[] };

export function AttentionStrip({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 mb-5">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2.5"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--dpf-warning)]">●</span>
            <span className="text-sm text-[var(--dpf-text)]">{item.label}</span>
            <span className="text-xs text-[var(--dpf-muted)]">{item.description}</span>
          </div>
          <Link href={item.href} className="text-xs text-[var(--dpf-accent)] hover:underline">
            Review →
          </Link>
        </div>
      ))}
    </div>
  );
}
