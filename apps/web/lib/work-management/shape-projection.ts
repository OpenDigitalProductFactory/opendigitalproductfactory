// apps/web/lib/work-management/shape-projection.ts
//
// BI-23DB08BB / BI-405AD4FD. A Workroom is an effort with a SHAPE — many steps,
// some of them parallel, each gated. Until this module the shape was readable
// only by reading: the room surface rendered no graphic at all, so "where is
// this effort and what is holding it" cost a paragraph of prose per room.
//
// This is a PURE projection: WorkroomView in, renderable graph out. It invents
// no state. Two rules are load-bearing and enforced by tests:
//
//   1. The capsule's last-touched timestamp is never an input. A daily
//      heartbeat freezes that field for Build Studio capsules, so a dead room
//      would render live. Liveness is passed in, already derived. A test greps
//      this file for the field name, so do not name it here either.
//   2. A gate verdict is only ever read off a receipt, never inferred. Where the
//      gate recorded less, the picture shows less — it must never disagree with
//      the ledger, because when they disagree the picture is what people believe.

import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkCaseState } from "./case-types";
import type { WorkroomView } from "./room-types";
import type { WorkCaseSourceRef } from "./case-types";
import { getWorkShape } from "./work-shapes";

export const SHAPE_NODE_STATES = [
  "passed",
  "holding",
  "denied",
  "awaiting-confirmation",
  "not-reached",
  "unknown",
  "observed",
  "cancelled",
] as const;
export type ShapeNodeState = (typeof SHAPE_NODE_STATES)[number];

/** One row inside a stage. A stage with a single row renders as a plain node. */
export interface ShapeRow {
  key: string;
  label: string;
  state: ShapeNodeState;
  /** Short status string shown beside the label. Never prose. */
  detail: string | null;
  /**
   * The audit row this row was read from. Present on every receipt-backed row,
   * so a rendered verdict can always be traced back to what recorded it.
   */
  receiptRef: { table: string; id: string } | null;
  /** Who acted, when the receipt named an actor. */
  actor: string | null;
  occurredAt?: string;
  summary?: string;
}

export interface ShapeStage {
  key: string;
  label: string;
  state: ShapeNodeState;
  /** True when the rows are concurrent rather than sequential (renders as a cluster). */
  parallel: boolean;
  rows: ShapeRow[];
  inspection?: {
    position: string;
    reason: string;
    next: string;
    owner: string;
    expectedEvidence: readonly string[];
    affected: WorkCaseSourceRef[];
  };
}

export interface ShapeGraph {
  stages: ShapeStage[];
  /** The stage holding the room, when one is. */
  blockingStageKey: string | null;
  /** Counts for the summary line: how far through its own shape this room is. */
  progress: { passed: number; total: number };
  process?: {
    definitionRef: string | null;
    title: string;
    currentStageKey: string | null;
    nextPermittedStageKey: string | null;
    readAt: string | null;
    lastEvidenceAt: string | null;
    sourceHealth: WorkroomView["projection"]["sourceHealth"];
    gaps: string[];
    receipts: ShapeRow[];
  };
}

/** The canonical spine. Constant per surface — only the decoration changes. */
const STAGES = [
  { key: "convene", label: "Convene" },
  { key: "act", label: "Governed action" },
  { key: "decide", label: "Decision gate" },
  { key: "verify", label: "Verify" },
  { key: "close", label: "Close" },
] as const;

/**
 * Which stage a case state sits in. Waiting states stay in the stage they are
 * waiting inside — a room waiting on a person has not advanced past acting.
 */
const STATE_STAGE_INDEX: Record<WorkCaseState, number> = {
  intake: 0,
  triage: 0,
  active: 1,
  "waiting-on-person": 1,
  "waiting-on-system": 1,
  "awaiting-decision": 2,
  verifying: 3,
  resolved: 4,
  closed: 4,
  cancelled: 4,
};

/**
 * Liveness as derived by list_workrooms. Passed in rather than recomputed,
 * because the derivation belongs to the coordination plane, not to a view.
 */
export type ShapeLiveness =
  | "live"
  | "lease-expired"
  | "build-terminal"
  | "idle-stale"
  | "no-signal"
  | "terminal"
  | null;

const TERMINAL_STATES: ReadonlySet<WorkCaseState> = new Set(["resolved", "closed", "cancelled"]);

function receiptState(receipt: ReceiptEnvelope): ShapeNodeState {
  // A decision receipt carries the gate's own outcome in sourceRef.status.
  // "decline" is an ASSURANCE (BI-2107B5D2) — decisive, not pending.
  const outcome = receipt.sourceRef.status ?? null;
  if (outcome === "decline") return "denied";
  if (outcome === "escalate") return "awaiting-confirmation";
  if (receipt.status === "invalid" || receipt.status === "failed") return "denied";
  return receipt.status === "valid" ? "passed" : "observed";
}

function actorLabel(receipt: ReceiptEnvelope): string | null {
  const actor = receipt.actorRef;
  if (!actor) return null;
  const named = actor as { displayName?: string | null; id?: string | null; kind?: string | null };
  return named.displayName ?? named.id ?? named.kind ?? null;
}

function rowFromReceipt(receipt: ReceiptEnvelope): ShapeRow {
  return {
    key: `${receipt.rawRef.table}:${receipt.rawRef.id}:${receipt.receiptId}`,
    label: receipt.actionType ? String(receipt.actionType) : receipt.receiptKind,
    state: receiptState(receipt),
    detail: receipt.sourceRef.status ?? receipt.status,
    receiptRef: receipt.rawRef,
    actor: actorLabel(receipt),
    occurredAt: receipt.occurredAt,
    summary: receipt.summary,
  };
}

function stageStateFor(
  stageIndex: number,
  currentIndex: number,
  rows: ShapeRow[],
  opts: { attentionRequired: boolean; stalled: boolean; terminal: boolean },
): ShapeNodeState {
  // A row that was denied dominates: a decline is decisive and must not be
  // averaged away by neighbouring passes.
  if (rows.some((row) => row.state === "denied")) return "denied";
  if (rows.some((row) => row.state === "awaiting-confirmation")) return "awaiting-confirmation";
  if (rows.some((row) => row.state === "holding")) return "holding";
  if (rows.length && rows.every((row) => row.state === "passed")) return "passed";
  if (stageIndex === currentIndex && !opts.terminal) return "holding";
  if (rows.length) return "observed";
  return stageIndex > currentIndex ? "not-reached" : "unknown";
}

export function projectRoomShape(
  view: WorkroomView,
  options: { liveness?: ShapeLiveness } = {},
): ShapeGraph {
  const currentIndex = STATE_STAGE_INDEX[view.state] ?? 0;
  const terminal = TERMINAL_STATES.has(view.state);
  const stalled = options.liveness != null
    && options.liveness !== "live"
    && options.liveness !== "terminal"
    && !terminal;

  const decisionReceipts = view.receipts.filter((r) => r.sourceRef.kind === "decision-interaction");
  const toolReceipts = view.receipts.filter((r) => r.rawRef.table === "ToolExecution");
  const verificationReceipts = view.receipts.filter((r) => r.sourceRef.kind === "runtime-verification");

  const rowsByStage: Record<string, ShapeRow[]> = {
    convene: view.boundary.gaps.map((gap) => ({
      key: `boundary:${gap}`,
      label: gap.replaceAll("-", " "),
      // A boundary gap is a hole in the room's own definition, so it holds the
      // convene stage rather than passing it.
      state: "holding" as ShapeNodeState,
      detail: "missing",
      receiptRef: null,
      actor: null,
    })),
    act: toolReceipts.map(rowFromReceipt),
    decide: decisionReceipts.map(rowFromReceipt),
    verify: verificationReceipts.map(rowFromReceipt),
    close: view.outcome.packet
      ? [{
          key: "outcome-packet",
          label: "Outcome packet",
          state: view.outcome.packet.outcomeState === "cancelled" ? "cancelled"
            : view.outcome.packet.outcomeState === "achieved" && view.outcome.packet.verifiedByRef
              && view.outcome.packet.unresolvedWork.length === 0 ? "passed" : "observed",
          detail: `${view.outcome.packet.unresolvedWork.length} unresolved`,
          receiptRef: null,
          actor: null,
        }]
      : [],
  };

  let stages: ShapeStage[] = STAGES.map((stage, index) => {
    const rows = rowsByStage[stage.key] ?? [];
    return {
      key: stage.key,
      label: stage.label,
      state: stage.key === "close" && view.state === "cancelled" ? "cancelled" : stageStateFor(index, currentIndex, rows, {
        attentionRequired: view.work.attentionRequired,
        stalled,
        terminal,
      }),
      // Governed actions and decision gates happen concurrently within a cycle;
      // convene and close are single moments.
      parallel: stage.key === "act" || stage.key === "decide" || stage.key === "verify",
      rows,
    };
  });

  const check = view.processOverseer;
  const candidate = check?.shapeKey ? getWorkShape(check.shapeKey) : null;
  const definition = candidate?.version === check?.shapeVersion ? candidate : null;
  const currentStageKey = definition ? check.currentStageKey : STAGES[currentIndex]?.key ?? null;
  const affected = view.sourceRefs.filter((ref) => ref.kind === "work-capsule" || ref.kind === "work-item" || ref.kind === "task-run");
  const ownerName = (ref: string | null | undefined) => view.participants.find((person) => person.principalRef === ref)?.displayName ?? ref ?? "Owner not recorded";
  const gaps = [...(check?.deviations ?? []).map((deviation) => deviation.summary)];
  if (!definition) gaps.push("Execution definition is unresolved; this is the DPF lifecycle projection.");
  if (definition && !currentStageKey) gaps.push("No observed execution stage is linked to this definition.");
  if (view.projection.sourceHealth !== "ok") gaps.push("Some execution sources are unavailable or incomplete.");
  if (definition) {
    // Definition order is stable. A receipt kind alone cannot bind a receipt to
    // one of these steps; leave uncorrelated receipts in the evidence lane.
    stages = definition.stages.map((stage) => ({
      key: stage.key, label: stage.title, parallel: false, rows: [],
      state: stage.key !== currentStageKey ? "unknown"
        : view.state === "cancelled" ? "cancelled"
        : check.disposition === "pause" || check.disposition === "escalate" ? "holding"
        : check.disposition === "stop" ? "denied" : "observed",
      inspection: {
        position: stage.key === currentStageKey ? "Current stage reported by the process check" : "Intended step; execution not verified",
        reason: stage.key === currentStageKey ? check.interventionReason ?? view.work.attentionReason ?? "The process check reports this stage." : "No step-linked execution receipt is available.",
        next: stage.key === currentStageKey ? view.work.nextAction || "Next action not recorded" : stage.advance.condition,
        owner: ownerName(stage.accountablePrincipalRef), expectedEvidence: stage.evidence, affected,
      },
    }));
    if (view.receipts.length) gaps.push("Receipts are linked to this room, but their definition-step correlation is not verified.");
  } else {
    stages = stages.map((stage) => ({ ...stage, inspection: {
      position: stage.key === currentStageKey ? `Current lifecycle stage: ${stage.label}` : `Lifecycle stage: ${stage.label}`,
      reason: stage.key === currentStageKey ? view.work.attentionReason || "The recorded case state selects this lifecycle stage." : "Only the receipts below establish what happened here.",
      next: stage.key === currentStageKey ? view.work.nextAction || "Next action not recorded" : "No permitted transition is recorded for this stage.",
      owner: ownerName(view.boundary.accountablePrincipalRef), expectedEvidence: [], affected,
    } }));
  }
  const evidenceTimes = [...view.receipts.map((receipt) => receipt.occurredAt), ...view.activity.map((event) => event.occurredAt)]
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!))).sort((a, b) => Date.parse(b) - Date.parse(a));

  const blocking = stages.find((s) => s.state === "denied")
    ?? stages.find((s) => s.state === "awaiting-confirmation")
    ?? stages.find((s) => s.state === "holding")
    ?? null;

  return {
    stages,
    blockingStageKey: blocking?.key ?? null,
    progress: {
      passed: stages.filter((s) => s.state === "passed").length,
      total: stages.length,
    },
    process: {
      definitionRef: check?.shapeKey && check.shapeVersion ? `${check.shapeKey}@${check.shapeVersion}` : null,
      title: definition?.title ?? "DPF lifecycle",
      currentStageKey,
      nextPermittedStageKey: definition ? check.nextPermittedStageKey : null,
      readAt: check?.checkedAt && Date.parse(check.checkedAt) > 0 ? check.checkedAt : null,
      lastEvidenceAt: evidenceTimes[0] ?? null,
      sourceHealth: view.projection.sourceHealth,
      gaps,
      receipts: view.receipts.map(rowFromReceipt),
    },
  };
}
