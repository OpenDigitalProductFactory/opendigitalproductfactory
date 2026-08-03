import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { analyzeFPAW, currentInventory } from "../check-fpaw-standard";

export const core = readFileSync(
  "docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md",
  "utf8",
);

export const catalog = readFileSync(
  "docs/architecture/four-portfolio-archetype-standard-profile-catalog.md",
  "utf8",
);

export function assertRejected(
  brokenCore: string,
  brokenCatalog: string,
  expectedError: RegExp,
): void {
  const result = analyzeFPAW(brokenCore, brokenCatalog, currentInventory());
  assert(
    result.errors.some((error) => expectedError.test(error)),
    `expected ${expectedError}, received:\n${result.errors.join("\n")}`,
  );
}

export function replaceRequired(source: string, search: string, replacement: string): string {
  assert(source.includes(search), `mutation fixture not found: ${search.slice(0, 120)}`);
  return source.replace(search, replacement);
}

export function replaceMatched(
  source: string,
  pattern: RegExp,
  transform: (matched: string) => string,
): string {
  const matched = source.match(pattern)?.[0];
  assert(matched, `mutation fixture not found: ${pattern}`);
  const replacement = transform(matched);
  assert.notEqual(replacement, matched, `mutation did not change fixture: ${pattern}`);
  return source.replace(pattern, replacement);
}
