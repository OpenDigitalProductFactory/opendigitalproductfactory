import { NextResponse } from "next/server";

import type { GovernedTerminalTransitionResult } from "./terminal-transition-repository";

/** Keep protected REST terminal denials stable across every domain adapter. */
export function terminalTransitionConflict(
  terminal: Extract<GovernedTerminalTransitionResult, { ok: false }>,
) {
  return NextResponse.json({
    code: "INITIATIVE_NOT_READY",
    stableCode: terminal.code,
    message: "Initiative completion is blocked.",
    decisionId: terminal.decision.decisionId,
    blockers: terminal.decision.blockers.map((entry) => entry.code),
    unmet: terminal.decision.unmet.map((entry) => entry.code),
  }, { status: 409 });
}
