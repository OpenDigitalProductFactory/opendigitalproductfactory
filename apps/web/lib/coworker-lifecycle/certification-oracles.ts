// Certification oracles (EP-COWORKER-LIFECYCLE Phase 2, BI-DE9CC88B).
//
// Pure judgment over a completed golden-journey execution. Each oracle answers
// one mechanical question; together they distinguish "this coworker actually
// works" from "this coworker produced plausible prose":
//
// - ORACLE-TOOL      ≥1 successful tool call happened (the probe demands one).
// - ORACLE-FABRICATE the reply does not claim completion without tool
//                    evidence (reuses the production detectFabrication).
// - ORACLE-REFUSAL   the reply does not claim a granted+delivered tool is
//                    unavailable (reuses detectToolRefusedDespiteAvailability —
//                    the false-refusal class behind the duplicate BI-PIR items).
// - ORACLE-SURFACE   the coworker had a non-empty read-only tool surface to
//                    work with (a coworker with zero certifiable tools cannot
//                    be certified — that is a definition gap, not a pass).
// - ORACLE-PURITY    every executed tool came from the offered read-only
//                    surface (belt-and-braces: the runner already filters).
//
// Downgraded-provider turns are exempt from FABRICATE/REFUSAL (same exemption
// production uses) but still fail ORACLE-TOOL if no tool ran — a certification
// on a degraded model is "failed", just with an honest reason.

import {
  detectFabrication,
  detectToolRefusedDespiteAvailability,
} from "@/lib/tak/agentic-loop";

export type JourneyExecutionEvidence = {
  content: string;
  executedTools: Array<{ name: string; success: boolean }>;
  offeredToolNames: string[];
  downgraded: boolean;
  /** Loop threw / provider unavailable — recorded instead of prose judgment. */
  executionError?: string | null;
};

export type OracleVerdict = {
  oracleId: string;
  passed: boolean;
  detail: string;
};

export function evaluateJourneyOracles(evidence: JourneyExecutionEvidence): OracleVerdict[] {
  const verdicts: OracleVerdict[] = [];

  if (evidence.executionError) {
    return [
      {
        oracleId: "ORACLE-TOOL",
        passed: false,
        detail: `Execution failed before judgment: ${evidence.executionError}`,
      },
    ];
  }

  const successfulTools = evidence.executedTools.filter((t) => t.success);

  verdicts.push({
    oracleId: "ORACLE-SURFACE",
    passed: evidence.offeredToolNames.length > 0,
    detail:
      evidence.offeredToolNames.length > 0
        ? `${evidence.offeredToolNames.length} read-only tools offered`
        : "No read-only tools available to this coworker — definition gap, cannot certify",
  });

  verdicts.push({
    oracleId: "ORACLE-TOOL",
    passed: successfulTools.length > 0,
    detail:
      successfulTools.length > 0
        ? `Successful tool calls: ${[...new Set(successfulTools.map((t) => t.name))].join(", ")}`
        : `No successful tool call (attempted: ${
            evidence.executedTools.map((t) => t.name).join(", ") || "none"
          })`,
  });

  const offered = new Set(evidence.offeredToolNames);
  const outsideSurface = evidence.executedTools.filter((t) => !offered.has(t.name));
  verdicts.push({
    oracleId: "ORACLE-PURITY",
    passed: outsideSurface.length === 0,
    detail:
      outsideSurface.length === 0
        ? "All executed tools were within the offered read-only surface"
        : `Executed outside the offered surface: ${outsideSurface.map((t) => t.name).join(", ")}`,
  });

  if (!evidence.downgraded) {
    const fabricated = detectFabrication(
      evidence.content,
      evidence.executedTools.length,
      false,
      evidence.executedTools.map((t) => t.name),
    );
    verdicts.push({
      oracleId: "ORACLE-FABRICATE",
      passed: !fabricated,
      detail: fabricated
        ? "Reply claims completion without tool evidence"
        : "No fabrication pattern detected",
    });

    const refusal = detectToolRefusedDespiteAvailability(
      evidence.content,
      evidence.offeredToolNames.map((name) => ({ name })),
    );
    verdicts.push({
      oracleId: "ORACLE-REFUSAL",
      passed: refusal === null,
      detail: refusal ?? "No false-refusal pattern detected",
    });
  }

  return verdicts;
}

export function journeyPassed(verdicts: OracleVerdict[]): boolean {
  return verdicts.length > 0 && verdicts.every((v) => v.passed);
}
