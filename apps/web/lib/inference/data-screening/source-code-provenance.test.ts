// BI-FC94F754: source code is classified by the repository it comes from, not
// raised to confidential because a payload contains code.
//
// The routing half of each case uses the production clearance matrix recorded
// on the item (2026-11-04): chatgpt and xai are cleared for public data only,
// codex-agent for public and internal, anthropic and local for confidential,
// and only local for restricted.
import { describe, expect, it } from "vitest";
import { endpointClearsSensitivity } from "@/lib/routing/sensitivity-clearance";
import type { EndpointManifest } from "@/lib/routing/types";
import { classifyInferencePayload } from "./classify-payload";
import { isPublicSourceProvenance } from "./source-code-provenance";
import { screenInferencePayload, type ScreenInferencePayloadInput } from "./screen-inference-payload";
import type { SourceCodeProvenance } from "./types";

const PLATFORM_REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const PUBLIC_REPO: SourceCodeProvenance = { repository: PLATFORM_REPO, visibility: "public", licence: "Apache-2.0" };
const PRIVATE_REPO: SourceCodeProvenance = { repository: "acme/billing-service", visibility: "private" };
const UNPROVEN_REPO: SourceCodeProvenance = { repository: "acme/unknown", visibility: "unknown" };

const PUBLIC_DIFF = [
  "diff --git a/apps/web/lib/paths.ts b/apps/web/lib/paths.ts",
  "@@ -1,3 +1,4 @@",
  "+export function normalizePaths(paths: string[]) {",
  "+  return paths.filter(Boolean);",
  "+}",
].join("\n");

const CLEARANCE: Record<string, EndpointManifest["sensitivityClearance"]> = {
  chatgpt: ["public"],
  xai: ["public"],
  "codex-agent": ["public", "internal"],
  anthropic: ["public", "internal", "confidential"],
  local: ["public", "internal", "confidential", "restricted"],
};
const PUBLIC_ONLY = ["chatgpt", "xai"];

function screen(diff: string, extra: Partial<ScreenInferencePayloadInput> = {}) {
  return screenInferencePayload({
    messages: [{ role: "user", content: `Review this change:\n${diff}` }],
    systemPrompt: "You review committed changes.",
    taskType: "build-review",
    routeContext: { sensitivity: "public" },
    ...extra,
  });
}

/** Providers the router would keep for this screen: clearance plus the local-only clamp. */
function eligibleProviders(result: ReturnType<typeof screen>): string[] {
  const { sensitivity, residencyPolicy } = result.routeContext;
  return Object.entries(CLEARANCE)
    .filter(([providerId, sensitivityClearance]) =>
      endpointClearsSensitivity({ sensitivityClearance } as EndpointManifest, sensitivity!) &&
      (residencyPolicy !== "local_only" || providerId === "local"))
    .map(([providerId]) => providerId)
    .sort();
}

describe("source code is classified by its repository (BI-FC94F754)", () => {
  it("routes a public-repository diff to the providers cleared only for public data", () => {
    const result = screen(PUBLIC_DIFF, { sourceCodeProvenance: PUBLIC_REPO });

    expect(result.receipt.classifiedDataClasses).toEqual(["source-code"]);
    expect(result.receipt).toMatchObject({ measuredSensitivity: "public", sourceCodeVisibility: "public" });
    expect(result.routeContext.sensitivity).toBe("public");
    expect(eligibleProviders(result)).toEqual(expect.arrayContaining(PUBLIC_ONLY));
  });

  it("routes a public-repository diff declared as development work to the public-only providers too", () => {
    const result = screen(PUBLIC_DIFF, {
      sourceCodeProvenance: PUBLIC_REPO,
      routeContext: { sensitivity: "development" },
    });
    expect(result.routeContext.sensitivity).toBe("development");
    expect(eligibleProviders(result)).toEqual(expect.arrayContaining(PUBLIC_ONLY));
  });

  it("does not route a private-repository diff to public-only providers", () => {
    const result = screen(PUBLIC_DIFF, { sourceCodeProvenance: PRIVATE_REPO });

    expect(result.receipt).toMatchObject({ measuredSensitivity: "confidential", sourceCodeVisibility: "private" });
    expect(result.routeContext.sensitivity).toBe("confidential");
    expect(eligibleProviders(result)).toEqual(["anthropic", "local"]);
  });

  it("keeps private-repository code confidential even when the route calls it development work", () => {
    // Before BI-FC94F754 the `development` label alone lowered any code-only
    // payload to public, whichever repository the code came from.
    for (const provenance of [PRIVATE_REPO, UNPROVEN_REPO, { repository: "  ", visibility: "public" as const }]) {
      const result = screen(PUBLIC_DIFF, {
        sourceCodeProvenance: provenance,
        routeContext: { sensitivity: "development" },
      });
      expect(result.routeContext.sensitivity).toBe("confidential");
      expect(eligibleProviders(result)).not.toContain("chatgpt");
      expect(eligibleProviders(result)).not.toContain("xai");
    }
  });

  it("keeps code with no proven repository confidential", () => {
    for (const extra of [{}, { sourceCodeProvenance: UNPROVEN_REPO }]) {
      const result = screen(PUBLIC_DIFF, extra);
      expect(result.routeContext.sensitivity).toBe("confidential");
      expect(eligibleProviders(result)).toEqual(["anthropic", "local"]);
    }
  });

  it("still catches a secret inside a public-repository diff and keeps the turn local", () => {
    const diff = `${PUBLIC_DIFF}\n+const apiKey = "sk-ant-api03-REDACTEDLOOKINGSECRETVALUE";`;
    const result = screen(diff, { sourceCodeProvenance: PUBLIC_REPO });

    expect(result.receipt.classifiedDataClasses).toContain("secrets-credentials");
    expect(result.routeContext).toMatchObject({ sensitivity: "restricted", residencyPolicy: "local_only" });
    expect(eligibleProviders(result)).toEqual(["local"]);
  });

  it("still keeps customer records inside a public-repository diff off the public-only providers", () => {
    const diff = `${PUBLIC_DIFF}\n+// Reported by jane.customer@example.org on 555-201-3344`;
    const result = screen(diff, { sourceCodeProvenance: PUBLIC_REPO });

    expect(result.receipt.classifiedDataClasses).toContain("customer-records");
    expect(result.receipt.measuredSensitivity).toBe("confidential");
    expect(eligibleProviders(result)).not.toContain("chatgpt");
    expect(eligibleProviders(result)).not.toContain("xai");
  });

  it("does not let a repository record lower a payload that carries no code", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "What should we work on next?" }],
      systemPrompt: "You help plan work.",
      sourceCodeProvenance: PUBLIC_REPO,
    });
    expect(result.overallSensitivity).toBe("internal");
  });

  it("does not let a repository record lower caller-declared governed data", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: PUBLIC_DIFF }],
      systemPrompt: "You review committed changes.",
      sourceCodeProvenance: PUBLIC_REPO,
      governedData: [{ classificationKnown: true, sensitivity: "internal", dataClasses: ["source-code"] }],
    });
    expect(result.overallSensitivity).toBe("internal");
  });

  it("treats only a named repository proven public as public", () => {
    expect(isPublicSourceProvenance(PUBLIC_REPO)).toBe(true);
    expect(isPublicSourceProvenance({ ...PUBLIC_REPO, licence: null })).toBe(true);
    expect(isPublicSourceProvenance({ repository: "  ", visibility: "public" })).toBe(false);
    expect(isPublicSourceProvenance(PRIVATE_REPO)).toBe(false);
    expect(isPublicSourceProvenance(UNPROVEN_REPO)).toBe(false);
    expect(isPublicSourceProvenance(undefined)).toBe(false);
  });

  it("leaves the screen of a payload without a repository record unchanged", () => {
    const input = {
      messages: [{ role: "user" as const, content: PUBLIC_DIFF }],
      systemPrompt: "You review committed changes.",
    };
    const before = classifyInferencePayload(input);
    expect(before.overallSensitivity).toBe("confidential");
    expect(classifyInferencePayload({ ...input, sourceCodeProvenance: PUBLIC_REPO }).receipt.inputHash)
      .not.toBe(before.receipt.inputHash);
  });
});
