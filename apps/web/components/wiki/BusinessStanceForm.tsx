"use client";
// EP-0AF96937 Phase 3: the WWWD business-stance authoring form.
//
// Progressive disclosure (AGENTS.md §12): a business owner writes the question
// they want settled and how the business decides it, in plain language. No
// dimension vectors or tiers up front — the stance is saved as a draft
// org-overlay page and reviewed before it becomes active doctrine.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveBusinessStance } from "@/lib/actions/business-stance";

export function BusinessStanceForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedSlug(null);
    startTransition(async () => {
      const result = await saveBusinessStance({ title, body, summary });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedSlug(result.slug);
      setTitle("");
      setBody("");
      setSummary("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <p className="text-sm font-medium text-[var(--dpf-text)] mb-3">
        Record how your business decides something
      </p>

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="stance-title">
        The question you want settled
      </label>
      <input
        id="stance-title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="How we decide refunds"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="stance-body">
        How your business decides it
      </label>
      <textarea
        id="stance-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="We refund within 30 days, no questions asked. Beyond 30 days a manager decides based on the account relationship."
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="stance-summary">
        One-line summary <span className="text-[var(--dpf-muted)]">(optional)</span>
      </label>
      <input
        id="stance-summary"
        type="text"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="30-day no-questions refunds; manager discretion after"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      {error && (
        <p className="text-xs text-[var(--dpf-error)] mb-3" role="alert">
          {error}
        </p>
      )}
      {savedSlug && (
        <p className="text-xs text-[var(--dpf-success)] mb-3">
          Saved as a draft. Review and publish it to make it active doctrine.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[var(--dpf-accent)] px-3 py-1.5 text-sm text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save as draft"}
        </button>
        <span className="text-xs text-[var(--dpf-muted)]">
          Drafts don&rsquo;t affect decisions until you publish them.
        </span>
      </div>
    </form>
  );
}
