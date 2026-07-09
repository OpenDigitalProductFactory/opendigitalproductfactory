import type { BusinessCapabilityNode } from "./data";
import type { CapabilityOverlayMode, CapabilityOverlayTone } from "./types";
import { CONSOLIDATION_BET_ITEM_IDS } from "@/lib/optimization/consolidation-bets";

export type CapabilityEvidenceSummary = {
  taxonomyCount: number;
  productCount: number;
  backlogCount: number;
  activeBacklogCount: number;
  architectureCount: number;
  hasOperationalEvidence: boolean;
};

export type CapabilityOverlayState = {
  tone: CapabilityOverlayTone;
  label: string;
  shortLabel: string;
  description: string;
  sortWeight: number;
};

export type BusinessCapabilityMapRow = {
  id: string;
  families: BusinessCapabilityNode[];
};

export function buildCapabilityEvidenceSummary(
  node: BusinessCapabilityNode,
): CapabilityEvidenceSummary {
  const taxonomyCount = node.traceGroups.taxonomy_node.length;
  const productCount = node.traceGroups.digital_product.length;
  const backlogCount = node.traceGroups.backlog_item.length;
  const activeBacklogCount = node.traceGroups.backlog_item.filter((link) =>
    link.status === "open" || link.status === "in-progress" || link.status === "triaging",
  ).length;
  const architectureCount = node.traceGroups.ea_element.length;
  const totalEvidence = taxonomyCount + productCount + backlogCount + architectureCount;

  return {
    taxonomyCount,
    productCount,
    backlogCount,
    activeBacklogCount,
    architectureCount,
    hasOperationalEvidence: totalEvidence > 0,
  };
}

export function deriveCapabilityOverlayState(
  node: BusinessCapabilityNode,
  mode: CapabilityOverlayMode,
): CapabilityOverlayState {
  if (mode === "maturity") {
    return {
      tone: node.maturityBand,
      label: `${node.currentMaturity} / ${node.targetMaturity}`,
      shortLabel: `${node.currentMaturity}/${node.targetMaturity}`,
      description: `${node.maturityGap} maturity level gap`,
      sortWeight: node.maturityGap,
    };
  }

  const evidence = buildCapabilityEvidenceSummary(node);

  if (mode === "coverage") {
    const totalEvidence =
      evidence.taxonomyCount + evidence.productCount + evidence.backlogCount + evidence.architectureCount;
    return {
      tone: evidence.hasOperationalEvidence ? "covered" : "gap",
      label: evidence.hasOperationalEvidence ? `${totalEvidence} evidence links` : "No operational evidence",
      shortLabel: evidence.hasOperationalEvidence ? `${totalEvidence} links` : "No links",
      description: evidence.hasOperationalEvidence
        ? "Capability has linked operational evidence."
        : "Capability has no linked operational evidence.",
      sortWeight: evidence.hasOperationalEvidence ? totalEvidence : -1,
    };
  }

  if (mode === "planning") {
    if (evidence.activeBacklogCount > 0) {
      return {
        tone: "active",
        label: `${evidence.activeBacklogCount} active backlog item${evidence.activeBacklogCount === 1 ? "" : "s"}`,
        shortLabel: `${evidence.activeBacklogCount} active`,
        description: "Capability has active or planned delivery work.",
        sortWeight: evidence.activeBacklogCount + node.maturityGap,
      };
    }

    if (node.maturityGap > 0) {
      return {
        tone: "gap",
        label: "Gap without active work",
        shortLabel: "No work",
        description: "Capability has a maturity gap and no active backlog trace.",
        sortWeight: -node.maturityGap,
      };
    }

    return {
      tone: "aligned",
      label: "Aligned without active work",
      shortLabel: "Aligned",
      description: "Capability is at target state and has no active backlog trace.",
      sortWeight: 0,
    };
  }

  if (mode === "optimization") {
    // Backlog trace labels are `${itemId} ${title}` (see data.ts), so a
    // capability is "in a consolidation bet's path" when a linked backlog
    // item belongs to the EP-8DC217EB bet registry.
    const betLinks = node.traceGroups.backlog_item.filter((link) =>
      CONSOLIDATION_BET_ITEM_IDS.has(link.label.split(" ")[0] ?? ""),
    );
    const activeBetLinks = betLinks.filter(
      (link) => link.status === "open" || link.status === "in-progress" || link.status === "triaging",
    );

    if (activeBetLinks.length > 0) {
      return {
        tone: "active",
        label: `${activeBetLinks.length} active consolidation bet link${activeBetLinks.length === 1 ? "" : "s"}`,
        shortLabel: `${activeBetLinks.length} bet${activeBetLinks.length === 1 ? "" : "s"}`,
        description: "Capability is in the blast path of an in-flight consolidation bet.",
        sortWeight: activeBetLinks.length + betLinks.length,
      };
    }

    if (betLinks.length > 0) {
      return {
        tone: "covered",
        label: `${betLinks.length} completed consolidation bet link${betLinks.length === 1 ? "" : "s"}`,
        shortLabel: `${betLinks.length} done`,
        description: "Linked consolidation work on this capability has completed.",
        sortWeight: betLinks.length,
      };
    }

    return {
      tone: "neutral",
      label: "No consolidation bet link",
      shortLabel: "None",
      description: "No EP-8DC217EB consolidation bet is traced to this capability.",
      sortWeight: 0,
    };
  }

  const streamCount = node.it4itValueStreams.length;
  return {
    tone: streamCount > 0 ? "covered" : "neutral",
    label: streamCount > 0 ? `${streamCount} IT4IT value stream${streamCount === 1 ? "" : "s"}` : "No IT4IT alignment",
    shortLabel: streamCount > 0 ? `${streamCount} streams` : "No stream",
    description: streamCount > 0
      ? "Capability is aligned to IT4IT value streams."
      : "Capability has no IT4IT value-stream alignment.",
    sortWeight: streamCount,
  };
}

export function buildCapabilityMapRows(tree: BusinessCapabilityNode[]): BusinessCapabilityMapRow[] {
  return tree.length === 0 ? [] : [{ id: "row-1", families: tree }];
}
