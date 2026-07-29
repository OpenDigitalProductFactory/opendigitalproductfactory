import type {
  ProductOperatingContext,
  ProductOperatingScope,
} from "./product-operating-context";
import {
  buildPlaybookInputFingerprint,
  getProductManagementPlaybook,
  parseProductManagementPlaybookConfig,
  productManagementPlaybookScopeKind,
  type ProductManagementCanonicalSourceKind,
  type ProductManagementPlaybookConfig,
  type ProductManagementSourceReference,
} from "./product-management-playbook";

export type ProductManagementPlaybookTask = {
  taskId: string;
  organizationId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  taskConfig: unknown;
};

type ProductManagementPlaybookRunDeps = {
  loadContext?: (input: {
    organizationId: string;
    scope: ProductOperatingScope;
  }) => Promise<ProductOperatingContext>;
  loadTemplate?: () => Promise<string>;
};

const PRODUCT_MANAGEMENT_PROMPT_FALLBACK =
  "Run the typed product-management recipe over canonical Product Operating Context. Cite sources, preserve approval boundaries, and never fabricate missing evidence.";

function resolveScope(
  task: ProductManagementPlaybookTask,
): {
  organizationId: string;
  scope: ProductOperatingScope;
} {
  if (!task.organizationId) {
    throw new Error(
      "Product-management playbook task has no organization scope.",
    );
  }
  if (task.productLineId && task.businessProductId) {
    throw new Error(
      "Product-management playbook task has conflicting ProductLine and Product scope.",
    );
  }
  return {
    organizationId: task.organizationId,
    scope: task.businessProductId
      ? { kind: "product", id: task.businessProductId }
      : task.productLineId
        ? { kind: "product-line", id: task.productLineId }
        : { kind: "organization", id: task.organizationId },
  };
}

function canonicalSourceKind(
  sourceKind: string,
): ProductManagementCanonicalSourceKind | null {
  const aliases: Record<string, ProductManagementCanonicalSourceKind> = {
    "backlog-item": "backlog-item",
    "backlog-item-activity": "backlog-item-activity",
    "business-product": "business-product",
    "catalog-item": "catalog-item",
    "change-item": "change-item",
    "change-request": "change-item",
    "decision-interaction": "decision-interaction",
    "knowledge-article": "knowledge-article",
    "marketing-battlecard": "marketing-battlecard",
    "product-objective": "product-objective",
    "product-objective-observation": "product-objective-observation",
    "product-offering": "product-offering",
    "product-sold": "product-sold",
    "research-proposal": "research-proposal",
    "scheduled-agent-task": "scheduled-agent-task",
    "task-run": "task-run",
  };
  return aliases[sourceKind] ?? null;
}

function sourceReference(input: {
  id: string;
  sourceKind: string;
  asOf: Date;
}): ProductManagementSourceReference | null {
  const sourceKind = canonicalSourceKind(input.sourceKind);
  return sourceKind
    ? {
        sourceKind,
        sourceId: input.id,
        asOf: input.asOf,
      }
    : null;
}

export function collectProductManagementPlaybookSources(
  context: ProductOperatingContext,
): ProductManagementSourceReference[] {
  const candidates: Array<{
    id: string;
    sourceKind: string;
    asOf: Date;
  }> = [
    ...context.products,
    ...context.offerings.items,
    ...context.catalogItems.items,
    ...context.productSold.items,
    ...context.intelligence.items,
    ...context.demand.items,
    ...context.decisions.items,
    ...context.objectives.items,
    ...context.deliveryChanges.items,
    ...context.scheduledPlaybooks.items,
  ];
  const unique = new Map<string, ProductManagementSourceReference>();
  for (const candidate of candidates) {
    const source = sourceReference(candidate);
    if (!source) continue;
    unique.set(`${source.sourceKind}:${source.sourceId}`, source);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.sourceKind.localeCompare(right.sourceKind) ||
      left.sourceId.localeCompare(right.sourceId),
  );
}

function renderPlaybookPrompt(input: {
  config: ProductManagementPlaybookConfig;
  sources: readonly ProductManagementSourceReference[];
  scope: ProductOperatingScope;
  context: ProductOperatingContext;
  template: string;
}): string {
  const recipe = getProductManagementPlaybook(input.config.recipeId);
  const sourceLines =
    input.sources.length > 0
      ? input.sources
          .map(
            (source) =>
              `- ${source.sourceKind}:${source.sourceId} as of ${source.asOf.toISOString()}`,
          )
          .join("\n")
      : "- No compatible canonical source records are available.";
  const writeLines =
    recipe.proposedWrites.length > 0
      ? recipe.proposedWrites
          .map(
            (write) =>
              `- ${write.authority}: propose only; approval ${write.approval}`,
          )
          .join("\n")
      : "- No canonical writes are proposed.";
  return [
    input.template,
    "",
    `# ${recipe.label}`,
    "",
    recipe.purpose,
    "",
    `Scope: ${input.scope.kind}:${input.scope.id}`,
    `Provider: organization:${input.context.provider.id} (${input.context.provider.name})`,
    `Permissions digest: ${input.config.permissionsDigest}`,
    "",
    "Canonical boundary",
    "",
    "BacklogItem remains authoritative for demand and funding. ProductObjective remains authoritative for outcomes. ProductLine and Product remain authoritative for the business hierarchy. DigitalProduct supplies only explicitly linked architecture and delivery evidence. This output is derived and is not importable planning authority.",
    "",
    "Evidence",
    "",
    sourceLines,
    "",
    "Allowed tools",
    "",
    ...recipe.allowedTools.map((tool) => `- ${tool}`),
    "",
    "Proposed canonical writes",
    "",
    writeLines,
    "",
    "Approval boundary",
    "",
    recipe.approvalBoundary,
    "",
    "Failure behavior",
    "",
    recipe.failureBehavior,
    "",
    "Instructions",
    "",
    "Cite source IDs beside every conclusion. State freshness and contradictions. Mark missing evidence unavailable. Prepare proposed writes for the governed approval path; do not claim they were applied. Return a concise derived brief with decisions needed, evidence changes, recommendation, risks, and next evidence action.",
  ].join("\n");
}

async function defaultLoadContext(input: {
  organizationId: string;
  scope: ProductOperatingScope;
}): Promise<ProductOperatingContext> {
  const { loadProductOperatingContext } = await import(
    "./product-operating-context-query"
  );
  return loadProductOperatingContext({
    organizationId: input.organizationId,
    scope: input.scope,
    authorize: async ({ organizationId }) => {
      if (organizationId !== input.organizationId) {
        throw new Error(
          "Product-management playbook organization scope changed during execution.",
        );
      }
    },
  });
}

async function defaultLoadTemplate(): Promise<string> {
  const { loadPrompt } = await import("@/lib/tak/prompt-loader");
  return loadPrompt(
    "product-management",
    "product-operating-loop",
    PRODUCT_MANAGEMENT_PROMPT_FALLBACK,
  );
}

export async function prepareProductManagementPlaybookRun(
  task: ProductManagementPlaybookTask,
  deps: ProductManagementPlaybookRunDeps = {},
): Promise<{
  config: ProductManagementPlaybookConfig;
  context: ProductOperatingContext;
  scope: ProductOperatingScope;
  sources: ProductManagementSourceReference[];
  fingerprint: string;
  unchanged: boolean;
  prompt: string;
}> {
  const config = parseProductManagementPlaybookConfig(task.taskConfig);
  const resolved = resolveScope(task);
  const recipe = getProductManagementPlaybook(config.recipeId);
  const scopeKind = productManagementPlaybookScopeKind(resolved.scope.kind);
  if (!recipe.supportedScopes.includes(scopeKind)) {
    throw new Error(`${recipe.label} does not support ${scopeKind} scope.`);
  }
  const context = await (deps.loadContext ?? defaultLoadContext)(resolved);
  const template = await (
    deps.loadTemplate ??
    (deps.loadContext
      ? async () => PRODUCT_MANAGEMENT_PROMPT_FALLBACK
      : defaultLoadTemplate)
  )();
  const sources = collectProductManagementPlaybookSources(context).filter(
    (source) => recipe.canonicalInputs.includes(source.sourceKind),
  );
  const fingerprint = buildPlaybookInputFingerprint(sources);
  return {
    config,
    context,
    scope: resolved.scope,
    sources,
    fingerprint,
    unchanged: fingerprint === config.lastSuccessfulFingerprint,
    prompt: renderPlaybookPrompt({
      config,
      sources,
      scope: resolved.scope,
      context,
      template,
    }),
  };
}

export function completeProductManagementPlaybookRun(
  rawConfig: unknown,
  result: {
    fingerprint: string;
    completedAt: Date;
    status: "completed" | "partial" | "failed";
  },
): ProductManagementPlaybookConfig {
  const config = parseProductManagementPlaybookConfig(rawConfig);
  return {
    ...config,
    lastSuccessfulFingerprint:
      result.status === "completed"
        ? result.fingerprint
        : config.lastSuccessfulFingerprint,
  };
}
