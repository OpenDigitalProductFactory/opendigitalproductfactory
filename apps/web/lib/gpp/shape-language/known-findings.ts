import type { GppDiagnostic, GppDiagnosticCode, GppRuleId } from "@dpf/validators/gpp/diagnostics";

/** DI-EFCFA7596534: this list may shrink, never silently widen. Offline declared flows only. */
export const KNOWN_FINDING_ELIGIBLE_RULES = [
  { rule: "C-1" }, { rule: "D-1" }, { rule: "D-2" }, { rule: "D-3" },
  { rule: "D-6" }, { rule: "C-3" }, { rule: "C-7", code: "C-7/SANDBOX-CONTAINMENT" },
] as const satisfies readonly { rule: GppRuleId; code?: GppDiagnosticCode }[];

type Eligible = (typeof KNOWN_FINDING_ELIGIBLE_RULES)[number];
type Identity<T extends Eligible> = T extends { code: infer C } ? { rule: T["rule"]; code: C } : { rule: T["rule"]; code?: T["rule"] };
export type KnownFinding = Identity<Eligible> & {
  elementId: string;
  tools?: readonly string[];
  reason: string;
  backlogItemId: `BI-${string}`;
};

export class KnownFindingRefusal extends Error {}

const toolKey = (tools: readonly string[] | undefined) => JSON.stringify([...(tools ?? [])].sort());

/** Validate even stale entries, so a sidecar cannot pre-authorize future violations. */
export function applyKnownFindings(diagnostics: readonly GppDiagnostic[], entries: readonly KnownFinding[]) {
  for (const entry of entries) {
    const eligible = KNOWN_FINDING_ELIGIBLE_RULES.some((allowed) =>
      allowed.rule === entry.rule && (entry.code ?? entry.rule) === ("code" in allowed ? allowed.code : allowed.rule));
    if (!eligible) throw new KnownFindingRefusal(`Known finding ${entry.rule}/${entry.code ?? entry.rule} is not eligible.`);
    if (typeof entry.reason !== "string" || !entry.reason.trim() || !/^BI-\S+$/.test(entry.backlogItemId) || !entry.elementId?.trim()) {
      throw new KnownFindingRefusal("Known findings need an element id, nonempty reason and BI- backlog id.");
    }
    if (entry.tools && (!Array.isArray(entry.tools) || entry.tools.some((tool) => typeof tool !== "string" || !tool.trim()) || new Set(entry.tools).size !== entry.tools.length)) {
      throw new KnownFindingRefusal("Known finding tools must be a set of nonempty tool names.");
    }
  }
  const matched = new Set<KnownFinding>();
  const annotated = diagnostics.map((diagnostic) => {
    const entry = entries.find((candidate) => candidate.rule === diagnostic.rule &&
      (candidate.code ?? candidate.rule) === diagnostic.code && candidate.elementId === diagnostic.elementId &&
      toolKey(candidate.tools) === toolKey(diagnostic.tools));
    if (!entry) return diagnostic;
    matched.add(entry);
    return { ...diagnostic, knownFinding: { reason: entry.reason, backlogItemId: entry.backlogItemId } };
  });
  return { diagnostics: annotated, staleKnownFindings: entries.filter((entry) => !matched.has(entry)) };
}
