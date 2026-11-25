import { describe, expect, it, vi } from "vitest";
import type { RegisteredToolDefinition, ToolDefinition } from "@/lib/mcp-tool-types";
import { WORKROOM_TOOL_ALIASES } from "@/lib/tak/workroom-tool-aliases";
import { LOAD_TOOLS_WORKROOM_ACCESS } from "./load-tools";
import { TOOL_PACK_REGISTRY } from "./pack-registry";
import type { ToolPack } from "./tool-pack";
import { composeToolPacks } from "./tool-registry";
import { isWorkroomToolAccess } from "./workroom-tool-access";

const base = { name: "read_example", description: "Read a fixture", inputSchema: {}, requiredCapability: null } satisfies ToolDefinition;
const declared = { ...base, workroomAccess: "room-operation" } satisfies RegisteredToolDefinition;

// This fixture is typechecked, not executed. Replacing the required field with
// an optional field makes the directive itself a typecheck error.
function missingStaticDeclaration() {
  // @ts-expect-error Static definitions do not inherit a default access class.
  const invalid: RegisteredToolDefinition = base;
  return invalid;
}
void missingStaticDeclaration;

describe("DPF-owned Workroom tool access", () => {
  it("requires a valid declaration on every static pack tool", () => {
    expect(TOOL_PACK_REGISTRY.definitions.length).toBeGreaterThan(0);
    for (const def of TOOL_PACK_REGISTRY.definitions) {
      expect(isWorkroomToolAccess(def.workroomAccess), def.name).toBe(true);
      expect(TOOL_PACK_REGISTRY.getWorkroomAccess(def.name), def.name).toBe(def.workroomAccess);
    }
  });

  it.each([undefined, "read-only", { mode: "room-operation" }])("rejects a malformed declared tool at runtime (%j)", (workroomAccess) => {
    const pack: ToolPack = {
      packId: "fixture-invalid-access",
      definitions: [{ ...base, workroomAccess } as RegisteredToolDefinition],
      handlers: { [base.name]: vi.fn() }, grants: {},
    };
    expect(() => composeToolPacks([pack])).toThrow(/workroom access.*read_example/i);
  });

  it("looks up explicit access without treating annotations or inherited object keys as authority", () => {
    const allowed = composeToolPacks([{
      packId: "fixture-declared-access", definitions: [declared], handlers: {}, grants: {},
    }]);
    expect(allowed.getWorkroomAccess(base.name)).toBe("room-operation");
    for (const unknown of ["constructor", "__proto__", "external__read_example", "not_registered"]) {
      expect(allowed.getWorkroomAccess(unknown)).toBeUndefined();
    }
  });

  it("uses the canonical declaration for retained aliases, and does not admit the load meta-tool", () => {
    for (const [alias, canonical] of Object.entries(WORKROOM_TOOL_ALIASES)) {
      expect(TOOL_PACK_REGISTRY.getWorkroomAccess(alias)).toBe(TOOL_PACK_REGISTRY.getWorkroomAccess(canonical));
    }
    expect(LOAD_TOOLS_WORKROOM_ACCESS).toBe("outside-workroom");
    expect(TOOL_PACK_REGISTRY.getWorkroomAccess("load_tools")).toBeUndefined();
  });
});
