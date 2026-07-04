"use client";
// EP-0AF96937 Phase 4: WSID craft-override authoring form for one profession.
// Progressive disclosure — a plain "what's your local practice" form, saved as
// a draft org-overlay page scoped to the profession. The professionKey is fixed
// by the page context (not a field the user picks).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveCraftOverride } from "@/lib/actions/craft-override";

export function CraftOverrideForm({
  professionKey,
  professionLabel,
}: {
  professionKey: string;
  professionLabel: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveCraftOverride({ professionKey, title, body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTitle("");
      setBody("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <p className="text-sm font-medium text-[var(--dpf-text)] mb-3">
        Add your own practice for {professionLabel}
      </p>

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="craft-title">
        The practice, in a few words
      </label>
      <input
        id="craft-title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Always partition large tables by tenant"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      <label className="block text-xs text-[var(--dpf-muted)] mb-1" htmlFor="craft-body">
        How this role should do it here
      </label>
      <textarea
        id="craft-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Any table expected to exceed 10M rows is partitioned by tenant id, because our largest customers dominate query cost."
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-3"
      />

      {error && (
        <p className="text-xs text-[var(--dpf-error)] mb-3" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-xs text-[var(--dpf-success)] mb-3">
          Saved as a draft. Publish it to make it part of this role&rsquo;s craft.
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
          Extends the platform baseline for your org only.
        </span>
      </div>
    </form>
  );
}
