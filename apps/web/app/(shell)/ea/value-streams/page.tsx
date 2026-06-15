// apps/web/app/(shell)/ea/value-streams/page.tsx
import Link from "next/link";
import { EaTabNav } from "@/components/ea/EaTabNav";
import { LocalTime } from "@/components/ui/LocalTime";
import { isOperationalValueStreamScope, listValueStreamViews } from "@/lib/ea/value-stream-views";

export default async function EaValueStreamsPage() {
  const views = await listValueStreamViews();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Value Streams — your business&rsquo;s operational value stream alongside reference-model
          value-stream projections, on the EA canvas.
        </p>
      </div>

      <EaTabNav />

      {views.length > 0 ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
          {views.map((v) => (
            <Link key={v.id} href={`/ea/views/${v.id}`} style={{ textDecoration: "none" }}>
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]">
                <p className="mb-1 font-mono text-[9px] text-[var(--dpf-muted)]">
                  {v.notation.name} ·{" "}
                  {isOperationalValueStreamScope(v.scopeType) ? "Operational — your business" : "Reference model"}
                </p>
                <p className="mb-1 text-sm font-semibold leading-tight text-[var(--dpf-text)]">{v.name}</p>
                {v.description != null && (
                  <p className="mb-1.5 line-clamp-2 text-[10px] text-[var(--dpf-muted)]">{v.description}</p>
                )}
                <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)]">
                  {v.scopeRef != null && <span>{v.scopeRef}</span>}
                  <span>
                    {v._count.viewElements} element{v._count.viewElements !== 1 ? "s" : ""}
                  </span>
                  <LocalTime value={v.createdAt} mode="date" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
          <p className="mb-2 text-sm font-medium text-[var(--dpf-text)]">
            No value-stream view generated yet.
          </p>
          <p className="mb-4 text-xs text-[var(--dpf-muted)]">
            Two kinds of value stream appear here: your business&rsquo;s operational value stream, generated when
            you complete storefront setup, and reference-model projections (e.g. IT4IT) loaded from a reference
            model onto the EA canvas.
          </p>
          <Link
            href="/ea/models"
            className="text-xs font-medium text-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
          >
            Go to Reference Models →
          </Link>
        </div>
      )}
    </div>
  );
}
