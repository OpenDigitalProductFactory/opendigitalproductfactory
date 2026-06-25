// apps/web/components/ea/It4itParticipationGrid.tsx
//
// IT4IT participation matrix (EP-IT4IT-CONFORMANCE, BI-D51A5A4A). A 2-D cross-grid of the
// 35 functional components (rows, grouped by capability group) x the 7 value streams
// (columns), from the seeded FC Participation Matrix, tinted by each component's coverage
// status. Server component, read-only; the nested-tile heatmap remains the primary view.
// Participation is shown by a filled cell vs a middot (not colour alone); colour adds the
// coverage status. Tokens only, no hex.

import { Fragment } from "react";
import { intentStyle, resolveIntent } from "@/components/ui/report-kit/statusColors";
import type { It4itParticipationGrid as It4itParticipationGridData } from "@/lib/explore/it4it-participation-view";

export function It4itParticipationGrid({ data }: { data: It4itParticipationGridData }) {
  if (!data.hasData) return null;

  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">IT4IT Participation Matrix</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Which functional components participate in each value stream (IT4IT FC Participation Matrix),
          tinted by coverage status. Filled cell = participates.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--dpf-surface-1)] px-2 py-2 text-left font-medium text-[var(--dpf-muted)]">
                Functional component
              </th>
              {data.streams.map((s) => (
                <th key={s} className="px-2 py-2 text-center font-medium text-[var(--dpf-muted)] whitespace-nowrap">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <Fragment key={group.group}>
                <tr>
                  <td
                    colSpan={data.streams.length + 1}
                    className="bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]"
                  >
                    {group.group}
                  </td>
                </tr>
                {group.rows.map((row) => {
                  const intent = resolveIntent("it4itCoverage", row.status);
                  const fg = intentStyle(intent).fg;
                  const neutral = intent === "neutral";
                  return (
                    <tr key={row.componentId} className="border-t border-[var(--dpf-border)]">
                      <td className="sticky left-0 z-10 bg-[var(--dpf-surface-1)] px-2 py-1 whitespace-nowrap text-[var(--dpf-text)]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: neutral ? "var(--dpf-border)" : fg }}
                            aria-hidden="true"
                          />
                          {row.componentName}
                        </span>
                      </td>
                      {data.streams.map((s) => {
                        const participates = row.participatesIn[s];
                        return (
                          <td key={s} className="px-2 py-1 text-center">
                            {participates ? (
                              <span
                                title={`${row.componentName} participates in ${s} (coverage: ${row.status.replace("_", " ")})`}
                                className="inline-block h-3 w-3 rounded-sm align-middle"
                                style={{
                                  background: neutral
                                    ? "var(--dpf-surface-2)"
                                    : `color-mix(in srgb, ${fg} 55%, transparent)`,
                                  border: `0.5px solid ${neutral ? "var(--dpf-border)" : `color-mix(in srgb, ${fg} 70%, transparent)`}`,
                                }}
                              />
                            ) : (
                              <span className="text-[var(--dpf-muted)] opacity-30" aria-hidden="true">
                                ·
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-[var(--dpf-muted)]">
        Cell = component participates in that value stream; colour = the component&apos;s coverage status.
        Evidence-derived baseline, not an Open Group certification.
      </p>
    </section>
  );
}
