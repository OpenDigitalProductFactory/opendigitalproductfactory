/**
 * Structural security gate. Asserts that no fixture under
 * `packages/dpf-bootstrap/src/agent-toolchain/__tests__/fixtures/` contains a
 * bearer-shaped substring. A leak in this directory is a regression worth
 * blocking the PR — fixtures are committed and inherited by every contributor.
 *
 * Pairs with `redactTranscriptForPersistence` (runtime gate).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(__dirname, "fixtures");

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "DPF MCP bearer token", pattern: /dpfmcp_[A-Za-z0-9_]+/ },
  // Allow placeholder `${DPF_MCP_BEARER_TOKEN}` and `bearer_token_env_var`,
  // but flag a literal `Bearer <token>` followed by alphanumeric.
  { name: "Literal Bearer token", pattern: /Bearer\s+[A-Za-z0-9_\-.]{8,}/ },
  // NODE_REPL trusted client SHA from the operator's real config.
  { name: "Trusted client SHA hex", pattern: /NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S\s*=\s*"[A-Fa-f0-9]{40,}/ },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

describe("fixture redaction (security gate)", () => {
  const files = Array.from(walk(FIXTURES_DIR));

  it("finds at least one fixture (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(FIXTURES_DIR + "/", "").replace(/\\/g, "/")} contains no bearer-shaped content`, () => {
      const content = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          throw new Error(
            `Bearer-shaped content (${name}) found in fixture ${file}: "${match[0].slice(0, 20)}..." — redact before commit.`,
          );
        }
      }
    });
  }
});
