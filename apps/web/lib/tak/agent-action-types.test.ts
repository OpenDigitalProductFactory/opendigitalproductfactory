import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tools";
import type { PageAction, PageActionManifest } from "./agent-action-types";

describe("PageAction type", () => {
  it("is assignable to ToolDefinition (structural subtype)", () => {
    const action: PageAction = {
      name: "create_employee",
      description: "Create an employee",
      inputSchema: { type: "object", properties: {} },
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-EMP-001",
    };

    // PageAction must be usable as ToolDefinition
    const tool: ToolDefinition = action;
    expect(tool.name).toBe("create_employee");
    expect(tool.inputSchema).toBeDefined();
  });

  it("requires specRef field", () => {
    const manifest: PageActionManifest = {
      route: "/employee",
      actions: [
        {
          name: "test",
          description: "test",
          inputSchema: {},
          requiredCapability: null,
          sideEffect: false,
          specRef: "EP-TEST-001",
        },
      ],
    };
    expect(manifest.actions[0].specRef).toBe("EP-TEST-001");
  });
});
