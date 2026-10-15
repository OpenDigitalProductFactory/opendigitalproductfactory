// apps/web/components/knowledge/knowledge-status-summary.ts
//
// What the knowledge browse page says about article status (BI-65D87B87). The
// page defaults to Published, and coworkers only ever create drafts, so an
// empty Published tab must say what exists elsewhere rather than claim the
// knowledge base is empty. Pure, so the wording is pinned by tests.

export const KNOWLEDGE_STATUS_TABS = [
  { label: "Published", value: "published" },
  { label: "Drafts", value: "draft" },
  { label: "Needs Review", value: "review-needed" },
  { label: "Archived", value: "archived" },
] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS_TABS)[number]["value"];
export type KnowledgeStatusCounts = Partial<Record<string, number>>;

export type EmptyKnowledgeView = {
  title: string;
  description: string | null;
  link: { label: string; status: KnowledgeStatus } | null;
};

/**
 * The tab counts already say what exists on every tab, so an empty tab only
 * needs a sentence in the two cases a count cannot carry: a truly empty
 * knowledge base, and an empty Published tab with drafts waiting.
 */
export function describeEmptyKnowledgeView(
  activeStatus: string,
  counts: KnowledgeStatusCounts,
): EmptyKnowledgeView {
  const total = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (total === 0) {
    return {
      title: "No knowledge articles yet",
      description: "Create the first article to start building your knowledge base.",
      link: null,
    };
  }

  const tab = KNOWLEDGE_STATUS_TABS.find((t) => t.value === activeStatus);
  const title = `Nothing in ${tab ? tab.label : activeStatus}`;
  const drafts = counts.draft ?? 0;
  if (activeStatus === "published" && drafts > 0) {
    return {
      title,
      description: `${drafts} ${drafts === 1 ? "draft is" : "drafts are"} waiting to be published.`,
      link: { label: "View drafts", status: "draft" },
    };
  }
  return { title, description: null, link: null };
}
