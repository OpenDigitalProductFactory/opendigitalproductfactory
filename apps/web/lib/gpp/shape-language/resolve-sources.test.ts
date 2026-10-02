// Seed-backed default resolve sources, and proof that resolving opens no
// database connection (PR-3b-1, BI-6DA17863; plan risks R5 and R6). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 step 3; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1). Failing
// before: resolve-sources.ts did not exist.
//
// R6, measured rather than assumed. `@dpf/db` is loaded for real (through the
// tool registry's module graph, which constructs a Prisma client object at
// import), but its `prisma` export is wrapped so ANY property read on it is
// recorded, and every outbound socket API is spied on BEFORE any module under
// test is imported. The last test asserts that across building the sources,
// exercising every source and resolving every registered shape, nothing read
// the client and nothing connected.

import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ dbModuleLoaded: false, prismaReads: [] as string[] }));

vi.mock("@dpf/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  observed.dbModuleLoaded = true;
  const prisma = new Proxy(actual.prisma as object, {
    get(target, property, receiver) {
      if (typeof property === "string") observed.prismaReads.push(property);
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...actual, prisma };
});

// Installed at module evaluation, before beforeAll's dynamic imports load
// anything that could open a connection.
const connectSpies = [
  vi.spyOn(net.Socket.prototype, "connect"),
  vi.spyOn(net, "connect"),
  vi.spyOn(net, "createConnection"),
  vi.spyOn(tls, "connect"),
];

import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import type { GppResolveSources } from "./resolve";

type Modules = {
  defaultResolveSources: typeof import("./resolve-sources").defaultResolveSources;
  resolveShapeDocument: typeof import("./resolve").resolveShapeDocument;
  decompile: typeof import("./decompile").decompile;
  PLATFORM_TOOLS: typeof import("@/lib/mcp-tools").PLATFORM_TOOLS;
  classifyConsequentialTool: typeof import("@/lib/tak/consequential-tool-policy").classifyConsequentialTool;
  TOOL_TO_GRANTS: typeof import("@/lib/tak/agent-grants").TOOL_TO_GRANTS;
  isToolAllowedByGrants: typeof import("@/lib/tak/agent-grants").isToolAllowedByGrants;
  HARDCODED_COWORKER_GRANTS: typeof import("@dpf/db/workforce-seed").HARDCODED_COWORKER_GRANTS;
  GPP_BINDINGS: typeof import("../bindings").GPP_BINDINGS;
  definitions: WorkShapeDefinition[];
};

let modules: Modules;
let sources: GppResolveSources;

/** agent_registry.json read independently of the code under test. */
const REGISTRY = JSON.parse(readFileSync(join(__dirname, "../../../../../packages/db/data/agent_registry.json"), "utf8")) as {
  agents: Array<{ agent_id: string; agent_name: string; config_profile: { tool_grants: string[] } }>;
};

beforeAll(async () => {
  const [resolveSources, resolve, decompileModule, mcpTools, policy, agentGrants, seed, bindings, workShapes, priors] = await Promise.all([
    import("./resolve-sources"),
    import("./resolve"),
    import("./decompile"),
    import("@/lib/mcp-tools"),
    import("@/lib/tak/consequential-tool-policy"),
    import("@/lib/tak/agent-grants"),
    import("@dpf/db/workforce-seed"),
    import("../bindings"),
    import("@/lib/work-management/work-shapes"),
    import("@/lib/work-management/work-shape-prior-versions"),
  ]);
  modules = {
    defaultResolveSources: resolveSources.defaultResolveSources,
    resolveShapeDocument: resolve.resolveShapeDocument,
    decompile: decompileModule.decompile,
    PLATFORM_TOOLS: mcpTools.PLATFORM_TOOLS,
    classifyConsequentialTool: policy.classifyConsequentialTool,
    TOOL_TO_GRANTS: agentGrants.TOOL_TO_GRANTS,
    isToolAllowedByGrants: agentGrants.isToolAllowedByGrants,
    HARDCODED_COWORKER_GRANTS: seed.HARDCODED_COWORKER_GRANTS,
    GPP_BINDINGS: bindings.GPP_BINDINGS,
    definitions: [...workShapes.listWorkShapes(), ...priors.WORK_SHAPE_PRIOR_VERSIONS],
  };
  sources = modules.defaultResolveSources();
}, 120_000);

/** Every agent id named as a stage's accountable principal, across current and prior shapes. */
function stageAgents(): string[] {
  const agents = new Set<string>();
  for (const definition of modules.definitions) {
    for (const stage of definition.stages) {
      if (stage.accountablePrincipalRef.startsWith("agent:")) agents.add(stage.accountablePrincipalRef.slice("agent:".length));
    }
  }
  return [...agents].sort();
}

describe("defaultResolveSources composes the runtime's own registries (R5)", () => {
  it("grantsFor agrees with the seed for every agent named by a stage, falling back to agent_registry.json", () => {
    const agents = stageAgents();
    expect(agents.length).toBeGreaterThan(0);
    let seeded = 0;
    for (const agentId of agents) {
      const seed = modules.HARDCODED_COWORKER_GRANTS[agentId];
      const registryEntry = REGISTRY.agents.find((agent) => agent.agent_id === agentId || agent.agent_name === agentId);
      const expected = seed && seed.length > 0 ? [...seed] : [...(registryEntry?.config_profile.tool_grants ?? [])];
      if (seed && seed.length > 0) seeded += 1;
      expect(sources.grantsFor(agentId), agentId).toEqual(expected);
    }
    expect(seeded, "at least one stage agent resolves from the seed").toBeGreaterThan(0);
  });

  it("every agent named by a stage is a known agent; an invented one is not", () => {
    expect(stageAgents().filter((agentId) => !sources.knownAgents.has(agentId))).toEqual([]);
    expect(sources.knownAgents.has("no-such-agent")).toBe(false);
  });

  it("classify agrees with classifyConsequentialTool for every PLATFORM_TOOLS entry", () => {
    expect(modules.PLATFORM_TOOLS.length).toBeGreaterThan(0);
    for (const tool of modules.PLATFORM_TOOLS) {
      expect(sources.platformTools.has(tool.name), tool.name).toBe(true);
      expect(sources.classify(tool.name), tool.name).toEqual(modules.classifyConsequentialTool({ tool, toolName: tool.name }));
    }
    expect(sources.platformTools.size).toBe(new Set(modules.PLATFORM_TOOLS.map((tool) => tool.name)).size);
    expect(sources.classify("no_such_tool")).toBeNull();
  });

  it("grantRequirement is TOOL_TO_GRANTS, and never an inherited Object property", () => {
    for (const tool of modules.PLATFORM_TOOLS) {
      expect(sources.grantRequirement(tool.name), tool.name).toEqual(modules.TOOL_TO_GRANTS[tool.name] ?? null);
    }
    expect(sources.grantRequirement("constructor")).toBeNull();
    expect(sources.grantRequirement("__proto__")).toBeNull();
  });

  it("shapeVersionExists holds for every registered current and prior version, and only those", () => {
    for (const definition of modules.definitions) {
      expect(sources.shapeVersionExists(`${definition.key}@${definition.version}`), definition.key).toBe(true);
    }
    expect(sources.shapeVersionExists("inquiry-response-watch@9.9.9")).toBe(false);
    expect(sources.shapeVersionExists("no-such-shape@1.0.0")).toBe(false);
    expect(sources.shapeVersionExists("not a reference")).toBe(false);
  });

  it("importResolver finds every GPP binding's resolver and refuses anything else", async () => {
    expect(modules.GPP_BINDINGS.length).toBeGreaterThan(0);
    for (const binding of modules.GPP_BINDINGS) {
      expect(await sources.importResolver(binding.resolver.module, binding.resolver.exportName), binding.bindingId).toBe(true);
    }
    const [first] = modules.GPP_BINDINGS;
    expect(await sources.importResolver(first.resolver.module, "noSuchExport")).toBe(false);
    expect(await sources.importResolver("lib/tak/no-such-module", "anything")).toBe(false);
    expect(await sources.importResolver("lib/../../package", "default")).toBe(false);
    expect(await sources.importResolver("/etc/passwd", "x")).toBe(false);
    expect(await sources.importResolver(first.resolver.module, "constructor()")).toBe(false);
  }, 60_000);
});

describe("resolving every registered shape with the default sources", () => {
  it("each fact matches a direct lookup in the registry it came from", async () => {
    for (const definition of modules.definitions) {
      const { document } = modules.decompile(definition);
      const resolution = await modules.resolveShapeDocument(document, sources);
      expect(resolution.shapeElementId).toBe(`shape:${definition.key}@${definition.version}`);
      expect(resolution.stages.map((stage) => stage.stageKey)).toEqual(definition.stages.map((stage) => stage.key));
      for (const stage of resolution.stages) {
        for (const tool of stage.tools ?? []) {
          const registered = modules.PLATFORM_TOOLS.find((candidate) => candidate.name === tool.toolName);
          expect(tool.registered, tool.elementId).toBe(Boolean(registered));
          if (registered) {
            expect(tool.consequential, tool.elementId).toBe(modules.classifyConsequentialTool({ tool: registered, toolName: tool.toolName }).consequential);
          }
          expect(tool.grantRequirement, tool.elementId).toEqual(modules.TOOL_TO_GRANTS[tool.toolName] ?? null);
        }
      }
    }
  }, 60_000);

  it("inquiry-response-watch/draft: customer-advisor's resolved grants reach list_storefront_activity (as the parity test asserts)", async () => {
    const definition = modules.definitions.find((candidate) => candidate.key === "inquiry-response-watch")!;
    const [draft] = (await modules.resolveShapeDocument(modules.decompile(definition).document, sources)).stages;
    expect(draft.principal).toMatchObject({ kind: "agent", agentId: "customer-advisor", known: true });
    const grants = draft.principal.kind === "agent" ? [...draft.principal.grants] : [];
    expect(grants).toContain("storefront_read");
    expect(modules.isToolAllowedByGrants("list_storefront_activity", grants)).toBe(true);
    expect(draft.tools?.find((tool) => tool.toolName === "list_storefront_activity")).toMatchObject({ registered: true, consequential: false });
  });
});

describe("R6: no database connection", () => {
  // Runs last in this file (vitest runs a file's tests in declaration order).
  it("the real @dpf/db module was loaded, yet nothing read the Prisma client and no socket connected", () => {
    // The tool registry's module graph loads @dpf/db, whose body constructs a
    // client object (lazy: Prisma connects on the first query). Recorded so
    // the measurement is honest: construction happens, a connection does not.
    expect(observed.dbModuleLoaded).toBe(true);
    expect(observed.prismaReads).toEqual([]);
    for (const spy of connectSpies) expect(spy).not.toHaveBeenCalled();
  });
});
