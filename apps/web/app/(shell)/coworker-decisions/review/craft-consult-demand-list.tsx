// Craft consults a specialist could not answer from its own corpus
// (BI-6BB728F1). Read-only demand signal; the release path is the craft page
// itself (/coworker-decisions/craft/<key> → publish), which promotes a
// confirmed page into the decision class the consults are asking for.
//
// Composed from ui/Surface rather than re-typed card markup (BI-D25ED55D).
// Server component: no state, no action — it points at the existing one.

import Link from "next/link";

import { Surface } from "@/components/ui/Surface";

import type { CraftConsultDemandRow } from "@/lib/decision-perspective/craft-consult-demand";
import {
  CRAFT_CONSULT_DEMAND_WINDOW_DAYS,
  UNBOUND_PROFESSION_KEY,
} from "@/lib/decision-perspective/craft-consult-demand";
import { findProfessionFamilyByKey } from "@/lib/decision-perspective/resolve-profession-profile";

export const CRAFT_CONSULT_DEMAND_COPY = {
  heading: "Craft questions your specialists answered from platform defaults",
  intro:
    `In the last ${CRAFT_CONSULT_DEMAND_WINDOW_DAYS} days these coworkers were asked a craft question ` +
    "and had no confirmed page of their own that covers it, so general platform doctrine answered " +
    "instead. Publishing a page in that decision class makes the craft's own judgement gate-live.",
  action: "Open this craft",
  unbound: "coworkers with no profession family",
} as const;

function professionLabel(professionKey: string): string {
  if (professionKey === UNBOUND_PROFESSION_KEY) return CRAFT_CONSULT_DEMAND_COPY.unbound;
  return findProfessionFamilyByKey(professionKey)?.label ?? professionKey;
}

function domainLabel(domainClass: string): string {
  return domainClass.replaceAll("-", " ");
}

export function CraftConsultDemandList({ demand }: { demand: readonly CraftConsultDemandRow[] }) {
  if (demand.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
        {CRAFT_CONSULT_DEMAND_COPY.heading}
      </h2>
      <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{CRAFT_CONSULT_DEMAND_COPY.intro}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {demand.map((row) => (
          <Surface
            as="li"
            level={1}
            padding="sm"
            rounded="md"
            key={`${row.professionKey}:${row.domainClass}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 text-dpf-body font-medium text-[var(--dpf-text)]">
                {professionLabel(row.professionKey)}
                <span className="ml-2 text-dpf-caption font-normal text-[var(--dpf-muted)]">
                  {domainLabel(row.domainClass)}
                </span>
              </span>
              <span className="shrink-0 text-dpf-caption text-[var(--dpf-muted)]">
                {row.consults} {row.consults === 1 ? "consult" : "consults"}
                {row.deferred > 0 ? ` · ${row.deferred} unanswered` : ""}
              </span>
              {row.professionKey !== UNBOUND_PROFESSION_KEY ? (
                <Link
                  href={`/coworker-decisions/craft/${encodeURIComponent(row.professionKey)}`}
                  className="shrink-0 rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {CRAFT_CONSULT_DEMAND_COPY.action} →
                </Link>
              ) : null}
            </div>
            <p className="mt-1 ml-1 truncate text-dpf-caption text-[var(--dpf-muted)]">
              Latest: {row.sampleQuestion}
            </p>
          </Surface>
        ))}
      </ul>
    </section>
  );
}
