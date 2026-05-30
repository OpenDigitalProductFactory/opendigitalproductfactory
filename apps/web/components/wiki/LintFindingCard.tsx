// EP-WIKI-001 Phase 4b2: card display for a single WikiLintFinding row.
// Server component. Mounted by the /admin/wiki/lint page.

import Link from "next/link";
import type { ReactNode } from "react";

import { LocalTime } from "@/components/ui/LocalTime";

// ─── Public types ───────────────────────────────────────────────────────────

export type LintFindingRow = {
  id: string;
  organizationId: string | null;
  pageId: string;
  findingKind: string;
  severity: string;
  status: string;
  detail: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  page: {
    slug: string;
    title: string;
    pageKind: string;
    isKernel: boolean;
  } | null;
};

// ─── Visual encoding ────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  error: "border-l-2 border-[var(--dpf-accent)]",
  warn: "border-l-2 border-[var(--dpf-border)]",
  info: "border-l-2 border-transparent",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  ignored: "Ignored",
};

const KIND_DESCRIPTIONS: Record<string, string> = {
  contradiction: "Two pages contain claims an LLM detector judged incompatible.",
  stale: "Oldest cited source is past the staleness threshold.",
  orphan: "Page is published with no inbound links and/or no source citations.",
  "missing-xref": "An entity mention in prose is not wrapped in [[link]].",
  "dangling-xref": "An [[link]] target does not exist (blocks publish).",
  "kernel-drift": "Org overlay derived from an older kernel version than current.",
  "stance-extraction-needed":
    "Summary page has no extracted stance or heuristic link.",
};

function formatDetail(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const obj = detail as Record<string, unknown>;
  // Surface a few commonly useful fields. Detail keys are documented per
  // detector in apps/web/lib/wiki/lint-detectors.ts.
  const parts: string[] = [];
  if (typeof obj.reason === "string") parts.push(`reason: ${obj.reason}`);
  if (Array.isArray(obj.danglingTargets)) {
    parts.push(`targets: ${(obj.danglingTargets as string[]).join(", ")}`);
  }
  if (typeof obj.ageDays === "number") parts.push(`${obj.ageDays}d old`);
  if (
    typeof obj.derivedFromKernelVersion === "string" &&
    typeof obj.currentKernelVersion === "string"
  ) {
    parts.push(
      `v${obj.derivedFromKernelVersion} → v${obj.currentKernelVersion}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ─── Component ──────────────────────────────────────────────────────────────

type Props = {
  finding: LintFindingRow;
};

export function LintFindingCard({ finding }: Props): ReactNode {
  const sevClass = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info;
  const pageHref = finding.page ? `/wiki/${finding.page.slug}` : null;
  const detailLine = formatDetail(finding.detail);

  return (
    <article
      className={`px-3 py-2 bg-[var(--dpf-surface-1)] ${sevClass}`}
    >
      <header className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold uppercase tracking-wide text-[var(--dpf-text)]">
          {finding.findingKind}
        </span>
        <span className="px-1.5 py-0.5 rounded uppercase tracking-wide text-[10px] border border-[var(--dpf-border)] text-[var(--dpf-muted)]">
          {finding.severity}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
          {STATUS_LABELS[finding.status] ?? finding.status}
        </span>
        {finding.organizationId === null ? (
          <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
            kernel
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
            overlay · {finding.organizationId}
          </span>
        )}
        <LocalTime
          value={finding.createdAt}
          mode="date"
          className="ml-auto text-[10px] text-[var(--dpf-muted)]"
        />
      </header>

      <div className="mt-1 text-sm text-[var(--dpf-text)]">
        {finding.page ? (
          pageHref ? (
            <Link href={pageHref} className="hover:underline text-[var(--dpf-accent)]">
              {finding.page.title}{" "}
              <span className="text-[var(--dpf-muted)] font-mono text-xs">
                {finding.page.slug}
              </span>
            </Link>
          ) : (
            <>
              {finding.page.title}{" "}
              <span className="text-[var(--dpf-muted)] font-mono text-xs">
                {finding.page.slug}
              </span>
            </>
          )
        ) : (
          <span className="text-[var(--dpf-muted)] italic">
            page {finding.pageId} (deleted)
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        {KIND_DESCRIPTIONS[finding.findingKind] ?? finding.findingKind}
      </p>

      {detailLine && (
        <p className="mt-1 text-xs text-[var(--dpf-muted)] font-mono">
          {detailLine}
        </p>
      )}
    </article>
  );
}
