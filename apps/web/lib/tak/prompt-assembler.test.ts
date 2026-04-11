// apps/web/lib/prompt-assembler.test.ts
// TDD RED → GREEN tests for the composable system prompt assembler.

import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "./prompt-assembler";
import type { PromptInput } from "./prompt-assembler";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fullInput: PromptInput = {
  hrRole: "HR-100",
  grantedCapabilities: ["view_portfolio", "view_inventory", "manage_backlog"],
  deniedCapabilities: ["manage_users", "manage_provider_connections"],
  mode: "act",
  sensitivity: "internal",
  domainContext: "The user is viewing the portfolio tree with 4 root nodes.",
  domainTools: ["search_products", "create_backlog_item"],
  routeData: '{"portfolioId":"p-123","nodeName":"Foundational"}',
  attachmentContext: "Attached file: quarterly-report.pdf (3 pages)",
};

const minimalInput: PromptInput = {
  hrRole: "HR-300",
  grantedCapabilities: ["view_portfolio"],
  deniedCapabilities: [],
  mode: "advise",
  sensitivity: "public",
  domainContext: "General workspace view.",
  domainTools: [],
  routeData: null,
  attachmentContext: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the index of a substring within a string, or -1 if not found. */
function indexOf(haystack: string, needle: string): number {
  return haystack.indexOf(needle);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("assembleSystemPrompt", () => {
  // Test 1: All 7 blocks appear in correct order
  it("places all blocks in correct order: identity → mode → authority → sensitivity → domain → route → attachments", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    const identityIdx = indexOf(prompt, "digital product management");
    const modeIdx = indexOf(prompt, "Mode: ACT");
    const authorityIdx = indexOf(prompt, "HR-100");
    const sensitivityIdx = indexOf(prompt, "classified INTERNAL");
    const domainIdx = indexOf(prompt, "portfolio tree");
    const routeIdx = indexOf(prompt, "--- PAGE DATA ---");
    const attachIdx = indexOf(prompt, "quarterly-report.pdf");

    // All blocks must be present
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(modeIdx).toBeGreaterThanOrEqual(0);
    expect(authorityIdx).toBeGreaterThanOrEqual(0);
    expect(sensitivityIdx).toBeGreaterThanOrEqual(0);
    expect(domainIdx).toBeGreaterThanOrEqual(0);
    expect(routeIdx).toBeGreaterThanOrEqual(0);
    expect(attachIdx).toBeGreaterThanOrEqual(0);

    // Strict ordering: static blocks (identity, mode) then dynamic (authority, sensitivity, domain, route, attach)
    expect(identityIdx).toBeLessThan(modeIdx);
    expect(modeIdx).toBeLessThan(authorityIdx);
    expect(authorityIdx).toBeLessThan(sensitivityIdx);
    expect(sensitivityIdx).toBeLessThan(domainIdx);
    expect(domainIdx).toBeLessThan(routeIdx);
    expect(routeIdx).toBeLessThan(attachIdx);
  });

  // Test 2: Advise mode text is injected correctly
  it("injects advise mode text when mode is 'advise'", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).toContain("Mode: ADVISE");
    expect(prompt).toContain("You may read, search, analyze, and recommend");
    expect(prompt).toContain("You must not create, update, or delete anything");
    expect(prompt).toContain("suggest switching to Act mode");
    expect(prompt).not.toContain("Mode: ACT");
  });

  // Test 3: Act mode text is injected correctly
  it("injects act mode text when mode is 'act'", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("Mode: ACT");
    expect(prompt).toContain("You may execute any tool the employee's role authorizes");
    expect(prompt).toContain("All actions are logged");
    expect(prompt).toContain("Prefer the most direct path");
    expect(prompt).toContain("the employee chose Act mode because they trust you to act");
    expect(prompt).not.toContain("Mode: ADVISE");
  });

  // Test 4: Granted and denied capabilities are listed
  it("lists granted and denied capabilities in the authority block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("view_portfolio");
    expect(prompt).toContain("view_inventory");
    expect(prompt).toContain("manage_backlog");
    expect(prompt).toContain("manage_users");
    expect(prompt).toContain("manage_provider_connections");
    // Authority framing
    expect(prompt).toContain("authorized to:");
    expect(prompt).toContain("NOT authorized to:");
    expect(prompt).toContain("Never exceed it");
  });

  // Test 5: Sensitivity level is capitalized and present
  it("includes sensitivity level capitalized in the sensitivity block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("classified INTERNAL");

    const restrictedInput: PromptInput = {
      ...fullInput,
      sensitivity: "restricted",
    };
    const restrictedPrompt = await assembleSystemPrompt(restrictedInput);
    expect(restrictedPrompt).toContain("classified RESTRICTED");

    const confidentialInput: PromptInput = {
      ...fullInput,
      sensitivity: "confidential",
    };
    const confidentialPrompt = await assembleSystemPrompt(confidentialInput);
    expect(confidentialPrompt).toContain("classified CONFIDENTIAL");
  });

  // Test 6: Domain tools are listed
  it("lists domain tools in the domain context block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("Available domain tools:");
    expect(prompt).toContain("search_products");
    expect(prompt).toContain("create_backlog_item");
  });

  // Test 7: PLATFORM_PREAMBLE behavioral rules are present
  it("includes PLATFORM_PREAMBLE behavioral rules in the identity block", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("NEVER claim you did something");
    expect(prompt).toContain("approval card IS");
    expect(prompt).toContain("propose_improvement");
    expect(prompt).toContain("CRITICAL RULES");
  });

  // Test 8: Route data block omitted when null
  it("omits route data block when routeData is null", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).not.toContain("--- PAGE DATA ---");
  });

  // Test 9: Route data block included when present
  it("includes route data block when routeData is present", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("--- PAGE DATA ---");
    expect(prompt).toContain("portfolioId");
    expect(prompt).toContain("p-123");
  });

  // Test 10: Attachment block included when present
  it("includes attachment block when attachmentContext is present", async () => {
    const prompt = await assembleSystemPrompt(fullInput);

    expect(prompt).toContain("quarterly-report.pdf");
    expect(prompt).toContain("3 pages");
  });

  // Additional: attachment block omitted when null
  it("omits attachment block when attachmentContext is null", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    // The minimal input has no attachment context, so no attachment content should appear
    expect(prompt).not.toContain("quarterly-report.pdf");
  });

  // Additional: domain tools omitted when empty
  it("omits domain tools line when domainTools is empty", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    expect(prompt).not.toContain("Available domain tools:");
  });

  // Additional: empty denied capabilities handled gracefully
  it("handles empty denied capabilities list", async () => {
    const prompt = await assembleSystemPrompt(minimalInput);

    // Should still have the authority block with the role
    expect(prompt).toContain("HR-300");
    expect(prompt).toContain("authorized to:");
  });

  // EP-SELF-DEV-002: Anti-fabrication rule (rule 15)
  it("includes anti-fabrication rule (rule 15)", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("NEVER describe code you haven't written through a tool");
  });

  // EP-SELF-DEV-002: Tool-first rule (rule 16)
  it("includes tool-first rule (rule 16)", async () => {
    const prompt = await assembleSystemPrompt(fullInput);
    expect(prompt).toContain("your FIRST action must be a tool call");
  });
});
