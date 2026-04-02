const CATEGORY_COLOURS: Record<string, string> = {
  process: "#60a5fa",
  policy: "#a78bfa",
  decision: "#fbbf24",
  "how-to": "#4ade80",
  reference: "#8888a0",
  troubleshooting: "#f87171",
  runbook: "#fb923c",
};

export function KnowledgeCategoryBadge({ category }: { category: string }) {
  const colour = CATEGORY_COLOURS[category] ?? "#8888a0";
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
      style={{ backgroundColor: colour + "22", color: colour }}
    >
      {category}
    </span>
  );
}
