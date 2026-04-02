import { KnowledgeArticleCard, type KnowledgeArticleSummary } from "./KnowledgeArticleCard";

export function KnowledgeArticleList({
  articles,
  emptyMessage,
}: {
  articles: KnowledgeArticleSummary[];
  emptyMessage?: string;
}) {
  if (articles.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)]">
          {emptyMessage ?? "No knowledge articles found."}
        </p>
      </div>
    );
  }

  // Group by category
  const groups = new Map<string, KnowledgeArticleSummary[]>();
  for (const a of articles) {
    const key = a.category;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  // Sort groups by count descending
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <div className="text-xs text-[var(--dpf-muted)] mb-4">
        {articles.length} article{articles.length !== 1 ? "s" : ""}
      </div>
      {sorted.map(([category, items]) => (
        <div key={category} className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            {category} ({items.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((article) => (
              <KnowledgeArticleCard key={article.id} article={article} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
