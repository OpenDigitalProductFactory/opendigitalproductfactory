import type { SurfaceDefinition } from "@dpf/types";
import { translate } from "@dpf/i18n";
import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const FINANCE_EXPENSE_GUIDANCE_ID = "finance.expense-guidance";
export const FINANCE_EXPENSE_GUIDANCE_LOADER = "finance.expense-workflow";
export const FINANCE_EXPENSE_GUIDANCE_ROUTES = ["/finance", "/finance/spend", "/finance/my-expenses", "/finance/my-expenses/new"] as const;

/** Workflow instructions are not evidence of anyone's actual claims or money.
 * Ambiguous, mixed and operational questions keep the normal tool-backed path. */
const workflowWords = new Set(("where exactly do i go to start my own personal an a the expense expenses claim claims which what fields field information are is required optional on native form for and how draft saving save as submission submitting submit approval differ difference between versus vs does mean need must with at least one title date category description positive amount receipt url notes keeps it later requests review without moving money explain please can you help me understand").split(" "));
const restrictionWords = new Set("guidance only do not create or submit a claim post journal move money change settings contact anyone".split(" "));
const metaWords = new Set("please answer here once using the current finance context".split(" "));
const wordsIn = (text: string, vocabulary: ReadonlySet<string>) =>
  (text.toLowerCase().match(/[a-z]+/g) ?? []).every(word => vocabulary.has(word));

export function isExpenseWorkflowGuidance(content: string): boolean {
  let hasWorkflowQuestion = false;
  for (let sentence of content.split(/[?.!;]/).map(part => part.trim()).filter(Boolean)) {
    if (/^guidance only:\s*do not\b/i.test(sentence) && wordsIn(sentence, restrictionWords)) continue;
    if (/^please answer\b/i.test(sentence) && wordsIn(sentence, metaWords)) continue;
    sentence = sentence.replace(/^for the current [a-z0-9 '-]{1,60} setup,\s*/i, "");
    // Positive, bounded vocabulary plus a supported question in EACH clause.
    // Unrecognized wording keeps tools; a nearby workflow keyword is no waiver.
    if (!wordsIn(sentence, workflowWords)) return false;
    let draftQuestion = false;
    for (const clause of sentence.split(/\band\b|,\s*(?=(?:what|which|where|how)\b)/i).map(part => part.trim()).filter(Boolean)) {
      const fields = /\b(?:what|which|how|explain)\b/.test(clause.toLowerCase())
        && /\b(?:fields?|information|form)\b/i.test(clause) && /\b(?:required|optional|need|must)\b/i.test(clause);
      const entry = /\b(?:where|how)\b.*\b(?:start|enter|entry)\b/i.test(clause) && /\b(?:expense|expenses|claim|claims)\b/i.test(clause);
      const draft = /^(?:what is (?:the )?difference between (?:saving (?:a )?draft|draft)|how do draft|explain (?:draft|submission|saving (?:a )?draft|submitting for approval)|what does (?:save as draft|saving (?:a )?draft|submit for approval|submitting for approval|submission) (?:mean|do))$/i.test(clause);
      const continuation = draftQuestion && /^(?:submission|submitting)(?:\s+(?:for|approval|differ))*$/i.test(clause);
      if (!fields && !entry && !draft && !continuation) return false;
      hasWorkflowQuestion = true;
      draftQuestion = draft;
    }
  }
  return hasWorkflowQuestion;
}

export const FINANCE_EXPENSE_GUIDANCE_SURFACE: SurfaceDefinition = {
  contractVersion: "1.0", surfaceId: FINANCE_EXPENSE_GUIDANCE_ID,
  label: "Personal expense workflow", purpose: "Explain the native expense-entry form; no live financial values or claim state.",
  supportedModes: ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"],
  entryPoints: FINANCE_EXPENSE_GUIDANCE_ROUTES.map(pattern => ({ kind: "route" as const, pattern })),
  loaderId: FINANCE_EXPENSE_GUIDANCE_LOADER,
  nodes: [
    { nodeId: "expense-workflow", kind: "surface", accessibleName: "Personal expense workflow", valuePolicy: "none", sensitivity: "internal" },
    { nodeId: "expense-workflow.entry", parentId: "expense-workflow", kind: "record", accessibleName: "Enter an expense", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "expense-workflow.instructions", parentId: "expense-workflow", kind: "record", accessibleName: "Form instructions", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "expense-workflow.prerequisite", parentId: "expense-workflow", kind: "record", accessibleName: "Profile prerequisite", valuePolicy: "read", sensitivity: "internal" },
  ],
  actions: [],
};

/** Shares the same catalog as the rendered form. Never loads financial rows. */
export function projectExpenseWorkflowGuidance(locale: string): SurfaceLoaderResult {
  const entry = "[Enter an expense](/finance/my-expenses/new).";
  const instructions = translate(locale, "shell", "finance.expenseEntryDetails");
  const prerequisite = `If the form reports no linked employee profile: ${translate(locale, "shell", "finance.expenseProfileRequired")}`;
  return {
    revisionSeed: JSON.stringify([locale, entry, instructions, prerequisite]),
    summary: { label: "Personal expense workflow", purpose: "Static native form guidance, not a check of claims, balances or employee linkage.",
      highlights: [entry, instructions, prerequisite] },
    values: { "expense-workflow.entry": entry, "expense-workflow.instructions": instructions, "expense-workflow.prerequisite": prerequisite },
  };
}
