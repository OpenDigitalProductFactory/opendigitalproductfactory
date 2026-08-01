// Server actions for the admin graph explorer (BI-89A149A9).
//
// Thin, read-only wrappers over `@/lib/graph/explorer-queries`. Every entry point
// asserts `view_admin` — the explorer exposes the platform's whole self-model
// (source paths, data-model fields, infrastructure CIs) in one place, so it is an
// admin surface even though it mutates nothing.

"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  expandGraphNeighbourhood,
  getGraphCensus,
  getGraphNodeDetail,
  searchGraphNodes,
  type GraphCensus,
  type GraphNodeDetail,
  type GraphNodeSummary,
  type GraphSubgraph,
} from "@/lib/graph/explorer-queries";

export async function loadGraphCensus(): Promise<GraphCensus> {
  await requireCapability("view_admin");
  return getGraphCensus();
}

export async function findGraphNodes(input: {
  query: string;
  labels?: string[];
  limit?: number;
}): Promise<GraphNodeSummary[]> {
  await requireCapability("view_admin");
  return searchGraphNodes(input);
}

export async function loadGraphNeighbourhood(input: {
  seedKeys: string[];
  depth?: number;
  relTypes?: string[];
  labels?: string[];
  nodeCap?: number;
}): Promise<GraphSubgraph> {
  await requireCapability("view_admin");
  return expandGraphNeighbourhood(input);
}

export async function loadGraphNodeDetail(key: string): Promise<GraphNodeDetail | null> {
  await requireCapability("view_admin");
  return getGraphNodeDetail(key);
}
