// Canonical "operator confirmed a business answer → org WWWD corpus" capture.
//
// One path shared by the two surfaces that elicit first-party business
// knowledge: the `record_org_business_answer` MCP tool (a coworker captures an
// answer mid-conversation) and the /coworker-decisions/review answer-once affordance (the
// operator answers a gap the gate deferred on). Both route the confirmed answer
// through enrichOrgCorpus with qa provenance + first-party trust, landing
// draft-by-default per BI-1378 — so nothing becomes authoritative without human
// review. Keeping it in one place means the elicitation contract can't drift
// between the tool and the review surface.

import {
  enrichOrgCorpus,
  type EnrichOrgCorpusInput,
  type EnrichOrgCorpusResult,
} from "./enrich-org-corpus";

export type CaptureOrgAnswerInput = {
  organizationId: string;
  /** The business question that was asked. */
  question: string;
  /** The operator's confirmed answer, in their own words as far as practical. */
  answer: string;
  /** Optional short label for the knowledge; defaults to the question. */
  topic?: string | null;
  userId: string;
  agentId?: string | null;
  /** Inference client (injected so callers/tests control the model path). */
  infer: EnrichOrgCorpusInput["infer"];
};

export async function captureOrgBusinessAnswer(
  input: CaptureOrgAnswerInput,
): Promise<EnrichOrgCorpusResult> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  return enrichOrgCorpus({
    organizationId: input.organizationId,
    text: `Question: ${question}\n\nConfirmed answer: ${answer}`,
    title: (input.topic && input.topic.trim()) || question,
    provenance: { sourceType: "qa", sourceRef: { question, askedBy: input.userId } },
    trust: "first-party",
    agentId: input.agentId ?? null,
    userId: input.userId,
    infer: input.infer,
  });
}
