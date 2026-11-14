// Hand a Workroom's runtime thread from one agent CLI to the other (BI-1687CCD2,
// part of BI-05715F4C; design 2026-10-07-durable-delegation-ledger-design.md §4.7).
//
// A provider thread only resumes in its own CLI. When a room opens a session
// with the other provider, the new session starts from a handoff built from the
// room's own log: what the previous runtime was asked, said, decided and held,
// newest kept first within a fixed budget (T3 Code's ContextHandoffService uses
// the same shape: deterministic, budgeted, coverage and omissions recorded).

import { prisma } from "@dpf/db";

import type { RuntimeProvider } from "./types";

export const HANDOFF_BUDGET_BYTES = 64 * 1024;
/** The runtime's own entries in the room log (supervisor.ts runtimeActor). */
const RUNTIME_AGENT_ID = "workroom-runtime";
const RUNTIME_KINDS = ["action", "response", "question", "error", "executor-changed"];

export type RuntimeHandoff = {
  text: string;
  /** Log entries carried into the handoff, and the older ones the budget left out. */
  included: number;
  omitted: number;
  bytes: number;
};

type LogEntry = { kind: string; summary: string; recordedAt: Date; sequence: number | null };

/** Render the handoff from log entries, oldest first, keeping the newest that fit the budget. */
export function renderRuntimeHandoff(input: {
  entries: readonly LogEntry[];
  fromProvider: RuntimeProvider;
  toProvider: RuntimeProvider;
  budgetBytes?: number;
}): RuntimeHandoff {
  const budget = input.budgetBytes ?? HANDOFF_BUDGET_BYTES;
  const header = `This Workroom's runtime moves from ${input.fromProvider} to ${input.toProvider}. `
    + "Below is what the previous session was asked, said and decided, from the room's log, oldest first. "
    + "Continue the same work; do not repeat steps already done.\n";
  const lines = input.entries.map((entry) => `[${entry.recordedAt.toISOString()} ${entry.kind}] ${entry.summary.replace(/\s+/g, " ").trim()}`);
  const kept: string[] = [];
  let bytes = Buffer.byteLength(header);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const size = Buffer.byteLength(lines[index]!) + 1;
    if (bytes + size > budget) break;
    kept.unshift(lines[index]!);
    bytes += size;
  }
  const omitted = lines.length - kept.length;
  const note = omitted > 0 ? `(${omitted} earlier entries left out to fit the handoff.)\n` : "";
  const text = `${header}${note}${kept.join("\n")}`;
  return { text, included: kept.length, omitted, bytes: Buffer.byteLength(text) };
}

/** Build the handoff from the room's runtime log since the previous session opened. */
export async function buildRuntimeHandoff(input: {
  roomId: string;
  fromProvider: RuntimeProvider;
  toProvider: RuntimeProvider;
  since: string | null;
}): Promise<RuntimeHandoff> {
  const since = input.since ? new Date(input.since) : null;
  const entries = await prisma.workroomActivity.findMany({
    where: {
      workCapsuleId: input.roomId,
      kind: { in: RUNTIME_KINDS },
      recordedByAgentId: RUNTIME_AGENT_ID,
      ...(since && !Number.isNaN(since.getTime()) ? { recordedAt: { gte: since } } : {}),
    },
    // Newest first so a long log keeps its latest work; rendered oldest first.
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { kind: true, summary: true, recordedAt: true, sequence: true },
    take: 2000,
  });
  return renderRuntimeHandoff({ entries: entries.reverse(), fromProvider: input.fromProvider, toProvider: input.toProvider });
}
