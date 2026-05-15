"use client";
// EP-WIKI-001 Phase 6b: client-side editor form for wiki overlay pages.
// Talks to `saveWikiOverlayEdit` server action; surfaces typed errors
// inline; redirects to the viewer route on success.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import {
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  type WikiPageKind,
  type WikiPageStatus,
} from "@dpf/db/wiki-store";

export type WikiPageEditorProps = {
  mode: "create" | "update" | "override";
  /** Existing overlay row id; required when mode === "update". */
  pageId?: string;
  /** Kernel row id being overridden; required when mode === "override". */
  overridesKernelPageId?: string;
  initialSlug: string;
  initialTitle: string;
  initialBody: string;
  initialPageKind: WikiPageKind;
  initialStatus: WikiPageStatus;
  initialAbstract?: string | null;
  /**
   * When true the form renders the page kind as read-only — used on
   * update and override modes where the kind is determined by the row /
   * the kernel page it overrides.
   */
  pageKindReadOnly?: boolean;
};

const MODE_TITLES: Record<WikiPageEditorProps["mode"], string> = {
  create: "New wiki page",
  update: "Edit page",
  override: "Override kernel page",
};

const MODE_HELPERS: Record<WikiPageEditorProps["mode"], string> = {
  create: "Creates a new org-scoped overlay page. It will appear on /wiki?status=all until you flip status to Published.",
  update: "Saves a new revision on this overlay page. The viewer route revalidates on save.",
  override:
    "Creates an org override for this kernel page. The override masks the kernel content for your org only; kernel content is untouched.",
};

export function WikiPageEditor(props: WikiPageEditorProps): ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [body, setBody] = useState(props.initialBody);
  const [status, setStatus] = useState<WikiPageStatus>(props.initialStatus);
  const [pageKind, setPageKind] = useState<WikiPageKind>(props.initialPageKind);
  const [abstract, setAbstract] = useState(props.initialAbstract ?? "");
  const [changeSummary, setChangeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveWikiOverlayEdit({
        slug: props.initialSlug,
        pageKind,
        title,
        body,
        status,
        abstract: abstract.trim().length > 0 ? abstract : null,
        pageId: props.mode === "update" ? props.pageId : undefined,
        overridesKernelPageId:
          props.mode === "override" ? props.overridesKernelPageId : undefined,
        changeSummary: changeSummary.trim().length > 0 ? changeSummary : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/wiki/${props.initialSlug}`);
      router.refresh();
    });
  }

  return (
    <article className="max-w-3xl mx-auto py-6 px-4">
      <nav className="mb-3 text-xs text-[var(--dpf-muted)]">
        <a href={`/wiki/${props.initialSlug}`} className="hover:underline">
          ← Cancel
        </a>
      </nav>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">
          {MODE_TITLES[props.mode]}
        </h1>
        <p className="mt-1 text-xs text-[var(--dpf-muted)] font-mono">
          {props.initialSlug}
        </p>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          {MODE_HELPERS[props.mode]}
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset className="space-y-1">
          <label
            htmlFor="wiki-title"
            className="block text-xs font-medium text-[var(--dpf-muted)]"
          >
            Title
          </label>
          <input
            id="wiki-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          />
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label
              htmlFor="wiki-kind"
              className="block text-xs font-medium text-[var(--dpf-muted)]"
            >
              Kind
            </label>
            <select
              id="wiki-kind"
              value={pageKind}
              onChange={(e) => setPageKind(e.target.value as WikiPageKind)}
              disabled={props.pageKindReadOnly}
              className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-2 text-sm text-[var(--dpf-text)] disabled:opacity-50"
            >
              {WIKI_PAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="wiki-status"
              className="block text-xs font-medium text-[var(--dpf-muted)]"
            >
              Status
            </label>
            <select
              id="wiki-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as WikiPageStatus)}
              className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-2 text-sm text-[var(--dpf-text)]"
            >
              {WIKI_PAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="space-y-1">
          <label
            htmlFor="wiki-abstract"
            className="block text-xs font-medium text-[var(--dpf-muted)]"
          >
            Abstract <span className="text-[var(--dpf-muted)] opacity-60">(optional, 1–2 sentences shown under the title)</span>
          </label>
          <textarea
            id="wiki-abstract"
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            rows={2}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          />
        </fieldset>

        <fieldset className="space-y-1">
          <label
            htmlFor="wiki-body"
            className="block text-xs font-medium text-[var(--dpf-muted)]"
          >
            Body (Markdown — uses `[[wiki/path]]` and `[[raw-sources/...]]` for cross-links)
          </label>
          <textarea
            id="wiki-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={28}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] font-mono"
          />
        </fieldset>

        <fieldset className="space-y-1">
          <label
            htmlFor="wiki-change-summary"
            className="block text-xs font-medium text-[var(--dpf-muted)]"
          >
            Change summary <span className="opacity-60">(optional — appears in the revision log)</span>
          </label>
          <input
            id="wiki-change-summary"
            type="text"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder="e.g. clarified the principleDirection sentence"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          />
        </fieldset>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <a
            href={`/wiki/${props.initialSlug}`}
            className="text-xs text-[var(--dpf-muted)] hover:underline"
          >
            Cancel
          </a>
        </div>
      </form>
    </article>
  );
}
