"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  publishKnowledgeArticle,
  confirmKnowledgeArticleReview,
  archiveKnowledgeArticle,
} from "@/lib/actions/knowledge";

export function KnowledgeArticleActions({
  articleId,
  status,
}: {
  articleId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: (id: string) => Promise<void>) {
    setBusy(true);
    try {
      await action(articleId);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const btnCls =
    "text-[10px] px-2.5 py-1 rounded border transition-colors disabled:opacity-50";

  return (
    <div className="flex gap-1.5 flex-shrink-0">
      {(status === "draft" || status === "review-needed") && (
        <button
          onClick={() => run(publishKnowledgeArticle)}
          disabled={busy}
          className={btnCls + " border-green-600/40 text-green-400 hover:bg-green-600/10"}
        >
          Publish
        </button>
      )}
      {status === "published" && (
        <button
          onClick={() => run(confirmKnowledgeArticleReview)}
          disabled={busy}
          className={btnCls + " border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"}
        >
          Confirm Current
        </button>
      )}
      {status !== "archived" && (
        <button
          onClick={() => run(archiveKnowledgeArticle)}
          disabled={busy}
          className={btnCls + " border-red-600/40 text-red-400 hover:bg-red-600/10"}
        >
          Archive
        </button>
      )}
    </div>
  );
}
