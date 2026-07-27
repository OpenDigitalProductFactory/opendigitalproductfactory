import type { CapabilityInstallScope } from "@dpf/db/capability-maturity";

export type WorkPatternActivationEvidenceScope = {
  installScope: CapabilityInstallScope;
  organizationId?: string;
  taskCorpusKey: string;
  modelProfileId: string;
};

export type WorkPatternCorroborationEvidence = WorkPatternActivationEvidenceScope & {
  taskRunId: string;
  terminal: boolean;
  effective: boolean;
  fresh: boolean;
  egressApproved: boolean;
  materiallyDifferentCorpus: boolean;
};

export type PortableCanonicalCorpusEvidence = {
  taskCorpusKey: string;
  verified: boolean;
};

export type MaximumWorkPatternActivationScope = {
  installScopes: CapabilityInstallScope[];
  organizationIds: string[];
  taskCorpusKeys: string[];
  modelProfileIds: string[];
  corroborationTaskRunIds: string[];
  ceiling: "same-install" | "canonical-corpus" | "corroborated";
  blockers: string[];
};

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function qualifyingCorroboration(
  source: WorkPatternActivationEvidenceScope,
  row: WorkPatternCorroborationEvidence,
): boolean {
  return (
    row.installScope === "customer_overlay"
    && row.organizationId !== undefined
    && row.organizationId !== source.organizationId
    && row.taskCorpusKey !== source.taskCorpusKey
    && row.modelProfileId === source.modelProfileId
    && row.terminal
    && row.effective
    && row.fresh
    && row.egressApproved
    && row.materiallyDifferentCorpus
  );
}

export function deriveMaximumActivationScope(input: {
  source: WorkPatternActivationEvidenceScope;
  portableCanonicalCorpus: PortableCanonicalCorpusEvidence | null;
  corroborations: readonly WorkPatternCorroborationEvidence[];
}): MaximumWorkPatternActivationScope {
  const validCorroborations = input.corroborations.filter((row) =>
    qualifyingCorroboration(input.source, row));
  const portable = input.portableCanonicalCorpus?.verified === true
    ? input.portableCanonicalCorpus
    : null;

  const installScopes: CapabilityInstallScope[] = [input.source.installScope];
  if (portable) installScopes.push("canonical");
  if (validCorroborations.length > 0) installScopes.push("customer_overlay");

  const organizationIds = [
    input.source.organizationId,
    ...validCorroborations.map((row) => row.organizationId),
  ].filter((value): value is string => Boolean(value));
  const taskCorpusKeys = [
    input.source.taskCorpusKey,
    ...(portable ? [portable.taskCorpusKey] : []),
    ...validCorroborations.map((row) => row.taskCorpusKey),
  ];
  const corroborationTaskRunIds = validCorroborations.map((row) => row.taskRunId);
  const ceiling = validCorroborations.length > 0
    ? "corroborated"
    : portable
      ? "canonical-corpus"
      : "same-install";

  return {
    installScopes: sortedUnique(installScopes),
    organizationIds: sortedUnique(organizationIds),
    taskCorpusKeys: sortedUnique(taskCorpusKeys),
    modelProfileIds: [input.source.modelProfileId],
    corroborationTaskRunIds: sortedUnique(corroborationTaskRunIds),
    ceiling,
    blockers: ceiling === "same-install"
      ? ["broader_scope_requires_portable_corpus_or_customer_corroboration"]
      : [],
  };
}
