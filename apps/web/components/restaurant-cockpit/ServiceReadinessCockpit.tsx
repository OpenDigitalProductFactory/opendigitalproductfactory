// apps/web/components/restaurant-cockpit/ServiceReadinessCockpit.tsx
//
// Owner-readable render of the service-readiness summary — the Restaurant owner's
// first daily answer. Server component; all copy comes from the pure model
// (deriveServiceReadiness). Simple mode meaningfully reduces the body: it drops
// the secondary detail lines, the "behind the numbers" block, and any signal
// that is already ready — leaving the headline, the one next action, and only the
// signals that need the owner (BI-075F731F, BI-3BCAF95F).

import Link from "next/link";
import type {
  ReadinessLevel,
  ServiceReadinessSummary,
} from "@/lib/restaurant-cockpit/service-readiness";

const LEVEL_COLOR: Record<ReadinessLevel, string> = {
  ready: "var(--dpf-success)",
  attention: "var(--dpf-warning)",
  blocked: "var(--dpf-danger)",
};

const LEVEL_WORD: Record<ReadinessLevel, string> = {
  ready: "Ready",
  attention: "Needs a look",
  blocked: "Not ready",
};

/** Minimum tap-target per Fitts-law UX lens (docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md). */
const TAP = 44;

function LevelDot({ level }: { level: ReadinessLevel }) {
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: LEVEL_COLOR[level],
        flexShrink: 0,
        marginTop: 6,
      }}
    />
  );
}

export function ServiceReadinessCockpit({
  summary,
  simple = false,
}: {
  summary: ServiceReadinessSummary;
  simple?: boolean;
}) {
  const { headline, level, needsYouCount, nextAction, signals } = summary;
  // Simple mode: only surface signals that need the owner. Full mode: show all.
  const visibleSignals = simple ? signals.filter((s) => s.level !== "ready") : signals;

  return (
    <section
      aria-label="Service readiness"
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderLeft: `4px solid ${LEVEL_COLOR[level]}`,
        borderRadius: 10,
        padding: "20px 22px",
        marginBottom: 24,
      }}
    >
      {/* Headline: are we ready for the next service period? */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: LEVEL_COLOR[level],
          }}
        >
          {LEVEL_WORD[level]}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)" }}>
          {headline}
        </span>
      </div>

      {/* The one exact next action. Tap-safe primary control. */}
      {nextAction ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={nextAction.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: TAP,
              minWidth: TAP,
              padding: "10px 20px",
              background: "var(--dpf-accent)",
              color: "var(--dpf-on-accent)",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
              lineHeight: 1.2,
            }}
          >
            {nextAction.label} →
          </Link>
          <p style={{ fontSize: 13, color: "var(--dpf-muted)", margin: "8px 0 0", lineHeight: 1.5 }}>
            {nextAction.why}
          </p>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Nothing needs you before service. Everything below is set up and quiet.
        </p>
      )}

      {/* Signals — the five owner-readable readiness groups. */}
      {visibleSignals.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "18px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {visibleSignals.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  minHeight: TAP,
                  padding: "8px 8px",
                  margin: "0 -8px",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <LevelDot level={s.level} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--dpf-text)",
                    }}
                  >
                    {s.label}
                  </span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--dpf-muted)", lineHeight: 1.5 }}>
                    {s.summary}
                  </span>
                  {!simple && s.detail && (
                    <span style={{ display: "block", fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>
                      {s.detail}
                    </span>
                  )}
                </span>
                {s.actionLabel && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--dpf-accent)",
                      whiteSpace: "nowrap",
                      alignSelf: "center",
                    }}
                  >
                    {s.actionLabel} →
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {simple && needsYouCount === 0 && signals.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "12px 0 0" }}>
          Switch off Simple mode to see the full readiness breakdown.
        </p>
      )}

      {/* Progressive disclosure — raw figures, never shown in Simple mode. */}
      {!simple && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              fontSize: 12,
              color: "var(--dpf-muted)",
              cursor: "pointer",
              minHeight: 24,
            }}
          >
            Behind the numbers
          </summary>
          <dl
            style={{
              margin: "10px 0 0",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "4px 16px",
              fontSize: 12,
            }}
          >
            {summary.technical.map((t) => (
              <div key={t.label} style={{ display: "contents" }}>
                <dt style={{ color: "var(--dpf-muted)" }}>{t.label}</dt>
                <dd style={{ margin: 0, color: "var(--dpf-text)", fontVariantNumeric: "tabular-nums" }}>
                  {t.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
