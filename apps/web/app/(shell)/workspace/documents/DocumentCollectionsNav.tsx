// Collections on the documents page (BI-957915CB): "All documents", then each
// collection the viewer may read, then a disclosure to create one. A
// collection is a document of kind "collection"; choosing one filters the
// list to its readable members and files new uploads in it.

import Link from "next/link";
import { FolderOpen, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { getT } from "@/lib/i18n/t.server";
import { createCollectionAction } from "./actions";

type Props = {
  collections: ReadonlyArray<{ documentId: string; title: string }>;
  activeCollectionId: string | null;
};

function chipClass(active: boolean): string {
  return [
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs",
    active
      ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
      : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
  ].join(" ");
}

export async function DocumentCollectionsNav({ collections, activeCollectionId }: Props) {
  const t = await getT("documents");
  return (
    <nav aria-label={t("collections.navLabel")} className="flex flex-wrap items-start gap-2">
      <Link href="/workspace/documents" className={chipClass(activeCollectionId === null)} aria-current={activeCollectionId === null ? "page" : undefined}>
        {t("collections.all")}
      </Link>
      {collections.map((collection) => {
        const active = collection.documentId === activeCollectionId;
        return (
          <Link
            key={collection.documentId}
            href={`/workspace/documents?collection=${encodeURIComponent(collection.documentId)}`}
            className={chipClass(active)}
            aria-current={active ? "page" : undefined}
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {collection.title}
          </Link>
        );
      })}
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("collections.new")}
        </summary>
        <Surface padding="sm" className="mt-2">
        <form action={createCollectionAction} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="collection-title">{t("collections.nameLabel")}</label>
          <input
            id="collection-title"
            name="title"
            required
            maxLength={200}
            placeholder={t("collections.namePlaceholder")}
            className="h-9 min-w-0 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)] outline-none placeholder:text-[var(--dpf-muted)]"
          />
          <label className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <input type="checkbox" name="restricted" value="1" />
            {t("collections.onlyMe")}
          </label>
          <Button type="submit" size="sm">{t("collections.create")}</Button>
        </form>
        </Surface>
      </details>
    </nav>
  );
}
