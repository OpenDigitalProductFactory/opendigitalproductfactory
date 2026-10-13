#!/usr/bin/env node
// Tests for the New Dependency Gate's retired-name refusal (plan 2026-09-08 §7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createUpdatedAllowlist, findRetiredInUse } from "./check-new-dependencies.mjs";
import {
  externalDependencyNames,
  matrixDrift,
  renderDependencyDispositionMatrix,
  validateDependencyDispositions,
} from "./dependency-dispositions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a declared name on the retired list is reported; others are not", () => {
  const retired = { puppeteer: { retired: "2026-09-08", reason: "x" } };
  assert.deepEqual(findRetiredInUse(["zod", "puppeteer"], retired), ["puppeteer"]);
  assert.deepEqual(findRetiredInUse(["zod"], retired), []);
});

test("a missing retired map retires nothing, and inherited keys never match", () => {
  assert.deepEqual(findRetiredInUse(["toString", "zod"], undefined), []);
  assert.deepEqual(findRetiredInUse(["constructor"], {}), []);
});

test("the live allowlist never acknowledges a name it also retires", () => {
  const allow = JSON.parse(readFileSync(join(ROOT, "sbom", "dependency-allowlist.json"), "utf8"));
  const both = Object.keys(allow.retired ?? {}).filter((n) => Object.hasOwn(allow.dependencies, n));
  assert.deepEqual(both, []);
  for (const [name, entry] of Object.entries(allow.retired ?? {})) {
    assert.match(entry.retired, /^\d{4}-\d{2}-\d{2}$/, `${name} needs a retired date`);
    assert.ok(entry.reason && entry.reason.length > 20, `${name} needs a reason`);
  }
});

test("updating the allowlist preserves decisions but leaves a new external dependency incomplete", () => {
  const current = new Map([
    ["existing", { workspaces: new Set(["apps/web"]), kinds: new Set(["prod"]), versions: new Set(["1.0.0"]) }],
    ["new-package", { workspaces: new Set(["apps/web"]), kinds: new Set(["dev"]), versions: new Set(["2.0.0"]) }],
  ]);
  const prior = {
    dependencies: {
      existing: {
        added: "2026-01-01",
        workspaces: ["apps/web"],
        kinds: ["prod"],
        note: "vetted",
        disposition: "keep",
        rationale: "Keep upstream while it remains the maintained standard.",
        evidence: ["docs/design.md"],
      },
    },
    retired: {},
  };

  const updated = createUpdatedAllowlist(current, prior, "2026-10-13");
  assert.equal(updated.dependencies.existing.disposition, "keep");
  assert.equal(updated.dependencies["new-package"].disposition, undefined);
  assert.equal(updated.dependencies["new-package"].note, "Vetting pending — record provenance, maintenance, license, OSV result, overlap review, and a keep/reduce/absorb disposition.");
});

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
