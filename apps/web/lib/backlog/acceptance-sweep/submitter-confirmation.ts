import { isCustomerReported } from "@/lib/backlog/initiative-readiness/backlog-completion-evaluation";
import type { ForgeRepository } from "@/lib/forge/types";
import { isRecord } from "@/lib/shared/coerce";

// One question to a customer submitter after delivery (BI-C899BB40).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §9.2 rules 4-6.
//
// Operator direction 2026-10-27: delivery closes the item; validation is only
// owed for customer-reported work, "and even then a simple question and
// response would do it". The acceptance sweep visits a done item whose closure
// left a bounded obligation, and this module advances it one step per run:
//
//   ask once -> observe the answer -> record ONE resolved outcome -> never again.
//
// Every step is a `submitter_confirmation` activity on the item. The page
// excludes an item with a resolved row, so the obligation always concludes.
// The answer is read from what the platform already observes: the inbound
// re-poll records the source issue's state changes as intake_origin rows.

export { SUBMITTER_CONFIRMATION_ACTIVITY_KIND } from "./acceptance-sweep-page";

/** How long silence after the question means "fixed" (Zendesk/Intercom solved -> closed). */
export const SUBMITTER_CONFIRMATION_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConfirmationChannel =
  | { kind: "github-issue"; repository: ForgeRepository; number: number }
  | { kind: "founder-demand-cluster"; clusterId: string }
  | { kind: "none" };

const UPSTREAM_ISSUE_MARKER = /\[origin:ecosystem-upstream-issue:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#(\d+)\]/;
const FOUNDER_CLUSTER_MARKER = /\[origin:founderDemandCluster:([^\]\s]+)\]/;

/** Where the submitter can be asked, read from the origin markers intake already writes. */
export function confirmationChannelFor(body: string | null | undefined): ConfirmationChannel {
  const text = body ?? "";
  const issue = UPSTREAM_ISSUE_MARKER.exec(text);
  if (issue) return { kind: "github-issue", repository: { forge: "github", owner: issue[1]!, repo: issue[2]! }, number: Number(issue[3]) };
  const cluster = FOUNDER_CLUSTER_MARKER.exec(text);
  if (cluster) return { kind: "founder-demand-cluster", clusterId: cluster[1]! };
  return { kind: "none" };
}

/** The question. Plain words; it asks for the one signal the platform can observe. */
export function submitterQuestion(itemId: string): string {
  return [
    `The change for this was delivered as \`${itemId}\`. Is it fixed for you?`,
    "",
    "If it is not, reopen this issue and it will be picked up as new work. "
    + `If we hear nothing in ${SUBMITTER_CONFIRMATION_WINDOW_DAYS} days, we will take it as fixed.`,
  ].join("\n");
}

export type ConfirmationState = {
  itemId: string;
  body: string | null;
  lifecycleTags: string[];
  /** The item's newest status_change: the closure being confirmed. */
  closure: { recordedAt: Date; payload: Record<string, unknown> };
  /** submitter_confirmation rows recorded after the closure, any order. */
  records: Array<{ recordedAt: Date; payload: unknown }>;
  /** Source state changes recorded by the inbound re-poll (intake_origin change.kind). */
  sourceChanges: Array<{ recordedAt: Date; kind: string }>;
};

export type ConfirmationItem = { id: string; itemId: string };

export type SubmitterConfirmationPorts = {
  now: Date;
  loadState(item: ConfirmationItem): Promise<ConfirmationState | null>;
  postIssueComment(repository: ForgeRepository, number: number, body: string):
    Promise<{ ok: true; url: string } | { ok: false; reason: "no-credential" | "error"; message: string }>;
  notifyCluster(clusterId: string, message: string):
    Promise<{ ok: true; queued: number } | { ok: false; reason: "error"; message: string }>;
  fileCorrective(args: { originalItemId: string; servedSha: string; fingerprint: string; title: string; body: string }):
    Promise<{ action: "created" | "updated" | "skipped"; itemId: string | null; reason?: string }>;
  record(item: ConfirmationItem, payload: Record<string, unknown>, summary: string): Promise<void>;
};

export type ConfirmationStep =
  | { step: "question-sent"; channel: ConfirmationChannel["kind"] }
  | { step: "question-not-sent"; reason: string }
  | { step: "waiting"; askedAt: string }
  | { step: "not-fixed"; correctiveItemId: string | null }
  | { step: "confirmed" }
  | { step: "satisfied-by-silence" }
  | { step: "not-owed" }
  | { step: "corrective-filed"; correctiveItemId: string | null }
  | { step: "resolved" }
  | { step: "unavailable" };

function payloadOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function servedShaOf(closure: Record<string, unknown>): string {
  const deployment = payloadOf(closure.deployment);
  return typeof deployment.servedSha === "string" ? deployment.servedSha : "unknown";
}

/**
 * Advance one item's bounded obligation by one step. Idempotent across runs:
 * the activity rows are the state, and a resolved row ends it.
 */
export async function advanceSubmitterConfirmation(
  item: ConfirmationItem,
  ports: SubmitterConfirmationPorts,
): Promise<ConfirmationStep> {
  const state = await ports.loadState(item);
  if (!state) return { step: "unavailable" };
  const records = [...state.records].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (records.some((row) => payloadOf(row.payload).resolved === true)) return { step: "resolved" };
  const obligation = state.closure.payload.acceptanceObligation;
  const base = { closedAt: state.closure.recordedAt.toISOString(), obligation };

  if (obligation === "corrective-work-required") {
    const filed = await ports.fileCorrective({
      originalItemId: state.itemId,
      servedSha: servedShaOf(state.closure.payload),
      fingerprint: `acceptance-failed:${state.itemId}:${state.closure.recordedAt.toISOString()}`,
      title: `Acceptance failed after delivery: ${state.itemId}`,
      body: `${state.itemId} was delivered with a failed acceptance on record. This item carries the repair; ${state.itemId} stays done.`,
    });
    await ports.record(item, { ...base, outcome: "corrective-filed", resolved: true, correctiveItemId: filed.itemId, fileAction: filed.action },
      `Corrective work ${filed.itemId ?? "not filed"} for the failed acceptance on ${state.itemId}`);
    return { step: "corrective-filed", correctiveItemId: filed.itemId };
  }

  const owesQuestion = obligation === "pending-submitter-confirmation"
    || isCustomerReported({ itemId: state.itemId, body: state.body, lifecycleTags: state.lifecycleTags });
  if (!owesQuestion) {
    // A legacy pending-independent-verification (or malformed) obligation on
    // work no customer reported: retired by the operator direction, on the record.
    await ports.record(item, { ...base, outcome: "not-owed", resolved: true,
      reason: "No customer reported this work; post-delivery acceptance is not owed (operator direction 2026-10-27)." },
      `No acceptance owed after delivery for ${state.itemId}`);
    return { step: "not-owed" };
  }

  const question = records.find((row) => {
    const outcome = payloadOf(row.payload).outcome;
    return outcome === "question-sent" || outcome === "question-not-sent";
  });
  if (!question) return ask(item, state, base, ports);

  const askedAt = question.recordedAt.getTime();
  const answers = state.sourceChanges
    .filter((change) => change.recordedAt.getTime() > askedAt)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const reopened = answers.find((change) => change.kind === "reopened");
  if (reopened) {
    const filed = await ports.fileCorrective({
      originalItemId: state.itemId,
      servedSha: servedShaOf(state.closure.payload),
      fingerprint: `submitter-not-fixed:${state.itemId}:${question.recordedAt.toISOString()}`,
      title: `Reported still broken after delivery: ${state.itemId}`,
      body: `The submitter reopened the source issue after ${state.itemId} was delivered and they were asked whether it was fixed. `
        + `This item carries the follow-up; ${state.itemId} stays done.`,
    });
    await ports.record(item, { ...base, outcome: "not-fixed", resolved: true, answeredAt: reopened.recordedAt.toISOString(),
      correctiveItemId: filed.itemId, fileAction: filed.action },
      `Submitter says ${state.itemId} is not fixed; corrective work ${filed.itemId ?? "not filed"}`);
    return { step: "not-fixed", correctiveItemId: filed.itemId };
  }
  const closed = answers.find((change) => change.kind === "closed");
  if (closed) {
    await ports.record(item, { ...base, outcome: "confirmed", resolved: true, answeredAt: closed.recordedAt.toISOString() },
      `Submitter confirmed ${state.itemId} by closing the source issue`);
    return { step: "confirmed" };
  }
  if (ports.now.getTime() - askedAt >= SUBMITTER_CONFIRMATION_WINDOW_DAYS * DAY_MS) {
    await ports.record(item, { ...base, outcome: "satisfied-by-silence", resolved: true, windowDays: SUBMITTER_CONFIRMATION_WINDOW_DAYS },
      `No answer within ${SUBMITTER_CONFIRMATION_WINDOW_DAYS} days; ${state.itemId} taken as fixed`);
    return { step: "satisfied-by-silence" };
  }
  return { step: "waiting", askedAt: question.recordedAt.toISOString() };
}

async function ask(
  item: ConfirmationItem,
  state: ConfirmationState,
  base: Record<string, unknown>,
  ports: SubmitterConfirmationPorts,
): Promise<ConfirmationStep> {
  const channel = confirmationChannelFor(state.body);
  const question = submitterQuestion(state.itemId);
  const notSent = async (reason: string, message?: string): Promise<ConfirmationStep> => {
    // Never hold the item: the window still runs from here.
    await ports.record(item, { ...base, outcome: "question-not-sent", resolved: false, channel: channel.kind, reason,
      ...(message ? { message: message.slice(0, 300) } : {}) },
      `Question to the submitter of ${state.itemId} not sent: ${reason}`);
    return { step: "question-not-sent", reason };
  };
  if (channel.kind === "github-issue") {
    const posted = await ports.postIssueComment(channel.repository, channel.number, question);
    if (!posted.ok) return notSent(posted.reason, posted.message);
    await ports.record(item, { ...base, outcome: "question-sent", resolved: false, channel: channel.kind,
      issue: `${channel.repository.owner}/${channel.repository.repo}#${channel.number}`, commentUrl: posted.url },
      `Asked the submitter of ${state.itemId} whether it is fixed`);
    return { step: "question-sent", channel: channel.kind };
  }
  if (channel.kind === "founder-demand-cluster") {
    const sent = await ports.notifyCluster(channel.clusterId, question);
    if (!sent.ok) return notSent(sent.reason, sent.message);
    if (sent.queued === 0) return notSent("no-channel", "No reporting installation is reachable for this cluster.");
    await ports.record(item, { ...base, outcome: "question-sent", resolved: false, channel: channel.kind,
      clusterId: channel.clusterId, queued: sent.queued },
      `Asked the reporting installations of ${state.itemId} whether it is fixed`);
    return { step: "question-sent", channel: channel.kind };
  }
  return notSent("no-channel");
}
