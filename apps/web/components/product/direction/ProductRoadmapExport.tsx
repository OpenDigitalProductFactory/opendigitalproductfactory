"use client";

import type { ProductRoadmapSnapshot } from "@/lib/product-management/product-roadmap";

export function ProductRoadmapExport({
  snapshot,
  fileName,
}: {
  snapshot: ProductRoadmapSnapshot;
  fileName: string;
}) {
  function download() {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
    >
      Download current snapshot
    </button>
  );
}
