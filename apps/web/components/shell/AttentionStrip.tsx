// apps/web/components/shell/AttentionStrip.tsx
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
          className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--dpf-surface-1)] border border-[#2a3a6a]"
        >
          <div className="flex items-center gap-3">
            <span className="text-pink-400 text-xs">●</span>
            <span className="text-sm text-gray-200">{item.label}</span>
            <span className="text-xs text-[var(--dpf-muted)]">{item.description}</span>
          </div>
          <a href={item.href} className="text-xs text-[var(--dpf-accent)] hover:underline">
            Review →
          </a>
        </div>
      ))}
    </div>
  );
}
