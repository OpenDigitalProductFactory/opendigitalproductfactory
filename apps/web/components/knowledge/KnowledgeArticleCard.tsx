import Link from "next/link";
import { KnowledgeCategoryBadge } from "./KnowledgeCategoryBadge";
import { StalenessIndicator } from "./StalenessIndicator";

export type KnowledgeArticleSummary = {
  id: string;
  articleId: string;
  title: string;
  body: string;
  category: string;
  status: string;
  reviewIntervalDays: number;
  lastReviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { email: string } | null;
  authorAgent: { name: string } | null;
};

export function KnowledgeArticleCard({ article }: { article: KnowledgeArticleSummary }) {
  const preview = article.body.length > 120 ? article.body.slice(0, 120) + "..." : article.body;
  const authorName = article.author?.email?.split("@")[0] ?? article.authorAgent?.name ?? "Unknown";

  return (
    <Link
      href={`/knowledge/${article.articleId}`}
      className="flex flex-col gap-1.5 px-3 py-2.5 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-[var(--dpf-text)] flex-1 line-clamp-1">
          {article.title}
        </span>
        <div className="flex gap-1 flex-shrink-0">
          <KnowledgeCategoryBadge category={article.category} />
          {article.status === "published" && (
            <StalenessIndicator
              lastReviewedAt={article.lastReviewedAt}
              createdAt={article.createdAt}
              reviewIntervalDays={article.reviewIntervalDays}
            />
          )}
          {article.status === "draft" && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
              style={{ backgroundColor: "#8888a022", color: "#8888a0" }}
            >
              draft
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[var(--dpf-muted)] line-clamp-2">{preview}</p>
      <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)] mt-auto pt-1">
        <span>{article.articleId}</span>
        <span>{authorName}</span>
        <span className="ml-auto">{article.updatedAt.toLocaleDateString()}</span>
      </div>
    </Link>
  );
}
