import type { ProductDirectionView } from "./product-direction-view";
import type { ProductOperatingContext } from "./product-operating-context";
import {
  buildProductManagementBriefSnapshot,
  productManagementPlaybookScopeKind,
  type ProductManagementBriefSnapshot,
} from "./product-management-playbook";
import { collectProductManagementPlaybookSources } from "./product-management-playbook-run";

function confidenceFor(
  context: ProductOperatingContext,
): ProductManagementBriefSnapshot["confidence"] {
  const slices = [
    context.intelligence,
    context.demand,
    context.decisions,
    context.objectives,
    context.deliveryChanges,
    context.scheduledPlaybooks,
  ];
  if (slices.every((slice) => slice.availability === "unavailable")) {
    return "unavailable";
  }
  return slices.every((slice) => slice.availability === "available")
    ? "high"
    : "partial";
}

export function buildStakeholderBriefFromOperatingContext(input: {
  context: ProductOperatingContext;
  view: ProductDirectionView;
  generatedAt?: Date;
}): ProductManagementBriefSnapshot {
  const sections = input.view.sections.map((section) => ({
    id: section.kind,
    title: section.title,
    body:
      section.items.length > 0
        ? section.items
            .map(
              (item) =>
                `${item.label} — ${item.status}${item.detail ? ` — ${item.detail}` : ""} [${item.sourceKind}:${item.id}]`,
            )
            .join("\n")
        : `${section.availability}: ${section.reason ?? section.description}`,
  }));
  return buildProductManagementBriefSnapshot({
    recipeId: "stakeholder-brief",
    scope: {
      kind: productManagementPlaybookScopeKind(input.context.scope.kind),
      organizationId: input.context.provider.id,
      productLineId:
        input.context.scope.kind === "product-line"
          ? input.context.scope.id
          : input.context.productLine?.id ?? null,
      businessProductId:
        input.context.scope.kind === "product"
          ? input.context.scope.id
          : null,
    },
    generatedAt: input.generatedAt ?? input.context.requestedAt,
    confidence: confidenceFor(input.context),
    sources: collectProductManagementPlaybookSources(input.context),
    sections,
  });
}
