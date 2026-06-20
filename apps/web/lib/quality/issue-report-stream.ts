// ─── Issue-Report Stream Classifier ─────────────────────────────────────────
// EP-INTAKE-UNIFY / BI-0ACD9AB2 — Slice 1 (§5.1 of the trusted-escalation-routing
// design, docs/superpowers/specs/2026-06-20-issue-report-surface-attendance-design.md).
//
// A PlatformIssueReport is NOT automatically generic bug work. This pure
// classifier decides which STREAM a report belongs to, so the projection path
// and (later) the escalation responder route it correctly instead of converting
// every OPEN report into a backlog item. Both the immediate projection event and
// the 15-minute safety-net cron MUST consume this single classifier — a future
// writer must not have to remember which path skips which status.
//
// Pure + dependency-free so it is trivially unit-testable and safe to call from
// any writer/handler. Wiring (the projection guard + responder) lands in the
// coupled follow-on slices; this module changes no behaviour on its own.

import { ISSUE_REPORT_STATUS, isSupportFlowStatus } from "./issue-report-status";

export type IssueReportStream =
  | "noise-digest"
  | "runtime-fault"
  | "self-fix-escalation"
  | "support-feedback"
  | "upstream-feedback";

/** The report fields the stream decision reads. A structural subset of
 *  PlatformIssueReport so callers can pass a row or a create-input alike. */
export interface IssueReportStreamInput {
  type?: string | null;
  source?: string | null;
  severity?: string | null;
  selfFixClass?: string | null;
  errorDigest?: string | null;
  status?: string | null;
}

/** Automated, low-value producers whose output is digest/aggregate material, not
 *  per-report backlog work. Real spikes are still caught by spike detection. */
const NOISE_SOURCES = new Set<string>(["warmup", "log-signature-scanner"]);

/**
 * Classify a report into its handling stream. Rule order is significant:
 *
 *  1. self-fix-escalation — a build that could not self-repair (selfFixClass set,
 *     or type="build-stall-escalation"). Highest priority and checked BEFORE the
 *     support-status rule, because the projection guard births these in
 *     awaiting_escalation_ack (a support-flow status) and they must still classify
 *     as self-fix so the responder — not the generic projector — receives them.
 *  2. support-feedback / upstream-feedback — reports already in a SUPPORT_FLOW
 *     status, owned by the capacity-aware support pipeline.
 *  3. noise-digest — warmup probes + recurring log signatures.
 *  4. runtime-fault — crashes and digest-bearing fault evidence.
 *  5. fail-safe default — anything else (incl. unknown / high-severity) becomes
 *     runtime-fault so it is reviewed, never silently suppressed (design §5.1).
 */
export function classifyIssueReportStream(input: IssueReportStreamInput): IssueReportStream {
  const type = input.type ?? "";
  const source = input.source ?? "";
  const status = input.status ?? "";

  if (input.selfFixClass || type === "build-stall-escalation") {
    return "self-fix-escalation";
  }

  if (status && isSupportFlowStatus(status)) {
    if (
      status === ISSUE_REPORT_STATUS.UPSTREAM_PENDING ||
      status === ISSUE_REPORT_STATUS.UPSTREAM_FILED
    ) {
      return "upstream-feedback";
    }
    return "support-feedback";
  }

  if (NOISE_SOURCES.has(source)) {
    return "noise-digest";
  }

  if (source === "crash_boundary" || input.errorDigest) {
    return "runtime-fault";
  }

  // Fail safe: never suppress an unclassified or high-severity signal.
  return "runtime-fault";
}

/** True when the stream must be attended by the escalation responder rather than
 *  generic-projected into the backlog (the projection guard predicate). */
export function isResponderStream(stream: IssueReportStream): boolean {
  return stream === "self-fix-escalation";
}
