/**
 * A shape version's flow reviews (BI-C684AF45, EP-B70E718D F8b).
 *
 * Spec §8: at each review point, the current measures against the version's
 * four-week baseline and the step where the most waiting accrues. Rendered
 * under the step measures in the area drill-in; the model is computed by
 * lib/work-management/flow-review-receipt.ts.
 */
import { formatDuration } from "@/lib/datetime";
import { FLOW_WINDOW_DAYS } from "@/lib/work-management/portfolio-flow";
import type { FlowReviewHistory, FlowReviewReceipt, ReviewMeasures } from "@/lib/work-management/flow-review-receipt";
import { MIN_BASELINE_EXITS } from "@/lib/work-management/workroom-flow-map";
import { describeHoldCause } from "@/lib/work-management/workroom-stage-telemetry";

import type { FlowT } from "./AreaFlowPanel";

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const dur = (ms: number | null) => (ms == null ? "—" : formatDuration(ms));

function Review({ receipt, baseline, t }: { receipt: FlowReviewReceipt; baseline: ReviewMeasures; t: FlowT }) {
  const { current, bottleneck } = receipt;
  return (
    <li className="space-y-1 py-2">
      <p className="text-sm font-medium text-[var(--dpf-text)]"><time dateTime={receipt.reviewedOn}>{receipt.reviewedOn}</time></p>
      <p className="text-xs text-[var(--dpf-text-secondary)]">
        {current.stepDwellMs == null
          ? t("flow.reviews.tooFew", { days: FLOW_WINDOW_DAYS, exits: current.exits, min: MIN_BASELINE_EXITS })
          : t("flow.reviews.measures", {
              dwell: dur(current.stepDwellMs),
              baselineDwell: dur(baseline.stepDwellMs),
              efficiency: pct(current.flowEfficiency),
              baselineEfficiency: pct(baseline.flowEfficiency),
            })}
      </p>
      <p className={`text-xs ${bottleneck ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-muted)]"}`}>
        {!bottleneck
          ? t("flow.reviews.nothingHeld")
          : bottleneck.waitMs == null
            ? t("flow.reviews.bottleneckUnmeasured", { stage: bottleneck.title, count: bottleneck.roomsHeld })
            : t("flow.reviews.bottleneck", { stage: bottleneck.title, count: bottleneck.roomsHeld, wait: formatDuration(bottleneck.waitMs) })}
        {bottleneck?.cause ? ` ${t("flow.reviews.cause", { cause: describeHoldCause(bottleneck.cause) })}` : ""}
      </p>
    </li>
  );
}

export function FlowReviews({ history, everyDays, t }: { history: FlowReviewHistory; everyDays: number; t: FlowT }) {
  return (
    <section aria-labelledby="shape-reviews-heading" className="space-y-2">
      <h3 id="shape-reviews-heading" className="text-sm font-medium text-[var(--dpf-text)]">{t("flow.reviews.heading", { days: everyDays })}</h3>
      <p className="text-xs text-[var(--dpf-muted)]">{t("flow.reviews.scope")}</p>
      {!history ? (
        <p className="text-xs text-[var(--dpf-muted)]">{t("flow.reviews.noData")}</p>
      ) : (
        <>
          <p className="text-xs text-[var(--dpf-text-secondary)]">
            {history.baseline.stepDwellMs == null
              ? t("flow.reviews.baselineTooFew", { from: history.baselineFrom, to: history.baselineTo, exits: history.baseline.exits, min: MIN_BASELINE_EXITS })
              : t("flow.reviews.baseline", {
                  from: history.baselineFrom,
                  to: history.baselineTo,
                  dwell: dur(history.baseline.stepDwellMs),
                  efficiency: pct(history.baseline.flowEfficiency),
                  exits: history.baseline.exits,
                })}
          </p>
          {history.receipts.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">{t("flow.reviews.firstDue", { date: history.firstReviewOn })}</p>
          ) : (
            <ol className="divide-y divide-[var(--dpf-border)]">
              {history.receipts.map((receipt) => <Review key={receipt.reviewedOn} receipt={receipt} baseline={history.baseline} t={t} />)}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
