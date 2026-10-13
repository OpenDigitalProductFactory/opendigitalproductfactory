#!/usr/bin/env node

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  externalDependencyNames,
  matrixDrift,
  renderDependencyDispositionMatrix,
  validateDependencyDispositions,
} from "./dependency-dispositions.mjs";

function info({ workspaces = ["apps/web"], kinds = ["prod"], versions = ["1.2.3"] } = {}) {
  return {
    workspaces: new Set(workspaces),
    kinds: new Set(kinds),
    versions: new Set(versions),
  };
}

const completeAllowlist = {
  dependencies: {
    keepme: {
      added: "2026-10-13",
      workspaces: ["apps/web"],
      kinds: ["prod"],
      note: "vetted",
      disposition: "keep",
      rationale: "Upstream maintenance is lower risk than owning this package.",
      evidence: ["docs/superpowers/specs/dependency-design.md#tier-0"],
    },
    absorbme: {
      added: "2026-10-13",
      workspaces: ["apps/web"],
      kinds: ["prod"],
      note: "vetted",
      disposition: "absorb",
      rationale: "The approved first-party replacement is already being delivered.",
      evidence: ["BI-12345678", "DI-123456789ABC"],
    },
  },
  retired: {},
};

test("only registry-backed direct dependencies require a disposition", () => {
  const current = new Map([
    ["keepme", info()],
    ["@dpf/workspace", info({ versions: [] })],
    ["@dpf/file-link", info({ versions: ["file:../../packages/file-link"] })],
    ["local-link", info({ versions: ["link:../local-link"] })],
    ["workspace-protocol", info({ versions: ["workspace:*"] })],
  ]);

  assert.deepEqual(externalDependencyNames(current), ["keepme"]);
  assert.deepEqual(validateDependencyDispositions(current, completeAllowlist), []);
});

test("coverage rejects missing, invalid, and incomplete decisions", () => {
  const current = new Map([
    ["missing", info()],
    ["invalid", info()],
    ["no-rationale", info()],
    ["no-evidence", info()],
    ["no-route", info()],
  ]);
  const allowlist = {
    dependencies: {
      missing: { note: "acknowledged" },
      invalid: { disposition: "vendor", rationale: "A deliberately invalid disposition.", evidence: ["BI-X"] },
      "no-rationale": { disposition: "keep", rationale: "", evidence: ["docs/design.md"] },
      "no-evidence": { disposition: "reduce", rationale: "A concrete consolidation is planned.", evidence: [] },
      "no-route": { disposition: "absorb", rationale: "A replacement is intended.", evidence: ["someone should do this"] },
    },
  };

  assert.deepEqual(
    validateDependencyDispositions(current, allowlist).map(({ name, code }) => `${name}:${code}`),
    [
      "invalid:invalid-disposition",
      "missing:missing-disposition",
      "no-evidence:missing-evidence",
      "no-rationale:missing-rationale",
      "no-route:missing-route-evidence",
    ],
  );
});

test("the generated package matrix is deterministic and contains the required observations", () => {
  const current = new Map([
    ["keepme", info({ workspaces: ["apps/web", "."], kinds: ["prod", "dev"], versions: ["2.0.0", "1.0.0"] })],
    ["absorbme", info()],
  ]);

  const first = renderDependencyDispositionMatrix(current, completeAllowlist);
  const second = renderDependencyDispositionMatrix(new Map([...current].reverse()), completeAllowlist);

  assert.equal(first, second);
  assert.match(first, /\| `absorbme` \| apps\/web \| prod \| 1\.2\.3 \| \*\*absorb\*\*/);
  assert.match(first, /\| `keepme` \| \., apps\/web \| dev, prod \| 1\.0\.0, 2\.0\.0 \| \*\*keep\*\*/);
  assert.match(first, /Keep \| 1/);
  assert.match(first, /Absorb \| 1/);
  assert.ok(first.endsWith("\n"));
});

test("rendering refuses to publish an incomplete ledger", () => {
  const current = new Map([["unclassified", info()]]);
  assert.throws(
    () => renderDependencyDispositionMatrix(current, { dependencies: { unclassified: {} } }),
    /unclassified: missing-disposition/,
  );
});

test("matrix drift is byte-for-byte and actionable", () => {
  assert.equal(matrixDrift("same\n", "same\n"), null);
  assert.match(matrixDrift("expected\n", "stale\n"), /--write/);
});
