import type { SurfaceDefinition } from "@dpf/types";
import { translate } from "@dpf/i18n";
import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const FINANCE_EXPENSE_GUIDANCE_ID = "finance.expense-guidance";
export const FINANCE_EXPENSE_GUIDANCE_LOADER = "finance.expense-workflow";
export const FINANCE_EXPENSE_GUIDANCE_ROUTES = ["/finance", "/finance/spend", "/finance/my-expenses", "/finance/my-expenses/new"] as const;

/** Workflow instructions are not evidence of anyone's actual claims or money.
 * Ambiguous, mixed and operational questions keep the normal tool-backed path. */
const workflowWords = new Set(("where exactly do i go to start enter entry my own personal an a the expense expenses claim claims which what fields field information are is required optional on native form for and how draft saving save as submission submitting submit approval differ difference between versus vs from does mean need must with at least one title date category description positive amount receipt url notes keeps it later requests review without moving money explain please can you help me understand").split(" "));
const metaWords = new Set("please answer here once using the current finance context".split(" "));
const wordsIn = (text: string, vocabulary: ReadonlySet<string>) =>
  (text.toLowerCase().match(/[a-z]+/g) ?? []).every(word => vocabulary.has(word));

/** Every coordinated phrase stays under the leading prohibition. A later
 * positive instruction (even with known words) must not disappear as context. */
function isGuidanceRestriction(sentence: string): boolean {
  const match = /^guidance only:\s*do not\s+(.+)$/i.exec(sentence);
  return !!match && match[1].split(/,\s*(?:or\s+)?|\s+or\s+/i).every(clause =>
    /^(?:(?:create|submit)(?: (?:a claim|records))?|post a journal|move money|change settings|contact anyone|retry earlier requests)$/i.test(clause.trim()));
}

export function isExpenseWorkflowGuidance(content: string): boolean {
  let hasWorkflowQuestion = false;
  for (let sentence of content.split(/[?.!;]/).map(part => part.trim()).filter(Boolean)) {
    if (isGuidanceRestriction(sentence)) continue;
    if (/^please answer\b/i.test(sentence) && wordsIn(sentence, metaWords)) continue;
    sentence = sentence.replace(/^for the current [a-z0-9 '-]{1,60} setup,\s*/i, "");
    sentence = sentence.replace(/^on (?:this|the) finance page,\s*/i, "");
    // Positive, bounded vocabulary plus a supported question in EACH clause.
    // Unrecognized wording keeps tools; a nearby workflow keyword is no waiver.
    if (!wordsIn(sentence, workflowWords)) return false;
    let draftQuestion = false;
    let entryQuestion = false;
    for (const clause of sentence.split(/\band\b|,\s*(?=(?:what|which|where|how)\b)/i).map(part => part.trim().replace(/,$/, "")).filter(Boolean)) {
      const fields = /\b(?:what|which|how|explain)\b/.test(clause.toLowerCase())
        && /\b(?:fields?|information|form)\b/i.test(clause) && /\b(?:required|optional|need|must)\b/i.test(clause);
      const entry = /\b(?:where|how)\b.*\b(?:start|enter|entry)\b/i.test(clause) && /\b(?:expense|expenses|claim|claims)\b/i.test(clause);
      const draft = /^(?:what is (?:the )?difference between (?:saving (?:a )?draft|draft)|how do draft|explain (?:draft|submission|saving (?:a )?draft|submitting for approval)|what does (?:save as draft|saving (?:a )?draft|submit for approval|submitting for approval|submission) (?:mean|do))$/i.test(clause)
        || /^how does saving (?:a )?draft differ from submitting for approval$/i.test(clause);
      // An exact ellipsis inherits only this sentence's expense-entry question.
      // Standalone or operational "what is required ..." remains tool-backed.
      const entryRequirements = entryQuestion && /^what is required$/i.test(clause);
      const continuation = draftQuestion && /^(?:submission|submitting)(?:\s+(?:for|approval|differ))*$/i.test(clause);
      if (!fields && !entry && !entryRequirements && !draft && !continuation) return false;
      hasWorkflowQuestion = true;
      entryQuestion ||= entry;
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
