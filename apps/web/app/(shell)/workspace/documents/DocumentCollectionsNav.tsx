// Collections on the documents page (BI-957915CB): "All documents", then each
// collection the viewer may read, then a disclosure to create one. A
// collection is a document of kind "collection"; choosing one filters the
// list to its readable members and files new uploads in it.

import Link from "next/link";
import { FolderOpen, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
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

export function DocumentCollectionsNav({ collections, activeCollectionId }: Props) {
  return (
    <nav aria-label="Collections" className="flex flex-wrap items-start gap-2">
      <Link href="/workspace/documents" className={chipClass(activeCollectionId === null)} aria-current={activeCollectionId === null ? "page" : undefined}>
        All documents
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
          New collection
        </summary>
        <form action={createCollectionAction} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <label className="sr-only" htmlFor="collection-title">Collection name</label>
          <input
            id="collection-title"
            name="title"
            required
            maxLength={200}
            placeholder="Collection name"
            className="h-9 min-w-0 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)] outline-none placeholder:text-[var(--dpf-muted)]"
          />
          <label className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <input type="checkbox" name="restricted" value="1" />
            Only me
          </label>
          <Button type="submit" size="sm">Create</Button>
        </form>
      </details>
    </nav>
  );
}
