"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

type BuildListItemProps = {
  build: FeatureBuildRow;
  active: boolean;
  index: number;
  lifecycleLabel: string | null;
  isDevEnvironment: boolean;
  onSelect: () => void;
  onDelete: () => void;
};

function formatUpdatedAt(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function BuildListItem({
  build,
  active,
  index,
  lifecycleLabel,
  isDevEnvironment,
  onSelect,
  onDelete,
}: BuildListItemProps) {
  return (
    <div
      data-testid={BUILD_STUDIO_TEST_IDS.buildListItem}
      className="group mb-1 flex max-h-[128px] min-h-[88px] min-w-0 rounded-md border transition-all duration-150 hover:bg-[var(--dpf-surface-2)] hover:shadow-dpf-xs animate-slide-up"
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: "backwards",
        borderColor: active ? "var(--dpf-accent)" : "transparent",
        background: active ? "var(--dpf-surface-2)" : "transparent",
      }}
    >
      <button
        type="button"
        aria-label={`Open build ${build.title}`}
        aria-pressed={active}
        onClick={onSelect}
        className="min-w-0 flex-1 cursor-pointer rounded-l-md px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
      >
        <div
          title={build.title}
          className="line-clamp-2 max-h-[2.5rem] min-w-0 overflow-hidden break-words text-sm font-semibold leading-5 text-[var(--dpf-text)]"
        >
          {build.title}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--dpf-muted)]">
          <span className="font-mono">{build.buildId}</span>
          {build.originator && (
            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1.5 py-0.5 font-medium text-[var(--dpf-text)]">
              {build.originator.itemId}
            </span>
          )}
          <span className="capitalize">{build.phase}</span>
          <span>Updated {formatUpdatedAt(build.updatedAt)}</span>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {lifecycleLabel && (
            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--dpf-text)]">
              <span className="truncate">{lifecycleLabel}</span>
            </span>
          )}
          {build.product && (
            <span className="truncate text-xs text-[var(--dpf-muted)]">
              v{build.product.version} · {build.product.backlogCount} item{build.product.backlogCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        aria-label={`Delete ${build.title}`}
        disabled={isDevEnvironment}
        onClick={onDelete}
        className="grid w-8 shrink-0 cursor-pointer place-items-start rounded-r-md px-2 py-2 text-xs text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-error)] focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        &times;
      </button>
    </div>
  );
}
