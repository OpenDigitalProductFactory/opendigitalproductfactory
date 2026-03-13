// packages/db/src/index.ts
export { prisma } from "./client";
export type { Prisma, PrismaClient } from "../generated/client";

export { neo4jSession, closeNeo4j, runCypher } from "./neo4j";
export { initNeo4jSchema } from "./neo4j-schema";
export {
  getDownstreamImpact,
  getUpstreamDependencies,
  getProductsByPortfolio,
  getProductsByTaxonomySubtree,
  shortestPath,
  getInfraCIs,
  getNeighbours,
  type GraphNode,
  type GraphEdge,
  type ImpactResult,
} from "./neo4j-graph";
export {
  syncDigitalProduct,
  syncTaxonomyNode,
  syncPortfolio,
  syncInfraCI,
  syncDependsOn,
} from "./neo4j-sync";
export {
  buildDiscoveredKey,
  buildInventoryEntityKey,
  type DiscoveredKeyInput,
  type InventoryEntityKeyInput,
} from "./discovery-identity";
