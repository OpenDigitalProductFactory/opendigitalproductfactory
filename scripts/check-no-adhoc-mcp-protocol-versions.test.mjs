// scripts/check-no-adhoc-mcp-protocol-versions.test.mjs
//
// Unit coverage for the W12 (BI-EE64547B) protocol-version governance guard:
// the advertised MCP revision set is the N/N-1 window plus the explicitly
// listed grandfathered set, and the transport route holds no revision
// literal of its own.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FROZEN_GRANDFATHERED_SET,
  extractVersionArray,
  findProtocolLiterals,
  evaluateProtocolGovernance,
} from "./check-no-adhoc-mcp-protocol-versions.mjs";

const GOOD_VERSIONS = `
export const MCP_VERSION_WINDOW = Object.freeze([
  "2025-11-25",
  "2025-06-18",
] as const);
export const MCP_GRANDFATHERED_PROTOCOL_VERSIONS = Object.freeze([
  "2025-03-26",
  "2024-11-05",
] as const);
export const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
`;

const GOOD_ROUTE = `
import { SUPPORTED_PROTOCOL_VERSIONS, FALLBACK_PROTOCOL_VERSION } from "@/lib/mcp/protocol-versions";
// comment mentioning 2025-11-25 is fine — comments are stripped
const negotiated = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? FALLBACK_PROTOCOL_VERSION;
`;

test("the live shape passes", () => {
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS,
    routeSource: GOOD_ROUTE,
  });
  assert.deepEqual(errors, []);
});

test("extractVersionArray reads Object.freeze arrays", () => {
  assert.deepEqual(extractVersionArray(GOOD_VERSIONS, "MCP_VERSION_WINDOW"), [
    "2025-11-25",
    "2025-06-18",
  ]);
});

test("a three-revision window is refused — N/N-1 means exactly two", () => {
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS.replace(
      '"2025-11-25",',
      '"2026-03-01",\n  "2025-11-25",',
    ),
    routeSource: GOOD_ROUTE,
  });
  assert.ok(errors.some((e) => e.includes("exactly current + one previous")));
});

test("a window not newest-first is refused", () => {
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS.replace(
      '"2025-11-25",\n  "2025-06-18",',
      '"2025-06-18",\n  "2025-11-25",',
    ),
    routeSource: GOOD_ROUTE,
  });
  assert.ok(errors.some((e) => e.includes("newest-first")));
});

test("growing the grandfathered set is refused; shrinking it is allowed", () => {
  const grown = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS.replace('"2025-03-26",', '"2025-03-26",\n  "2023-01-01",'),
    routeSource: GOOD_ROUTE,
  });
  assert.ok(grown.some((e) => e.includes("may only shrink")));

  const shrunk = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS
      .replace('  "2024-11-05",\n', "")
      .replace(
        'export const FALLBACK_PROTOCOL_VERSION = "2024-11-05";',
        'export const FALLBACK_PROTOCOL_VERSION = "2025-03-26";',
      ),
    routeSource: GOOD_ROUTE,
  });
  assert.deepEqual(shrunk, []);
});

test("a fallback outside the advertised union is refused", () => {
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS.replace(
      'FALLBACK_PROTOCOL_VERSION = "2024-11-05"',
      'FALLBACK_PROTOCOL_VERSION = "2020-01-01"',
    ),
    routeSource: GOOD_ROUTE,
  });
  assert.ok(errors.some((e) => e.includes("not an advertised revision")));
});

test("an ad-hoc revision literal on the transport is refused; comments are not", () => {
  assert.deepEqual(findProtocolLiterals(GOOD_ROUTE), []);
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS,
    routeSource: GOOD_ROUTE + '\nconst SNEAKY = ["2026-01-01"];\n',
  });
  assert.ok(errors.some((e) => e.includes("literal(s) of its own")));
});

test("dropping the governed import from the route is refused", () => {
  const errors = evaluateProtocolGovernance({
    versionsSource: GOOD_VERSIONS,
    routeSource: 'const x = 1;\n',
  });
  assert.ok(errors.some((e) => e.includes("no longer imports")));
});

test("the frozen grandfathered set is the two pre-window revisions", () => {
  assert.deepEqual([...FROZEN_GRANDFATHERED_SET], ["2025-03-26", "2024-11-05"]);
});
