// Classify a stored call for its approval lifetime (BI-0012E6CA).
//
// The live gate already holds the call's resolved consequence. Paths that mint
// a request from a STORED call — task recovery and "Ask again" — re-read it here
// from the same declaration and per-call refiner the gate uses, so the fresh
// lifetime follows the current classification. Anything that cannot be read is
// `unclassified`, which keeps the short window.
//
// The tool list is passed in rather than imported: the registry
// (@/lib/mcp-tools) sits in apps/web's largest import cycle, and a leaf that
// imported it would join that cycle along with everything that imports the
// leaf (scripts/check-no-web-import-cycle-growth.mjs). Callers bind it with a
// dynamic import at the edge.

import { resolveCallConsequence, type ToolConsequence, type ToolCallConsequenceRefiner } from "@/lib/tool-consequence";

import type { ApprovalClassification } from "./approval-lifetime";

export type ApprovalCall = {
  toolName: string;
  params: Record<string, unknown>;
  userId: string;
};

export type ClassifyApprovalCall = (call: ApprovalCall) => Promise<ApprovalClassification>;

type ClassifiableTool = {
  name: string;
  consequence?: ToolConsequence;
  consequenceForCall?: ToolCallConsequenceRefiner;
};

/** The call's resolved consequence against a tool registry; `unclassified` when unknown. */
export async function classifyApprovalCallAgainst(
  tools: readonly ClassifiableTool[],
  call: ApprovalCall,
): Promise<ApprovalClassification> {
  try {
    const tool = tools.find((candidate) => candidate.name === call.toolName);
    if (!tool) return "unclassified";
    return (await resolveCallConsequence(tool, call)).consequence;
  } catch {
    return "unclassified";
  }
}
