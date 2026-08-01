// Incumbent coverage — stage 3 (AI proposal) of the D3 pipeline (BI-548060D5).
//
// Spec 2026-07-23 §5.4 stage 3: for incumbents neither the posture matrix (stage
// 1) nor the rule stage (stage 2) could classify, an AI assessment PROPOSAL with
// an evidence trail. assessedVia=ai, ALWAYS status=proposed, never auto-confirmed
// (spec §7). Lives in apps/web because it needs the inference chain; packages/db
// must not depend on apps/web.
//
// The LLM call is injected (CoverageProposer) so the stage logic is unit-testable
// without inference; routedInferenceProposer is the thin adapter that wires the
// real routeAndCall. Correct over an empty set — 0 gap incumbents → 0 AI calls.

import type { PrismaClient } from "@dpf/db";
// Import from NARROW, client-free subpaths — not the root @dpf/db barrel. The
// barrel pulls client-dependent modules whose init can fail in the test/edge
// env, leaving later barrel exports undefined; these two pure modules load
// cleanly on their own.
import { ABSORPTION_VERDICTS } from "@dpf/db/portfolio-sources/absorption-posture";
import { assessmentIdFor } from "@dpf/db/portfolio-sources/incumbent-coverage";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export interface AiVerdictProposal {
  verdict: string;
  reason: string;
}

/** Parse + validate an LLM response into a verdict proposal. Pure. Tolerates a
 *  fenced/` ```json ` wrapper. Returns null if no valid closed-enum verdict. */
export function parseAiVerdict(text: string): AiVerdictProposal | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const verdict = typeof obj.verdict === "string" ? obj.verdict : "";
  if (!(ABSORPTION_VERDICTS as readonly string[]).includes(verdict)) return null;
  const reason = typeof obj.reason === "string" ? obj.reason : "";
  return { verdict, reason };
}

export interface IncumbentForProposal {
  name: string;
  vendor: string | null;
}

/** Proposes a verdict for one incumbent. Injected so the stage is testable. */
export type CoverageProposer = (incumbent: IncumbentForProposal) => Promise<AiVerdictProposal | null>;

export interface AiStageResult {
  /** Gap assessments upgraded to an AI proposal. */
  proposed: number;
  /** Left as gap (no proposal / error / confirmed). */
  skipped: number;
}

/**
 * Stage 3 — AI proposal for gap incumbents. Reads the current gap assessments
 * (never human-confirmed ones), asks the proposer, and writes the proposed
 * verdict with `assessedVia=ai`, `status=proposed` (never confirmed) and an
 * evidence trail. A proposer error on one incumbent is isolated, not fatal.
 */
export async function assessGapsViaAi(
  db: PrismaClient,
  propose: CoverageProposer,
): Promise<AiStageResult> {
  const result: AiStageResult = { proposed: 0, skipped: 0 };

  const gaps = await db.incumbentCoverageAssessment.findMany({
    where: { verdict: "gap", status: { not: "superseded" }, assessedVia: { not: "human_confirmed" } },
    select: { assessmentId: true, digitalProductId: true },
  });

  for (const gap of gaps) {
    const dp = await db.digitalProduct.findUnique({
      where: { productId: gap.digitalProductId },
      select: { name: true, observationConfig: true },
    });
    if (!dp) {
      result.skipped += 1;
      continue;
    }
    const cfg = dp.observationConfig;
    const vendor =
      cfg && typeof cfg === "object" && !Array.isArray(cfg) && typeof (cfg as Record<string, unknown>).vendor === "string"
        ? ((cfg as Record<string, unknown>).vendor as string)
        : null;

    let proposal: AiVerdictProposal | null = null;
    try {
      proposal = await propose({ name: dp.name, vendor });
    } catch (e) {
      proposal = null;
      console.error(`[coverage-ai] proposer failed for ${gap.digitalProductId}: ${getErrorMessage(e)}`);
    }
    if (!proposal) {
      result.skipped += 1;
      continue;
    }

    await db.incumbentCoverageAssessment.update({
      where: { assessmentId: assessmentIdFor(gap.digitalProductId) },
      data: {
        verdict: proposal.verdict,
        assessedVia: "ai",
        status: "proposed",
        confidence: 0.5,
        evidence: { via: "ai", provider: vendor ?? dp.name, reason: proposal.reason },
      },
    });
    result.proposed += 1;
  }

  return result;
}

// ─── Thin adapter: wire the real inference chain as a CoverageProposer ───────

type RouteAndCall = (
  messages: { role: "user" | "system" | "assistant"; content: string }[],
  systemPrompt: string,
  sensitivity?: "internal",
  options?: unknown,
) => Promise<{ content?: string; text?: string }>;

// Built lazily (inside the adapter) so module load never evaluates
// ABSORPTION_VERDICTS at top level.
function aiSystemPrompt(): string {
  return (
    "You classify how a business platform (DPF) should treat a third-party application a customer runs today. " +
    `Reply ONLY with JSON: {"verdict": one of ${ABSORPTION_VERDICTS.join("|")}, "reason": short justification}. ` +
    "Default conservatively to provider_led or gap when unsure — never overstate that DPF natively replaces the app."
  );
}

/** Adapter turning routeAndCall into a CoverageProposer. Kept thin — the stage
 *  logic + parsing are the tested parts; this only builds the prompt and reads
 *  the response text. */
export function routedInferenceProposer(routeAndCall: RouteAndCall): CoverageProposer {
  return async (incumbent) => {
    const user = `Application: ${incumbent.name}${incumbent.vendor ? ` (vendor: ${incumbent.vendor})` : ""}.`;
    const res = await routeAndCall([{ role: "user", content: user }], aiSystemPrompt(), "internal");
    const text = res.content ?? res.text ?? "";
    return parseAiVerdict(text);
  };
}
