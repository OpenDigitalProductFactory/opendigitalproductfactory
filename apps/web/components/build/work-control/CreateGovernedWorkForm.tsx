"use client";

import { GitBranch } from "lucide-react";
import { useRef, useState, useTransition } from "react";

type Taxonomy = "feat" | "fix" | "chore" | "doc" | "clean";

export type CreateGovernedWorkAction = (input: {
  title: string;
  objective: string;
  taxonomy: Taxonomy;
  idempotencyKey: string;
}) => Promise<{ capsuleId: string; headBranch: string | null; worktreePath: string | null }>;

const TAXONOMY_OPTIONS: Taxonomy[] = ["feat", "fix", "chore", "doc", "clean"];

function nextIdempotencyKey(): string {
  return `ui:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function CreateGovernedWorkForm({ action }: { action: CreateGovernedWorkAction }) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [taxonomy, setTaxonomy] = useState<Taxonomy>("feat");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<CreateGovernedWorkAction>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef(nextIdempotencyKey());

  return (
    <section className="space-y-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Plan governed work</h2>
      </div>

      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const idempotencyKey = idempotencyKeyRef.current;
          startTransition(() => {
            void action({ title, objective, taxonomy, idempotencyKey })
              .then((out) => {
                setResult(out);
                setTitle("");
                setObjective("");
                idempotencyKeyRef.current = nextIdempotencyKey();
              })
              .catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : "Could not plan governed work.");
              });
          });
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]">
          <span>Title</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]">
          <span>Taxonomy</span>
          <select
            value={taxonomy}
            onChange={(event) => setTaxonomy(event.target.value as Taxonomy)}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
          >
            {TAXONOMY_OPTIONS.map((option) => (
              <option key={option} value={option} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)] md:col-span-2">
          <span>Objective</span>
          <textarea
            required
            rows={3}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            className="resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            {pending ? "Planning" : "Plan governed work"}
          </button>
          {result ? (
            <a
              href={`/build/work/${result.capsuleId}`}
              className="text-sm font-medium text-[var(--dpf-accent)] hover:underline"
            >
              Planned {result.capsuleId}
            </a>
          ) : null}
          {error ? <span className="text-sm text-[var(--dpf-muted)]">{error}</span> : null}
        </div>
      </form>
    </section>
  );
}
