"use client";

// BI-A63A9476: the read view of a backlog item body or epic description, with
// readable entity ids linked, followed by "Referenced by". Both come from the
// shared reader on the server (loadEntityReferenceView), so the client never
// decides what the person may open.

import { useEffect, useState, type ReactNode } from "react";

import { MarkdownHtml } from "@/components/shared/MarkdownHtml";
import { loadEntityReferenceView, type EntityReferenceView } from "@/lib/actions/entity-references";
import { useT } from "@/lib/i18n/use-t";
import type { RenderMarkdownOptions } from "@/lib/shared/markdown";

import { ReferencedByPanel, referencedByLabels } from "./ReferencedByPanel";

const BODY_OPTIONS: RenderMarkdownOptions = {
  classes: {
    p: "text-dpf-body text-[var(--dpf-text)] leading-relaxed mb-2",
    ul: "text-dpf-body text-[var(--dpf-text)] mb-2 ms-4 list-disc",
    ol: "text-dpf-body text-[var(--dpf-text)] mb-2 ms-4 list-decimal",
    a: "text-[var(--dpf-accent)] hover:underline break-all",
    code: "text-dpf-caption px-1 rounded bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]",
  },
  externalLinksInNewTab: true,
};

export function EntityReferencesSection({
  kind,
  entityKey,
  body,
  bodyOptions = BODY_OPTIONS,
  bodyHeading,
}: {
  kind: "backlog" | "epic";
  entityKey: string;
  /** The saved body to show; omit to show only "Referenced by". */
  body?: string | null;
  bodyOptions?: RenderMarkdownOptions;
  /** Label the body read view (the backlog panel, where the editable notes sit above it). */
  bodyHeading?: boolean;
}): ReactNode {
  const t = useT("references");
  const [view, setView] = useState<EntityReferenceView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    loadEntityReferenceView({ kind, key: entityKey })
      .then((next) => { if (live) setView(next); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [kind, entityKey]);

  const hrefs = view?.hrefs ?? {};
  return (
    <div className="flex flex-col gap-3">
      {body ? (
        <div>
          {bodyHeading ? <h3 className="text-dpf-caption uppercase tracking-widest text-[var(--dpf-muted)] mb-1">{t("body.heading")}</h3> : null}
          <MarkdownHtml source={body} options={{ ...bodyOptions, entityRefHref: (id) => hrefs[id] ?? null }} />
        </div>
      ) : null}
      {failed ? (
        <p className="text-dpf-caption text-[var(--dpf-muted)]">{t("referencedBy.loadFailed")}</p>
      ) : view ? (
        <ReferencedByPanel rows={view.referencedBy} labels={referencedByLabels(t as (key: string) => string)} headingId={`referenced-by-${entityKey}`} level={2} />
      ) : null}
    </div>
  );
}
