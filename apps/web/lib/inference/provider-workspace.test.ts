import { describe, expect, it } from "vitest";
import { normalizeProviderWorkspaceId, providerWorkspaceHeaders } from "./provider-workspace";

describe("Anthropic workspace binding", () => {
  it("preserves omission and explicitly clears empty configuration", () => {
    expect(normalizeProviderWorkspaceId("anthropic", undefined)).toBeUndefined();
    expect(normalizeProviderWorkspaceId("anthropic", " ")).toBeNull();
  });
  it("normalizes the workspace without accepting arbitrary header values", () => {
    expect(normalizeProviderWorkspaceId("anthropic", " wrkspc_example123 ")).toBe("wrkspc_example123");
    for (const value of ["default", "wrkspc_", "wrkspc_a\r\nother: value", "https://example.com"]) {
      expect(() => normalizeProviderWorkspaceId("anthropic", value)).toThrow(/workspace/i);
    }
    expect(() => normalizeProviderWorkspaceId("openai", "wrkspc_example123")).toThrow(/Anthropic/);
  });
  it("adds only the selected Anthropic account's workspace", () => {
    expect(providerWorkspaceHeaders("anthropic", "wrkspc_accountA")).toEqual({ "anthropic-workspace-id": "wrkspc_accountA" });
    expect(providerWorkspaceHeaders("anthropic", "wrkspc_accountB")).toEqual({ "anthropic-workspace-id": "wrkspc_accountB" });
    expect(providerWorkspaceHeaders("anthropic", null)).toEqual({});
    expect(providerWorkspaceHeaders("openai", "wrkspc_accountA")).toEqual({});
    expect(providerWorkspaceHeaders("anthropic-sub", "wrkspc_accountA")).toEqual({});
  });
});
