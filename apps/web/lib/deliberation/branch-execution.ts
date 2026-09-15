// Making a deliberation branch actually say something.
//
// THE GAP THIS CLOSES (BI pending — filed against EP-0AF96937)
//
// The runner used to route a branch — pick a provider and a model, record the
// choice — and then mark the node complete without calling anything. Every
// branch finished in zero seconds with no position, so the synthesizer found
// nothing to merge and every deliberation on every pattern returned the same
// sentence: "Insufficient evidence to produce a recommendation." Measured on
// the live install: review 1207/1210 complete, debate 198/198, governance
// triage 263/275 — one distinct outcome between them.
//
// Routing decides WHERE a branch runs. This module makes it run.

import type { ChatMessage } from "@/lib/ai-inference";

/** What a branch came back with, in the shape the synthesizer consumes. */
export type BranchPosition = {
  recommendation: string | null;
  rationale: string | null;
  raw: string;
};

/**
 * The instruction every branch answers. Kept blunt: the synthesizer detects
 * consensus by normalized-text similarity across branches, so a wandering
 * preamble makes two agreeing specialists look like disagreement.
 */
const POSITION_CONTRACT = [
  "Answer in exactly this shape, nothing before or after:",
  "",
  "RECOMMENDATION: <one short line — the action you advise>",
  "RATIONALE: <two or three sentences — why, from your profession's view>",
  "",
  "If the brief does not give you enough to judge, say:",
  "RECOMMENDATION: insufficient evidence",
  "and use RATIONALE to name the single fact you would need.",
].join("\n");

/**
 * Build the turn for one branch. `persona` is the role's own guidance; the
 * brief is the caller's case. A branch with no brief is told so plainly rather
 * than left to invent a subject.
 */
export function buildBranchTurn(input: {
  role: string;
  persona?: string | null;
  brief?: string | null;
  subject?: string | null;
}): { systemPrompt: string; messages: ChatMessage[] } {
  const persona =
    input.persona?.trim() ||
    `You are the ${input.role} on a review panel. Argue your own reading of the question and commit to a recommendation.`;

  const systemPrompt = [persona, "", POSITION_CONTRACT].join("\n");

  const brief = input.brief?.trim();
  const body = brief
    ? [input.subject ? `Subject: ${input.subject}` : null, "", brief]
        .filter((line) => line !== null)
        .join("\n")
    : "No brief was supplied with this deliberation, so there is nothing to weigh.";

  return { systemPrompt, messages: [{ role: "user", content: body }] };
}

/**
 * Pull a position out of a branch's reply.
 *
 * Tolerant of a model that ignores the shape: the first non-empty line becomes
 * the recommendation rather than discarding a real answer on a formatting miss.
 * Returns a null recommendation only when there is genuinely nothing — which
 * the synthesizer then reports honestly instead of inventing consensus.
 */
export function parseBranchPosition(raw: string): BranchPosition {
  const text = (raw ?? "").trim();
  if (text === "") return { recommendation: null, rationale: null, raw: "" };

  const rec = /^\s*RECOMMENDATION:\s*(.+)$/im.exec(text);
  // Deliberately NOT multiline on the rationale: with /m the `$` alternative
  // means end-of-LINE, which silently truncates the multi-line rationales
  // models actually write. Terminate on the next LABEL: line or end of text.
  const rat = /\bRATIONALE:\s*([\s\S]+?)(?=\n\s*[A-Z][A-Z ]+:\s|\s*$)/i.exec(text);

  if (rec) {
    return {
      recommendation: rec[1].trim() || null,
      rationale: rat?.[1]?.trim() || null,
      raw: text,
    };
  }

  const [first, ...rest] = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    recommendation: first ?? null,
    rationale: rest.length > 0 ? rest.join(" ") : null,
    raw: text,
  };
}

/** A position that says "I could not judge" must not count as a verdict. */
export function isAbstention(position: BranchPosition): boolean {
  const rec = position.recommendation?.toLowerCase() ?? "";
  return rec === "" || rec.startsWith("insufficient evidence");
}
