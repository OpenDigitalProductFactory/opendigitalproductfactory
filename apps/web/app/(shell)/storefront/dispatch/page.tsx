// apps/web/app/(shell)/storefront/dispatch/page.tsx
//
// EP-3516E23D field-service dispatch board. Shows the field-service-job WorkItems
// on this storefront's dispatch queue, grouped into workflow columns, so an
// operator (the "Lead Manager" for a trades-maintenance storefront) sees every
// confirmed job and where it stands. Gated to field-service (trades-maintenance)
// storefronts — the nav tab only appears there, and direct navigation from any
// other archetype shows a gentle explainer instead of an empty board.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { StatusBadge } from "@/components/ui/report-kit";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { getDispatchBoard } from "@/lib/storefront/dispatch-board-data";

export const dynamic = "force-dynamic";

const FIELD_SERVICE_CATEGORY = "trades-maintenance";

function urgencyIntent(urgency: string): "danger" | "warning" | "info" | "neutral" {
  if (urgency === "emergency") return "danger";
  if (urgency === "urgent") return "warning";
  if (urgency === "priority") return "info";
  return "neutral";
}

export default async function DispatchBoardPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, archetype: { select: { category: true, customVocabulary: true } } },
  });

  if (!config) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 14 }}>
        No storefront configured.{" "}
        <Link href="/storefront/setup" style={{ color: "var(--dpf-accent)" }}>
          Set one up
        </Link>
        .
      </div>
    );
  }

  const category = config.archetype?.category ?? null;
  const vocabulary = getVocabulary(
    category ?? undefined,
    (config.archetype?.customVocabulary as Record<string, string> | null) ?? null,
  );

  if (category !== FIELD_SERVICE_CATEGORY) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 14, maxWidth: 640 }}>
        The dispatch board is for field-service storefronts. It turns confirmed,
        crew-assigned bookings into jobs you can track from unassigned through
        completion. Switch this storefront to a field-service archetype to use it.
      </div>
    );
  }

  const board = await getDispatchBoard(config.id);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--dpf-text)" }}>
          Dispatch board
        </h2>
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>
          Confirmed jobs assigned to the {vocabulary.teamLabel.toLowerCase()}, grouped by stage.
          {board.total === 0
            ? " No jobs yet — confirming a booking with an assigned provider adds it here."
            : ` ${board.total} job${board.total === 1 ? "" : "s"} on the board.`}
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {board.columns.map((col) => (
          <section
            key={col.key}
            aria-label={col.label}
            style={{
              flex: "0 0 240px",
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: "var(--dpf-muted)",
                marginBottom: 8,
              }}
            >
              <span>{col.label}</span>
              <span>{col.jobs.length}</span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {col.jobs.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: 0 }}>—</p>
              ) : (
                col.jobs.map((jobItem) => (
                  <div
                    key={jobItem.itemId}
                    style={{
                      background: "var(--dpf-surface-2)",
                      border: "1px solid var(--dpf-border)",
                      borderRadius: 6,
                      padding: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
                      {jobItem.title}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <StatusBadge intent={urgencyIntent(jobItem.urgency)} label={jobItem.urgency} size="sm" />
                      {jobItem.dueAt && (
                        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
                          {jobItem.dueAt.slice(0, 16).replace("T", " ")} UTC
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
