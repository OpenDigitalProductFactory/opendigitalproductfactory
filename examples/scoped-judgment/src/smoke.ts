import {
  evaluateScopedAdvice, decide, type JudgmentOwner, type JudgmentReference,
  type ScopedAdvice, type ScopedAdviceInput, type TrustedJudgmentContext,
} from "../kernel/judgment/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const ref = (id: string, revision = "1"): JudgmentReference => ({ id, revision, digest: `synthetic:${id}:${revision}` });
const domain = {
  validateFeatures: (options: Readonly<ScopedAdviceInput["options"]>) => options.flatMap((option) =>
    Object.keys(option.features).filter((key) => !["benefit", "effort", "quality"].includes(key))),
};
function request(scope: JudgmentOwner["scope"] = "wwwd"): ScopedAdviceInput {
  const owner = { scope, id: `synthetic-${scope}-owner` };
  return {
    owner, subject: { id: "customer-report", revision: "1", ...(scope === "wsid" ? { producingGateId: "synthetic-profession-gate" } : {}) },
    context: {
      owner, reference: ref("context"), currentReference: ref("context"), status: "current",
      principles: [{ reference: ref("cost"), currentReference: ref("cost"), status: "current",
        principle: { id: "cost", name: "Higher effort is a worse cost magnitude", tier: "core", weight: 1,
          dimensionVector: { benefit: 1, effort: -1, quality: 1 } } }],
    },
    options: [
      { id: "bounded", description: "Bounded customer report", features: { benefit: .8, effort: .1, quality: .8 } },
      { id: "costly", description: "More expensive alternative", features: { benefit: .8, effort: .9, quality: .8 } },
    ],
    eligibility: ["bounded", "costly"].map((optionId) => ({
      optionId, eligible: true, reasons: [], constraintReferences: [ref("approved-data-boundary")],
    })),
  };
}
/** Sample host only: admitted bytes represent a separately completed exact-content human gate. */
function ownerCapture(request: ScopedAdviceInput, advice: ScopedAdvice, authenticatedOwner: JudgmentOwner, admittedBytes: string | null): TrustedJudgmentContext | null {
  const context = request.context;
  if (admittedBytes !== JSON.stringify({ request, advice }) || !context || advice.status !== "advice" || advice.feedback === "unsupported"
    || authenticatedOwner.scope !== request.owner.scope || authenticatedOwner.id !== request.owner.id
    || advice.owner?.scope !== request.owner.scope || advice.owner.id !== request.owner.id
    || advice.subject?.id !== request.subject.id || advice.subject.revision !== request.subject.revision
    || advice.contextReference?.id !== context.reference.id
    || advice.contextReference.revision !== context.reference.revision || advice.contextReference.digest !== context.reference.digest
    || context.status !== "current" || context.reference.revision !== context.currentReference.revision
    || context.reference.digest !== context.currentReference.digest) return null;
  return { ...context, reference: ref("context", "2"), currentReference: ref("context", "2") };
}
export function runSmoke(): { passed: string[]; qualification: string } {
  const passed: string[] = [];
  for (const scope of ["wwmd", "wwwd", "wsid"] as const) {
    const value = request(scope);
    const result = evaluateScopedAdvice(value, domain);
    assert(result.status === "advice" && result.evaluation?.recommendation?.optionId === "bounded", `${scope}: cost convention/owner advice`);
    assert(result.authority === "advisory-only" && !("allowed" in result) && !("permit" in result), "advice grants no authority");
    assert(result.owner?.id === value.owner.id && result.subject?.producingGateId === value.subject.producingGateId, "owner/producing gate retained");
    assert(result.feedback === (scope === "wsid" ? "unsupported" : "owner-capture-required"), "feedback scope support explicit");
    passed.push(`${scope} synthetic advice, exact owner and independent admission`);
  }
  {
    const value = request(); value.context!.owner = { scope: "wwmd", id: "synthetic-platform" };
    assert(evaluateScopedAdvice(value, domain).status === "held", "platform fallback must not supply missing company authority");
    value.context = null;
    assert(evaluateScopedAdvice(value, domain).status === "held", "missing owner context held");
    passed.push("missing/cross-scope/cross-owner context hold");
  }
  {
    const value = request(); value.context!.currentReference = ref("context", "2");
    assert(evaluateScopedAdvice(value, domain).diagnostics.some((d) => d.code === "stale-context"), "stale context held");
    value.context = request().context; value.context!.principles[0]!.status = "revoked";
    assert(evaluateScopedAdvice(value, domain).diagnostics.some((d) => d.code === "revoked-context"), "revoked principle held");
    passed.push("stale context and revoked principle hold");
  }
  {
    const value = request(); value.eligibility[0]!.eligible = false; value.eligibility[0]!.reasons = ["outside hard constraint"];
    const advice = evaluateScopedAdvice(value, domain);
    assert(advice.evaluation?.recommendation?.optionId === "costly" && advice.evaluation.scores.length === 1, "hard constraints precede preference");
    value.eligibility[1]!.eligible = false; value.eligibility[1]!.reasons = ["budget absent"];
    assert(evaluateScopedAdvice(value, domain).evaluation === undefined, "all ineligible remains held");
    passed.push("hard eligibility before preferences; all-ineligible hold");
  }
  {
    const value = request(); value.options[1]!.id = " bounded ";
    assert(evaluateScopedAdvice(value, domain).status === "held", "trimmed duplicate identity held");
    value.options = request().options; value.options[0]!.features.effort = NaN;
    assert(evaluateScopedAdvice(value, domain).status === "held", "nonfinite input held");
    assert(evaluateScopedAdvice(request()).status === "held", "missing catalog validator held");
    passed.push("identity, numeric and domain-port validation");
  }
  {
    const value = request(), result = evaluateScopedAdvice(value, domain);
    const admittedBytes = JSON.stringify({ request: value, advice: result });
    assert(value.context!.reference.revision === "1", "advice must not mutate standing context");
    assert(ownerCapture(value, result, value.owner, null) === null, "advice/feedback intent alone does not promote context");
    assert(ownerCapture(value, result, { scope: "wwmd", id: "other-owner" }, admittedBytes) === null, "wrong-scope capture refused");
    assert(ownerCapture(value, result, { scope: "wwwd", id: "other-org" }, admittedBytes) === null, "wrong company capture refused");
    value.options[0]!.description = "Altered after independent admission";
    assert(ownerCapture(value, result, value.owner, admittedBytes) === null, "changed reviewed payload refused");
    value.options[0]!.description = request().options[0]!.description;
    const next = ownerCapture(value, result, value.owner, admittedBytes);
    assert(next?.reference.revision === "2", "explicit synthetic owner gate capture");
    const again = evaluateScopedAdvice({ ...value, context: next }, domain);
    assert(again.contextReference?.revision === "2" && again.status === "advice", "next equivalent consult reads revisioned same-owner context");
    const wsid = request("wsid");
    const wsidAdvice = evaluateScopedAdvice(wsid, domain);
    assert(ownerCapture(wsid, wsidAdvice, wsid.owner, JSON.stringify({ request: wsid, advice: wsidAdvice })) === null, "portable WSID feedback unsupported");
    passed.push("synthetic WWWD capture/re-consult and wrong-owner/WSID refusal");
  }
  {
    const noSignal = decide([{ id: "a", description: "No overlap or embedding", features: {} }], [
      { id: "p", name: "Unrelated synthetic principle", tier: "core", weight: 1, dimensionVector: { unrelated: 1 } },
    ]);
    assert(noSignal.recommendation === null && noSignal.flags.insufficientSignal === true, "raw no-signal abstention preserved");
    passed.push("raw scoring no-signal abstention compatibility");
  }
  return { passed, qualification: "Synthetic advisory fixture only; native gates, production ownership, corpus quality, human admission and enforcement remain unqualified." };
}
