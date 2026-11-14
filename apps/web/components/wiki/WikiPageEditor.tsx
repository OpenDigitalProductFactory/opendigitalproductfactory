"use client";
// EP-WIKI-001 Phase 6b: client-side editor form for wiki overlay pages.
// Talks to `saveWikiOverlayEdit` server action; surfaces typed errors
// inline; redirects to the viewer route on success.
//
// BI-2F7BE778 (spec 2026-10-14 knowledge-linking §7) adds, without changing
// what a save does:
//   - `[[` link autocomplete in the body (WikiBodyField, shared Combobox);
//   - a dangling-link list, checked by the shared resolver lint uses
//     (lib/wiki/link-resolution.ts) against the slug set the route passes once;
//     a save with unresolved links first shows the wiki_lint message and saves
//     on the second press;
//   - a preview rendered by WikiBodyRenderer, the viewer's own renderer:
//     a Write/Preview toggle on narrow screens, side by side from `lg` up.

import { useDeferredValue, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import {
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  type WikiPageKind,
  type WikiPageStatus,
} from "@dpf/db/wiki-store";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { cx, fieldControlClass, fieldHintClass, fieldOptionClass } from "@/components/ui/form/styles";
import { useT } from "@/lib/i18n/use-t";
import { danglingLinks, type DanglingLink } from "@/lib/wiki/link-resolution";

import { WikiBodyField } from "./WikiBodyField";
import { WikiBodyRenderer } from "./WikiBodyRenderer";

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
  /**
   * Shown above the form when the editor opens with a prepared change, e.g.
   * "Link it" from the backlinks panel (BI-4EAFF7AC). Nothing is saved until
   * the person saves.
   */
  notice?: string | null;
  initialChangeSummary?: string;
  /**
   * The slugs a link on this page resolves against, by the dangling-xref lint
   * rule (BI-2F7BE778). Loaded once by the route.
   */
  knownSlugs: readonly string[];
};

const DANGLING_DEBOUNCE_MS = 400;

const labelClass = "block text-xs font-medium text-[var(--dpf-muted)]";

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function WikiPageEditor(props: WikiPageEditorProps): ReactNode {
  const t = useT("wiki");
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [body, setBody] = useState(props.initialBody);
  const [status, setStatus] = useState<WikiPageStatus>(props.initialStatus);
  const [pageKind, setPageKind] = useState<WikiPageKind>(props.initialPageKind);
  const [abstract, setAbstract] = useState(props.initialAbstract ?? "");
  const [changeSummary, setChangeSummary] = useState(props.initialChangeSummary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"write" | "preview">("write");
  const [heldFor, setHeldFor] = useState<DanglingLink[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const slugSet = useMemo(() => new Set(props.knownSlugs), [props.knownSlugs]);
  const settledBody = useDebounced(body, DANGLING_DEBOUNCE_MS);
  const dangling = useMemo(() => danglingLinks(settledBody, slugSet), [settledBody, slugSet]);
  const previewBody = useDeferredValue(body);

  // A held save is released once the links it warned about are fixed.
  useEffect(() => {
    if (heldFor && danglingLinks(body, slugSet).length === 0) setHeldFor(null);
  }, [body, heldFor, slugSet]);

  function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    const unresolved = danglingLinks(body, slugSet);
    if (unresolved.length > 0 && heldFor === null) {
      // The rule is lint's and is unchanged; the author sees its verdict before saving.
      setHeldFor(unresolved);
      return;
    }
    setHeldFor(null);
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
      router.push(`/coworker-decisions/${props.initialSlug}`);
      router.refresh();
    });
  }

  const viewerHref = `/coworker-decisions/${props.initialSlug}`;
  const heldTargets = heldFor ? [...new Set(heldFor.map((link) => link.slug))].join(", ") : "";

  return (
    <article className="mx-auto max-w-6xl px-4 py-6">
      <nav className="mb-3 text-xs text-[var(--dpf-muted)]">
        <a href={viewerHref} className="hover:underline">
          ← {t("editor.cancel")}
        </a>
      </nav>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{t(`editor.titles.${props.mode}`)}</h1>
        <p className="mt-1 font-mono text-xs text-[var(--dpf-muted)]">{props.initialSlug}</p>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">{t(`editor.helpers.${props.mode}`)}</p>
        {props.notice ? (
          <Surface level={2} rounded="md" padding="none" role="status" className="mt-3 px-3 py-2 text-sm text-[var(--dpf-text)]">
            {props.notice}
          </Surface>
        ) : null}
      </header>

      {error ? <FormStatus error={error} className="mb-4" /> : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset className="space-y-1">
          <label htmlFor="wiki-title" className={labelClass}>
            {t("editor.fields.title")}
          </label>
          <input
            id="wiki-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={fieldControlClass}
          />
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="wiki-kind" className={labelClass}>
              {t("editor.fields.kind")}
            </label>
            <select
              id="wiki-kind"
              value={pageKind}
              onChange={(e) => setPageKind(e.target.value as WikiPageKind)}
              disabled={props.pageKindReadOnly}
              className={cx(fieldControlClass, "disabled:opacity-50")}
            >
              {WIKI_PAGE_KINDS.map((k) => (
                <option key={k} value={k} className={fieldOptionClass}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="wiki-status" className={labelClass}>
              {t("editor.fields.status")}
            </label>
            <select
              id="wiki-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as WikiPageStatus)}
              className={fieldControlClass}
            >
              {WIKI_PAGE_STATUSES.map((s) => (
                <option key={s} value={s} className={fieldOptionClass}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="space-y-1">
          <label htmlFor="wiki-abstract" className={labelClass}>
            {t("editor.fields.abstract")}
          </label>
          <textarea
            id="wiki-abstract"
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            rows={2}
            aria-describedby="wiki-abstract-hint"
            className={fieldControlClass}
          />
          <p id="wiki-abstract-hint" className={fieldHintClass}>
            {t("editor.fields.abstractHint")}
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="wiki-body" className={labelClass}>
              {t("editor.fields.body")}
            </label>
            <div role="group" aria-label={t("editor.view.label")} className="flex gap-1 lg:hidden">
              <Button type="button" size="sm" variant={view === "write" ? "secondary" : "ghost"} aria-pressed={view === "write"} onClick={() => setView("write")}>
                {t("editor.view.write")}
              </Button>
              <Button type="button" size="sm" variant={view === "preview" ? "secondary" : "ghost"} aria-pressed={view === "preview"} onClick={() => setView("preview")}>
                {t("editor.view.preview")}
              </Button>
            </div>
          </div>
          <p id="wiki-body-hint" className={fieldHintClass}>
            {t("editor.fields.bodyHint")}
          </p>
          <div className="lg:grid lg:grid-cols-2 lg:gap-4">
            <section aria-label={t("editor.view.write")} className={cx(view === "preview" && "hidden", "lg:block")}>
              <WikiBodyField id="wiki-body" value={body} onChange={setBody} fromSlug={props.initialSlug} describedBy="wiki-body-hint" />
            </section>
            <Surface
              as="section"
              aria-label={t("editor.view.preview")}
              rounded="md"
              className={cx(view === "write" && "hidden", "lg:block max-h-[44rem] overflow-y-auto")}
            >
              {previewBody.trim().length > 0 ? (
                <WikiBodyRenderer body={previewBody} />
              ) : (
                <p className="text-sm text-[var(--dpf-muted)]">{t("editor.view.previewEmpty")}</p>
              )}
            </Surface>
          </div>
          {dangling.length > 0 ? <DanglingLinkList links={dangling} /> : null}
        </fieldset>

        <fieldset className="space-y-1">
          <label htmlFor="wiki-change-summary" className={labelClass}>
            {t("editor.fields.changeSummary")}
          </label>
          <input
            id="wiki-change-summary"
            type="text"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder={t("editor.fields.changeSummaryPlaceholder")}
            aria-describedby="wiki-change-summary-hint"
            className={fieldControlClass}
          />
          <p id="wiki-change-summary-hint" className={fieldHintClass}>
            {t("editor.fields.changeSummaryHint")}
          </p>
        </fieldset>

        {heldFor ? (
          <div role="alert" className="rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]">
            <p>{t("editor.dangling.lintMessage")}</p>
            <p className="font-mono text-xs">{t("editor.dangling.targets", { targets: heldTargets })}</p>
            <p className="text-xs text-[var(--dpf-muted)]">{t("editor.dangling.saveHint")}</p>
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? t("editor.saving") : heldFor ? t("editor.saveAnyway") : t("editor.save")}
          </Button>
          <a href={viewerHref} className="text-xs text-[var(--dpf-muted)] hover:underline">
            {t("editor.cancel")}
          </a>
        </div>
      </form>
    </article>
  );
}

function DanglingLinkList({ links }: { links: DanglingLink[] }) {
  const t = useT("wiki");
  return (
    <section aria-labelledby="wiki-dangling-heading" className="rounded-md border border-[var(--dpf-warning)] px-3 py-2">
      <h2 id="wiki-dangling-heading" className="text-xs font-semibold text-[var(--dpf-text)]">
        {t("editor.dangling.heading")}
      </h2>
      <ul className="mt-1 space-y-0.5">
        {links.map((link) => (
          <li key={`${link.line}:${link.slug}`} className="flex gap-2 text-xs text-[var(--dpf-text)]">
            <span className="shrink-0 text-[var(--dpf-muted)]">{t("editor.dangling.line", { line: String(link.line) })}</span>
            <span className="font-mono">{link.slug}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
