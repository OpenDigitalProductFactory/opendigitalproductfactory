// Naming which scope owns a question, before a gate answers it (BI-13C38318).
//
// decisions-belong-to-their-scope is explicit: "Before deciding, name which
// scope owns the question" — platform and build in WWMD, the organization's own
// business call in WWWD, craft in WSID — and "a deferred decision goes to the
// right person, not a generic queue".
//
// Nothing in the WWWD initiation path performed that naming. An authored
// question reached the org-business gate and WWWD asserted authority over it by
// default. That is how six field-service privacy questions — employee-location
// capture, evidence-photo PII, lawful basis per jurisdiction — came to be asked
// of a SOFTWARE-PLATFORM organization's business stance on the customer 0
// install. They are craft (WSID), or product (WWMD), or a customer's own
// archetype. None of them is "what would this software business do", and no
// amount of stance corpus would have answered them, because the corpus was
// never the right authority.
//
// WHY THIS DOES NOT CLASSIFY THE QUESTION ITSELF.
// The obvious move is to infer the scope from the question text. That is
// exactly what `extractAlignmentCriteria` did for alignment criteria, and it
// became a regex taxonomy shaped by its own test fixtures that force-escalated
// 62 of 63 decisions (BI-9E1E1939). Inference over natural language, graded
// against a closed vocabulary, decays into a fixture list. So scope is
// DECLARED, or DERIVED from a fact the platform already records, and otherwise
// REFUSED with a pick list — the same contract `work_shape_required` uses for
// delivery shape: put the list to the caller and let them name it, never guess.

export const DECISION_SCOPES = ["wwmd", "wwwd", "wsid"] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];

export type DecisionScopePick = {
  ref: DecisionScope;
  title: string;
  /** What the scope owns, in the terms a caller can check their question against. */
  definition: string;
  /** Whose judgement answers it, and who is escalated to when it defers. */
  authority: string;
  /** Where to take the question instead, when this is the owning scope. */
  route: string;
};

/** The structured pick list a `decision_scope_required` refusal carries. */
export const DECISION_SCOPE_PICK_LIST: readonly DecisionScopePick[] = [
  {
    ref: "wwmd",
    title: "Platform / build decision",
    definition:
      "How the platform itself is built, operated or released — architecture, engineering trade-offs, a pull request, a deployment, a tool's own behaviour. Also any question about how a supplier's product works.",
    authority: "The founder kernel; escalates to the platform contributor or Build Studio owner.",
    route: "principle_decide",
  },
  {
    ref: "wwwd",
    title: "This organization's business decision",
    definition:
      "What this business sells, who it serves, what it charges, what it promises, how it treats customers and their data, and how it spends its own money. The test is whether the business itself is free to answer differently from another business in the same trade.",
    authority: "The organization's own recorded stance; escalates to the business owner or operator.",
    route: "evaluate_org_business_decision",
  },
  {
    ref: "wsid",
    title: "Professional or craft decision",
    definition:
      "What a qualified practitioner should do — legal, privacy, regulatory, clinical, accounting or another trade's standard of care. A business may set its posture around these, but it does not get to decide the craft answer, and lawful basis is not a matter of business preference.",
    authority: "The profession corpus; escalates to the calling context's human.",
    route: "evaluate_profession_decision",
  },
];

export type ScopeAdmission =
  | { admitted: true; scope: DecisionScope; derivedFrom: "declared" | "tool-consequence-scope" }
  | {
      admitted: false;
      reason: "scope-unestablished";
      message: string;
      pickList: readonly DecisionScopePick[];
    }
  | {
      admitted: false;
      reason: "wrong-scope";
      scope: DecisionScope;
      message: string;
      route: string;
    };

function pickFor(scope: DecisionScope): DecisionScopePick {
  return DECISION_SCOPE_PICK_LIST.find((entry) => entry.ref === scope)!;
}

export function isDecisionScope(value: unknown): value is DecisionScope {
  return typeof value === "string" && (DECISION_SCOPES as readonly string[]).includes(value);
}

/**
 * Decide whether the org business gate may answer this question.
 *
 * `declared` wins, because the caller naming the scope IS the contract.
 * Otherwise the only derivation used is a fact the platform already records
 * about itself — `ToolDefinition.consequenceScope`, declared with the tool
 * (BI-63B14D4B) — never a reading of the question text.
 */
export function admitToOrgBusinessGate(input: {
  declaredScope?: unknown;
  /** Present when the call originated from a governed tool, not an author. */
  toolConsequenceScope?: "platform" | "business";
}): ScopeAdmission {
  const declared = input.declaredScope;
  if (declared !== undefined && declared !== null && declared !== "") {
    if (!isDecisionScope(declared)) {
      return {
        admitted: false,
        reason: "scope-unestablished",
        message:
          `"${String(declared)}" is not a decision scope. Name the scope that owns this question, or leave it unset to be asked.`,
        pickList: DECISION_SCOPE_PICK_LIST,
      };
    }
    if (declared !== "wwwd") {
      const pick = pickFor(declared);
      return {
        admitted: false,
        reason: "wrong-scope",
        scope: declared,
        route: pick.route,
        message:
          `This is a ${pick.title.toLowerCase()}, so this organization's business stance is not the authority for it. `
          + `${pick.authority} Take it to ${pick.route}. `
          + "Recording it here would put a question the business cannot answer into the owner's decision queue.",
      };
    }
    return { admitted: true, scope: "wwwd", derivedFrom: "declared" };
  }

  if (input.toolConsequenceScope === "business") {
    return { admitted: true, scope: "wwwd", derivedFrom: "tool-consequence-scope" };
  }
  if (input.toolConsequenceScope === "platform") {
    const pick = pickFor("wwmd");
    return {
      admitted: false,
      reason: "wrong-scope",
      scope: "wwmd",
      route: pick.route,
      message:
        "This tool's effect is platform development or operations, so the founder kernel owns the judgement, not this organization's business stance.",
    };
  }

  return {
    admitted: false,
    reason: "scope-unestablished",
    message:
      "Name the scope that owns this question before it is decided. It is not inferred from the wording: "
      + "guessing the owning authority from question text is how a question that was never this business's to answer "
      + "reaches the owner's queue, and how it sits there unanswerable. Pick the scope, then call the tool for it.",
    pickList: DECISION_SCOPE_PICK_LIST,
  };
}
