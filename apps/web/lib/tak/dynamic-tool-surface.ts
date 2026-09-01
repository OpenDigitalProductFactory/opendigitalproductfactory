import type { ToolDefinition } from "@/lib/mcp-tools";
import { LOAD_TOOLS_TOOL_NAME, selectLoadableTools } from "./tool-intent";

export type DynamicToolSurfaceResult = {
  active: ToolDefinition[];
  loaded: ToolDefinition[];
  displaced: ToolDefinition[];
  unattached: ToolDefinition[];
};

/** Recompile one attachment surface while preserving authority in the deferred pool. */
export function recompileDynamicToolSurface(input: {
  active: readonly ToolDefinition[];
  requested: readonly ToolDefinition[];
  ceiling: number;
  pinnedNames?: ReadonlySet<string>;
}): Omit<DynamicToolSurfaceResult, "loaded"> {
  const pinned = new Set(input.pinnedNames ?? [LOAD_TOOLS_TOOL_NAME]);
  const activeNames = new Set(input.active.map(({ name }) => name));
  const uniqueRequested = input.requested.filter(({ name }, index, all) =>
    !activeNames.has(name) && all.findIndex((tool) => tool.name === name) === index,
  );
  const maxRequested = Math.max(0, input.ceiling - pinned.size);
  const attachable = uniqueRequested.slice(0, maxRequested);
  const unattached = uniqueRequested.slice(maxRequested);
  const protectedNames = new Set([...pinned, ...attachable.map(({ name }) => name)]);
  const overflow = Math.max(0, input.active.length + attachable.length - input.ceiling);
  const removable = [...input.active].reverse().filter(({ name }) => !protectedNames.has(name));
  const removeNames = new Set(removable.slice(0, overflow).map(({ name }) => name));
  const displaced = input.active.filter(({ name }) => removeNames.has(name));
  const active = [...input.active.filter(({ name }) => !removeNames.has(name)), ...attachable];
  return { active, displaced, unattached };
}

/** Mutable per-run adapter around the pure compiler; grants never enter this state. */
export class DynamicToolSurface {
  private active: ToolDefinition[];
  private deferred: ToolDefinition[];
  private readonly pinned = new Set<string>([LOAD_TOOLS_TOOL_NAME]);
  private readonly resolvedCeiling: number;
  readonly initialCount: number;

  constructor(input: { active: readonly ToolDefinition[]; deferred?: readonly ToolDefinition[] }) {
    this.active = [...input.active];
    this.deferred = [...(input.deferred ?? [])];
    this.initialCount = this.active.length;
    this.resolvedCeiling = this.deferred.length > 0 ? this.initialCount : Number.POSITIVE_INFINITY;
  }

  get ceiling(): number { return this.resolvedCeiling; }
  get activeTools(): ToolDefinition[] { return [...this.active]; }
  get deferredCount(): number { return this.deferred.length; }
  isDeferred(name: string): boolean { return this.deferred.some((tool) => tool.name === name); }
  definition(name: string): ToolDefinition | undefined {
    return this.active.find((tool) => tool.name === name) ?? this.deferred.find((tool) => tool.name === name);
  }

  load(request: { names?: unknown; query?: unknown }): DynamicToolSurfaceResult {
    return this.apply(selectLoadableTools(this.deferred, request));
  }

  promote(name: string): DynamicToolSurfaceResult {
    return this.apply(selectLoadableTools(this.deferred, { names: [name] }, 1));
  }

  private apply(requested: ToolDefinition[]): DynamicToolSurfaceResult {
    const result = recompileDynamicToolSurface({
      active: this.active,
      requested,
      ceiling: this.ceiling,
      pinnedNames: this.pinned,
    });
    const attachedNames = new Set(result.active.map(({ name }) => name));
    const loaded = requested.filter(({ name }) => attachedNames.has(name));
    const loadedNames = new Set(loaded.map(({ name }) => name));
    this.deferred = [
      ...this.deferred.filter(({ name }) => !loadedNames.has(name)),
      ...result.displaced.filter(({ name }) => !this.deferred.some((tool) => tool.name === name)),
    ];
    for (const { name } of loaded) this.pinned.add(name);
    this.active = result.active;
    return { ...result, loaded };
  }
}
