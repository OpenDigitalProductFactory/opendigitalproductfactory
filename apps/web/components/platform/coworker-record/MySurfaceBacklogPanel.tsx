// apps/web/components/platform/coworker-record/MySurfaceBacklogPanel.tsx
// BI-012C0B58 — the human-facing mirror of the `list_my_backlog` coworker tool.
// Server-rendered from the shared getCoworkerBacklogSlice, so the human sees the
// exact identity-scoped slice the coworker sees: its surface (portfolio) ∪ its
// occupation's capabilities ∪ anything it owns/claimed, with a status roll-up.
// Theme tokens only (AGENTS.md §12) — no hardcoded hex.

import type { CoworkerBacklogSlice, SurfaceBacklogItem } from "@/lib/coworker-record/surface-backlog";
import { Section, Chip, EmptyState, deepLink } from "./panels";

type Tone = "muted" | "accent" | "success" | "warning" | "error";

const STATUS_TONE: Record<string, Tone> = {
  open: "warning",
  "in-progress": "accent",
  triaging: "muted",
  done: "success",
  deferred: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  "in-progress": "In progress",
  triaging: "Triaging",
  done: "Done",
  deferred: "Deferred",
};

const HEAD_ROW = 8; // items shown before the "show all" disclosure

function StatusDot({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "muted";
  const color = {
    muted: "var(--dpf-muted)",
    accent: "var(--dpf-accent)",
    success: "var(--dpf-success)",
    warning: "var(--dpf-warning)",
    error: "var(--dpf-error)",
  }[tone];
  return (
    <span
      aria-hidden
      title={STATUS_LABEL[status] ?? status}
      style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "none" }}
    />
  );
}

function ItemRow({ item }: { item: SurfaceBacklogItem }) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        borderTop: "1px solid var(--dpf-border)",
      }}
    >
      <StatusDot status={item.status} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--dpf-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 2,
            fontSize: 10.5,
            color: "var(--dpf-muted)",
          }}
        >
          <code style={{ fontSize: 10.5 }}>{item.itemId}</code>
          {item.workType ? (
            <Chip tone={item.workType === "tool" || item.workType === "skill" ? "accent" : "muted"}>
              {item.workType}
            </Chip>
          ) : null}
          {item.priority !== null ? <span>P{item.priority}</span> : null}
          {item.epicId ? <span>{item.epicId}</span> : null}
        </span>
      </span>
    </li>
  );
}

export function MySurfaceBacklogPanel({
  slice,
  displayName,
}: {
  slice: CoworkerBacklogSlice | null;
  displayName: string;
}) {
  if (!slice) {
    return (
      <Section title="My surface backlog">
        <EmptyState text="Couldn't load this coworker's backlog slice right now." />
      </Section>
    );
  }

  const { scope, summary, items, total, truncated } = slice;
  const occupation = scope.professionKey ?? "unmapped";
  const area = scope.portfolioId ? "portfolio area" : "assigned + owned work";
  const head = items.slice(0, HEAD_ROW);
  const rest = items.slice(HEAD_ROW);

  return (
    <Section
      title="My surface backlog"
      count={total}
      action={deepLink("/ops", "Open full backlog")}
    >
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 0 10px" }}>
        The backlog scoped to {displayName}&rsquo;s own {area} and occupation (
        <span style={{ color: "var(--dpf-text)" }}>{occupation}</span>). Nothing outside this
        coworker&rsquo;s area is shown.
        {!scope.occupationArmApplied ? (
          <span style={{ marginLeft: 6 }}>
            <Chip tone="muted">area + owned only</Chip>
          </span>
        ) : null}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Chip tone="warning">{summary.open} open</Chip>
        <Chip tone="accent">{summary.inProgress} in progress</Chip>
        <Chip tone="success">{summary.done} done</Chip>
      </div>

      {items.length === 0 ? (
        <EmptyState text={`Nothing in ${displayName}'s area yet — a clean slate.`} />
      ) : (
        <>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {head.map((item) => (
              <ItemRow key={item.itemId} item={item} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details style={{ marginTop: 6 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--dpf-accent)",
                  padding: "6px 0",
                }}
              >
                Show {rest.length} more
              </summary>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rest.map((item) => (
                  <ItemRow key={item.itemId} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
          {truncated ? (
            <p style={{ fontSize: 10.5, color: "var(--dpf-muted)", marginTop: 8 }}>
              Showing {items.length} of {total} in this coworker&rsquo;s area.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}
