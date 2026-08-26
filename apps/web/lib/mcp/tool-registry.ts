// Tool pack registry — BI-ARCH-TOOLPACKS.
//
// Composes scoped tool packs into the flat surfaces mcp-tools.ts consumes: the
// combined definition list (spread into PLATFORM_TOOLS) and a name -> handler
// lookup (the dispatch path the executeTool switch migrates onto pack by pack).
// Composition fails fast on a duplicate tool name across packs so two packs can
// never silently claim the same tool.

import type { ToolDefinition } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "./tool-pack";

export type ToolRegistry = {
  packs: ToolPack[];
  definitions: ToolDefinition[];
  toolNames: string[];
  getHandler: (toolName: string) => ToolPackHandler | undefined;
  getGrants: (toolName: string) => readonly string[] | undefined;
};

export function composeToolPacks(packs: ToolPack[]): ToolRegistry {
  const definitions: ToolDefinition[] = [];
  const handlers: Record<string, ToolPackHandler> = {};
  const grants: Record<string, readonly string[]> = {};
  const seen = new Set<string>();

  for (const pack of packs) {
    for (const def of pack.definitions) {
      if (seen.has(def.name)) {
        throw new Error(`Duplicate tool "${def.name}" registered across tool packs`);
      }
      seen.add(def.name);
      definitions.push(def);
    }
    // Definitions already throw on collision above. Handlers and grants used to
    // overwrite silently, which let a pack shadow a tool it did not define: the
    // later pack's handler answered calls shaped for the earlier pack's schema
    // and rejected them. That is invisible to a caller, who sees a valid request
    // refused by a handler they never addressed (BI-17CBD21F). Bind the same
    // rule to all three registries so a name has exactly one implementation.
    for (const [name, handler] of Object.entries(pack.handlers)) {
      if (handlers[name]) {
        throw new Error(
          `Duplicate handler for tool "${name}" registered across tool packs; a tool name must have exactly one implementation`,
        );
      }
      handlers[name] = handler;
    }
    for (const [name, grant] of Object.entries(pack.grants)) {
      if (grants[name]) {
        throw new Error(
          `Duplicate grant entry for tool "${name}" registered across tool packs; a tool name must have exactly one grant set`,
        );
      }
      grants[name] = grant;
    }
  }

  return {
    packs,
    definitions,
    toolNames: definitions.map((def) => def.name),
    getHandler: (toolName) => handlers[toolName],
    getGrants: (toolName) => grants[toolName],
  };
}
