const CATEGORY_COLOURS: Record<string, string> = {
  process: "#60a5fa",
  policy: "var(--dpf-accent)",
  decision: "var(--dpf-warning)",
  "how-to": "var(--dpf-success)",
  reference: "var(--dpf-muted)",
  troubleshooting: "var(--dpf-error)",
  runbook: "#fb923c",
};

export function KnowledgeCategoryBadge({ category }: { category: string }) {
  const colour = CATEGORY_COLOURS[category] ?? "var(--dpf-muted)";
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${colour} 13%, transparent)`, color: colour }}
    >
      {category}
    </span>
  );
}
