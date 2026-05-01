// apps/web/app/(shell)/platform/tools/discovery/promotion-audit/page.tsx
//
// Promotion Audit page (Task 2.4 of the Discovery -> Portfolio Gap Closure plan).
// Renders the four top counts (discovered / attributed / promoted / blocked) and
// per-reason blocked-entity samples grouped by PromotionSkipReason.
//
// Theme-aware: only var(--dpf-*) tokens per AGENTS.md §12.

import { prisma } from "@dpf/db";
import {
  getPromotionAudit,
  REASON_LIST,
  REASON_LABELS,
  REASON_HINTS,
  type PromotionAudit,
  type PromotionAuditCounts,
  type PromotionAuditDb,
  type PromotionAuditEntitySummary,
  type PromotionSkipReason,
  type BlockedReasonGroup,
} from "@/lib/discovery/promotion-audit";

export default async function PromotionAuditPage() {
  // PrismaClient is a structural superset of PromotionAuditDb (the helper's
  // narrow injectable shape), but TS cannot prove the `findMany` return-type
  // overlap without re-stating the include shape. Casting via `unknown` is
  // the same pattern the helper's own tests use.
  const audit = await getPromotionAudit(prisma as unknown as PromotionAuditDb);
  const { counts, blockedByReason } = audit;
  const reasonsWithBlocks = REASON_LIST.filter((r) => blockedByReason[r].count > 0);

  return (
    <div className="bg-[var(--dpf-bg)] min-h-screen p-8 text-[var(--dpf-text)]">
      <header className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold">Promotion Audit</h1>
        <p className="text-[var(--dpf-muted)] text-sm mt-1">
          Where the discovery &rarr; portfolio pipeline stands right now.
        </p>
      </header>

      <main className="max-w-6xl mx-auto mt-6">
        {counts.discovered === 0 ? (
          <EmptyState
            title="Nothing discovered yet"
            body="No InventoryEntity rows exist. Run discovery to populate the inventory before reviewing promotion."
          />
        ) : counts.blocked === 0 ? (
          <EmptyState
            title="All discovered items are promoted"
            body={`All ${counts.discovered} discovered ${
              counts.discovered === 1 ? "entity is" : "entities are"
            } either promoted or attributed without any open blocking issues.`}
          />
        ) : (
          <>
            <CountsStrip counts={counts} />
            <section className="mt-8 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Blocked, by reason</h2>
                <p className="text-[var(--dpf-muted)] text-sm mt-1">
                  {counts.blocked} {counts.blocked === 1 ? "item" : "items"} blocked
                  across {reasonsWithBlocks.length}{" "}
                  {reasonsWithBlocks.length === 1 ? "reason" : "reasons"}.
                </p>
              </div>
              {REASON_LIST.map((reason) => (
                <ReasonGroup
                  key={reason}
                  reason={reason}
                  group={blockedByReason[reason]}
                />
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] rounded-lg p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-[var(--dpf-muted)] text-sm mt-2 max-w-xl mx-auto">{body}</p>
    </div>
  );
}

function CountsStrip({ counts }: { counts: PromotionAuditCounts }) {
  const { discovered, attributed, promoted, blocked } = counts;
  const pct = (n: number) =>
    discovered > 0 ? `${Math.round((n / discovered) * 100)}%` : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
      <CountCard label="Discovered" value={discovered} sub={null} />
      <CountCard
        label="Attributed"
        value={attributed}
        sub={pct(attributed) ? `${pct(attributed)} of discovered` : null}
      />
      <CountCard
        label="Promoted"
        value={promoted}
        sub={
          pct(promoted) ? `${promoted} of ${discovered} (${pct(promoted)})` : null
        }
        emphasis="accent"
      />
      <CountCard
        label="Blocked"
        value={blocked}
        sub={
          pct(blocked) && blocked > 0
            ? `${blocked} of ${discovered} (${pct(blocked)})`
            : null
        }
      />
    </div>
  );
}

function CountCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: number;
  sub: string | null;
  emphasis?: "accent";
}) {
  return (
    <div className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] rounded-lg p-5">
      <div className="text-[var(--dpf-muted)] text-xs uppercase tracking-wide font-medium">
        {label}
      </div>
      <div
        className={`mt-2 text-4xl font-bold tabular-nums ${
          emphasis === "accent" ? "text-[var(--dpf-accent)]" : ""
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-[var(--dpf-muted)] text-xs mt-1">{sub}</div>
      ) : null}
    </div>
  );
}

function ReasonGroup({
  reason,
  group,
}: {
  reason: PromotionSkipReason;
  group: BlockedReasonGroup;
}) {
  return (
    <section className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] rounded-lg overflow-hidden">
      <header className="p-4 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold">{REASON_LABELS[reason]}</h3>
          <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md text-xs font-semibold border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] tabular-nums">
            {group.count}
          </span>
        </div>
        <p className="text-[var(--dpf-muted)] text-xs mt-2">{REASON_HINTS[reason]}</p>
      </header>

      {group.count === 0 ? (
        <div className="p-4 text-[var(--dpf-muted)] text-sm">
          No entities currently blocked for this reason.
        </div>
      ) : (
        <BlockedTable sample={group.sample} totalCount={group.count} />
      )}
    </section>
  );
}

function BlockedTable({
  sample,
  totalCount,
}: {
  sample: PromotionAuditEntitySummary[];
  totalCount: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-left px-4 py-2 font-medium">Type</th>
            <th className="text-left px-4 py-2 font-medium">Taxonomy</th>
            <th className="text-right px-4 py-2 font-medium">Confidence</th>
            <th className="text-right px-4 py-2 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((entity) => (
            <tr
              key={entity.id}
              className="border-t border-[var(--dpf-border)] align-top"
            >
              <td className="px-4 py-2">
                <div className="font-medium">{entity.name}</div>
                <div className="text-[var(--dpf-muted)] text-xs">
                  {entity.entityKey}
                </div>
              </td>
              <td className="px-4 py-2 text-[var(--dpf-muted)]">{entity.entityType}</td>
              <td className="px-4 py-2 text-[var(--dpf-muted)] font-mono text-xs">
                {entity.taxonomyNodePath ?? <span aria-label="none">&mdash;</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatConfidence(entity.attributionConfidence)}
              </td>
              <td className="px-4 py-2 text-right text-[var(--dpf-muted)] tabular-nums whitespace-nowrap">
                {timeAgo(entity.lastSeenAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalCount > sample.length ? (
        <div className="px-4 py-2 text-[var(--dpf-muted)] text-xs border-t border-[var(--dpf-border)]">
          Showing {sample.length} of {totalCount}. Drill in via SQL for the rest.
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatConfidence(c: number | null): string {
  if (c === null || Number.isNaN(c)) return "—"; // em dash (U+2014)
  return `${Math.round(c * 100)}%`;
}

/**
 * Inline relative-time helper. Server-rendered, so no client locale concerns —
 * we render a single canonical "X ago" string from the server's clock.
 */
function timeAgo(date: Date): string {
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));

  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  const diffYr = Math.round(diffDay / 365);
  return `${diffYr}y ago`;
}

// Re-export for tests / external diagnostics consumers.
export type { PromotionAudit };
