// TAK precondition-ordering verdict types, shared by the precondition gate
// (lib/tak/precondition-ordering-gate.ts), the governed executor's result,
// and the receipt and audit writers.
//
// Types only, and a leaf with no imports: keeping these out of the gate lets
// the governed-execute contract (lib/mcp-governed-execute-types.ts) name them
// without an import edge back into the gate (dependency-diet plan, M11 step 2).

export type PreconditionOrderingCheck = {
  key: string;
  coherent: boolean;
  satisfied: boolean;
  evidenceRefs: [string, string];
};

export type PreconditionOrderingDecision = {
  verdict: "approve" | "decline" | "escalate";
  rationale: string;
  checks: PreconditionOrderingCheck[];
};
