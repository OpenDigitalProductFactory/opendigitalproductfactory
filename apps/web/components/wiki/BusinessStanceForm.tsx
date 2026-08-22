"use client";
// EP-0AF96937 Phase 3 + BI-002DEB85: the WWWD business-stance authoring form.
//
// Progressive disclosure (AGENTS.md §12): a business owner writes the question
// they want settled and how the business decides it, in plain language. No
// dimension vectors or tiers up front. "Save as draft" keeps it inert;
// "Publish" makes it live doctrine — the page is published + embedded and an
// owner-confirmed material lands in the picked decision area, so the decision
// gate can actually act on it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { publishBusinessStance, saveBusinessStance } from "@/lib/actions/business-stance";
import { DECISION_AREAS } from "@/lib/wiki/business-stance";

type BusinessStanceFormProps = {
  examples: { title: string; body: string; summary: string };
};

export function BusinessStanceForm({ examples }: BusinessStanceFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [decisionArea, setDecisionArea] = useState<string>(DECISION_AREAS[0].key);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | { slug: string; mode: "draft" | "published" }>(null);
  const [pending, startTransition] = useTransition();

  function submit(mode: "draft" | "published") {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result =
        mode === "draft"
          ? await saveBusinessStance({ title, body, summary })
          : await publishBusinessStance({ title, body, summary, decisionArea });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ slug: result.slug, mode });
      setTitle("");
      setBody("");
      setSummary("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("draft");
      }}
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
        placeholder={examples.title}
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
        placeholder={examples.body}
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
        placeholder={examples.summary}
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="stance-area">
        What kind of decisions does this guide?
      </label>
      <select
        id="stance-area"
        value={decisionArea}
        onChange={(e) => setDecisionArea(e.target.value)}
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      >
        {DECISION_AREAS.map((area) => (
          <option key={area.key} value={area.key}>
            {area.label} — {area.hint}
          </option>
        ))}
      </select>

      {error && (
        <p className="text-xs text-[var(--dpf-error)] mb-3" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-xs text-[var(--dpf-success)] mb-3">
          {saved.mode === "published"
            ? "Published. Your AI now weighs this stance when it decides."
            : "Saved as a draft. Publish it to make it active doctrine."}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => submit("published")}
          disabled={pending}
          className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Working…" : "Publish"}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save as draft"}
        </button>
        <span className="text-xs text-[var(--dpf-muted)]">
          Publishing makes this count when your AI decides; drafts don&rsquo;t.
        </span>
      </div>
    </form>
  );
}
