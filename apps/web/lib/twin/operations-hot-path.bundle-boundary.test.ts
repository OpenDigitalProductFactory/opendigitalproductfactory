import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const hotPathFiles = [
  resolve(here, "living-business-snapshot.ts"),
  resolve(here, "operations-snapshot.ts"),
  resolve(here, "operations-loader.ts"),
  resolve(here, "operations-load-runtime.ts"),
  resolve(here, "operations-format.ts"),
  resolve(here, "operations-command.ts"),
  resolve(here, "operations-telemetry.ts"),
  resolve(here, "..", "workspace-home", "twin-panel-data.ts"),
];

describe("Operations hot-path bundle boundary", () => {
  it("does not import the historical Performance provider or reporting loaders", () => {
    for (const file of hotPathFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /from\s+["']@\/lib\/(?:performance|reporting)(?:\/|["'])/,
      );
      expect(source, file).not.toContain("business-performance-provider");
    }
  });
});
