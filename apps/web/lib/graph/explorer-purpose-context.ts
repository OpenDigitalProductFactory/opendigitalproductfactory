export const MAX_GRAPH_PURPOSE_SEEDS = 10;

export type GraphPurposeDepth = 1 | 2 | 3;

export type GraphPurposeContext = {
  seedKeys: string[];
  depth: GraphPurposeDepth;
  inspectedKey: string | null;
};

type SearchParamsReader = {
  get(name: string): string | null;
  getAll(name: string): string[];
};

function parseDepth(value: string | null): GraphPurposeDepth {
  const parsed = Number.parseInt(value ?? "1", 10);
  return parsed === 2 || parsed === 3 ? parsed : 1;
}

export function parseGraphPurposeContext(
  searchParams: SearchParamsReader,
): GraphPurposeContext {
  const seedKeys = [...new Set(searchParams.getAll("seed").map((key) => key.trim()))]
    .filter(Boolean)
    .slice(0, MAX_GRAPH_PURPOSE_SEEDS);
  return {
    seedKeys,
    depth: parseDepth(searchParams.get("depth")),
    inspectedKey: searchParams.get("inspected")?.trim() || null,
  };
}

export function writeGraphPurposeContext(
  searchParams: URLSearchParams,
  context: GraphPurposeContext,
): void {
  searchParams.delete("seed");
  for (const key of context.seedKeys.slice(0, MAX_GRAPH_PURPOSE_SEEDS)) {
    searchParams.append("seed", key);
  }
  if (context.seedKeys.length > 0) {
    searchParams.set("depth", String(context.depth));
  } else {
    searchParams.delete("depth");
  }
  if (context.inspectedKey) {
    searchParams.set("inspected", context.inspectedKey);
  } else {
    searchParams.delete("inspected");
  }
}

export function appendGraphPurposeSeed(
  seedKeys: string[],
  key: string,
): string[] {
  return [...new Set([...seedKeys, key])].slice(0, MAX_GRAPH_PURPOSE_SEEDS);
}
