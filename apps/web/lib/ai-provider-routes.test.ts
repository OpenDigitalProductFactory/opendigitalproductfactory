import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { AI_PROVIDER_CONNECTIONS_ROUTE, providerSetupLocation } from "./ai-provider-routes";

describe("providerSetupLocation (BI-7E27C0F0)", () => {
  it("names the External Services page by its real route", () => {
    expect(providerSetupLocation()).toBe("External Services (/platform/ai/providers)");
  });

  it("points at the provider's own page when the provider is known", () => {
    expect(providerSetupLocation("codex")).toBe("External Services (/platform/ai/providers/codex)");
    expect(providerSetupLocation("anthropic-sub")).toBe(
      "External Services (/platform/ai/providers/anthropic-sub)",
    );
  });

  it("encodes a provider id that is not URL-safe", () => {
    expect(providerSetupLocation("a b/c")).toBe("External Services (/platform/ai/providers/a%20b%2Fc)");
  });

  it("falls back to the list page for an empty or missing provider id", () => {
    expect(providerSetupLocation("")).toBe(`External Services (${AI_PROVIDER_CONNECTIONS_ROUTE})`);
    expect(providerSetupLocation(null)).toBe(`External Services (${AI_PROVIDER_CONNECTIONS_ROUTE})`);
  });
});

// Guard: operator guidance must never again name a menu path that does not
// exist. The phrases are assembled from parts so this file does not match itself.
const RETIRED_PHRASES = [
  ["AI Workforce", "External Services"].join(" > "),
  ["Admin", "AI Providers"].join(" > "),
];
const WEB_ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "coverage", "generated"]);
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json)$/;

function collectSourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe("retired provider-setup menu paths (BI-7E27C0F0)", () => {
  it("do not appear anywhere under apps/web", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(WEB_ROOT, [])) {
      const text = readFileSync(file, "utf8");
      for (const phrase of RETIRED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${relative(WEB_ROOT, file).split(sep).join("/")}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
