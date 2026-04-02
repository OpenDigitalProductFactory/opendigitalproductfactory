"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createKnowledgeArticle } from "@/lib/actions/knowledge";

const CATEGORIES = [
  "process",
  "policy",
  "decision",
  "how-to",
  "reference",
  "troubleshooting",
  "runbook",
] as const;

const VALUE_STREAMS = [
  "evaluate",
  "explore",
  "integrate",
  "deploy",
  "release",
  "operate",
  "consume",
] as const;

type Product = { id: string; productId: string; name: string };
type Portfolio = { id: string; slug: string; name: string };

export function KnowledgeArticleForm({
  products,
  portfolios,
  defaultProductId,
  defaultPortfolioId,
}: {
  products: Product[];
  portfolios: Portfolio[];
  defaultProductId?: string;
  defaultPortfolioId?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("reference");
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    defaultProductId ? [defaultProductId] : [],
  );
  const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>(
    defaultPortfolioId ? [defaultPortfolioId] : [],
  );
  const [selectedStreams, setSelectedStreams] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [reviewDays, setReviewDays] = useState(90);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const id = await createKnowledgeArticle({
        title,
        body,
        category,
        reviewIntervalDays: reviewDays,
        valueStreams: selectedStreams,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        productIds: selectedProducts,
        portfolioIds: selectedPortfolios,
      });
      router.push(`/knowledge`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create article");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-2 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]";
  const labelCls = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="text-xs text-red-400 px-3 py-2 rounded bg-red-400/10 border border-red-400/30">
          {error}
        </div>
      )}

      <div>
        <label className={labelCls}>Title</label>
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Article title"
        />
      </div>

      <div>
        <label className={labelCls}>Category</label>
        <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Body (Markdown)</label>
        <textarea
          className={inputCls + " min-h-[200px] font-mono"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={12}
          placeholder="Article content in markdown..."
        />
      </div>

      <div>
        <label className={labelCls}>Linked Products</label>
        <div className="flex flex-wrap gap-2">
          {products.map((p) => {
            const selected = selectedProducts.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setSelectedProducts((prev) =>
                    selected ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                  )
                }
                className={[
                  "text-[10px] px-2 py-1 rounded-full border transition-colors",
                  selected
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent)]10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelCls}>Linked Portfolios</label>
        <div className="flex flex-wrap gap-2">
          {portfolios.map((p) => {
            const selected = selectedPortfolios.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setSelectedPortfolios((prev) =>
                    selected ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                  )
                }
                className={[
                  "text-[10px] px-2 py-1 rounded-full border transition-colors",
                  selected
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent)]10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelCls}>IT4IT Value Streams</label>
        <div className="flex flex-wrap gap-2">
          {VALUE_STREAMS.map((vs) => {
            const selected = selectedStreams.includes(vs);
            return (
              <button
                key={vs}
                type="button"
                onClick={() =>
                  setSelectedStreams((prev) =>
                    selected ? prev.filter((x) => x !== vs) : [...prev, vs],
                  )
                }
                className={[
                  "text-[10px] px-2 py-1 rounded-full border transition-colors",
                  selected
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent)]10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                {vs}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Tags (comma-separated)</label>
          <input
            className={inputCls}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="security, compliance, sla"
          />
        </div>
        <div>
          <label className={labelCls}>Review Interval (days)</label>
          <input
            className={inputCls}
            type="number"
            min={7}
            max={365}
            value={reviewDays}
            onChange={(e) => setReviewDays(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || !title || !body}
          className="text-xs px-4 py-2 rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Create Draft"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xs px-4 py-2 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
