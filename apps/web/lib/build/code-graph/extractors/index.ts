import type { CodeGraphExtractor } from "../types";
import { mcpToolExtractor } from "./mcp-tools";
import { nextRouteExtractor } from "./next-routes";
import { prismaExtractor } from "./prisma";
import { testExtractor } from "./tests";
import { typeScriptExtractor } from "./typescript";

export const CODE_GRAPH_EXTRACTORS: CodeGraphExtractor[] = [
  typeScriptExtractor,
  nextRouteExtractor,
  prismaExtractor,
  mcpToolExtractor,
  testExtractor,
];
