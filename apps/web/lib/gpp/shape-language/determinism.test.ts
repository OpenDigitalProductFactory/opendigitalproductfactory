// AC-DETERMINISM (PR-3b-5, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.4 (D: "compile(D) is byte-identical across runs, hosts and input key
// order"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-5). The in-memory
// precursor over decompile and lowering is registry-roundtrip.test.ts.
//
// For every committed document, every passing DRC fixture and every decompiled
// registry document (with the real ratification table, and with every scope
// test-ratified so typed gates are emitted), compile twice: once from the
// text, once from a copy whose object keys are shuffled by a seeded PRNG and
// re-serialized with different whitespace. The module bytes must be identical.
// The ratification report and the whole generator output must be too, and no
// output may carry `\r` or an ISO timestamp.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { serializeStableJson } from "../../../scripts/registry-generator-support";
import {
  buildGppShapeOutputs,
  defaultGppShapesContext,
  listShapeDocuments,
  type GppShapesContext,
} from "../../../scripts/build-gpp-shapes";
import { seedFor, SHUFFLE_SALTS, shuffledKeys } from "./__fixtures__/key-order";
import { compileShapeDocument } from "./compile";
import { decompile } from "./decompile";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { buildRatificationReport } from "./ratification-report";

const REPO_ROOT = join(__dirname, "../../../../..");
const DRC_DIR = join(__dirname, "__fixtures__", "drc");
const DRC_RATIFICATION = JSON.parse(readFileSync(join(DRC_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const ALL_RATIFIED: Readonly<Record<string, GateRatificationEntry>> = Object.fromEntries(
  Object.entries(GATE_RATIFICATION).map(([scope, entry]) => [
    scope,
    { status: "ratified", proposed: entry.proposed, basis: entry.basis, decisionId: "DI-000000000000", ratifiedAt: "2026-10-02" },
  ]),
);

let context: GppShapesContext;
beforeAll(() => {
  context = defaultGppShapesContext();
}, 120_000);

type Case = { id: string; text: string; ratification: Readonly<Record<string, GateRatificationEntry>> };

function cases(): Case[] {
  const committed = listShapeDocuments(REPO_ROOT).map((file) => ({
    id: file.relativePath,
    text: readFileSync(join(REPO_ROOT, file.relativePath), "utf8"),
    ratification: GATE_RATIFICATION,
  }));
  const fixtures = readdirSync(DRC_DIR)
    .filter((name) => name.startsWith("pass-") && name.endsWith(".gpp.json"))
    .sort()
    .map((name) => ({ id: name, text: readFileSync(join(DRC_DIR, name), "utf8"), ratification: DRC_RATIFICATION }));
  const registry = context.definitions.flatMap((definition: WorkShapeDefinition) =>
    ([["real", GATE_RATIFICATION], ["ratified", ALL_RATIFIED]] as const).map(([variant, ratification]) => ({
      id: `${definition.key}@${definition.version} (${variant})`,
      text: JSON.stringify(decompile(definition, { ratification }).document, null, 2),
      ratification,
    })),
  );
  return [...committed, ...fixtures, ...registry];
}

async function compileModule(text: string, ratification: Case["ratification"]): Promise<string | null> {
  const result = await compileShapeDocument(text, context.sources, { sourcePath: "doc.gpp.json", ratification, directSites: context.directSites });
  return result.accepted ? result.module : null;
}

describe("AC-DETERMINISM: generated TypeScript is byte-identical across runs and input key order", () => {
  it("every committed document, passing fixture and decompiled registry document", async () => {
    let compared = 0;
    let gated = 0;
    for (const { id, text, ratification } of cases()) {
      const first = await compileModule(text, ratification);
      const again = await compileModule(text, ratification);
      expect(again, id).toBe(first);
      for (const salt of SHUFFLE_SALTS) {
        const shuffled = JSON.stringify(shuffledKeys(JSON.parse(text) as unknown, seedFor(id, salt)), null, salt);
        expect(shuffled === text, `${id}: the shuffle changed nothing`).toBe(false);
        expect(await compileModule(shuffled, ratification), `${id} salt ${salt}`).toBe(first);
      }
      if (first === null) continue;
      compared += 1;
      if (first.includes("gate: {")) gated += 1;
      expect(first.includes("\r"), id).toBe(false);
      expect(first, id).not.toMatch(ISO_TIMESTAMP);
      expect(first.endsWith(";\n") && !first.endsWith("\n\n"), id).toBe(true);
    }
    expect(compared).toBeGreaterThan(40);
    expect(gated).toBeGreaterThan(0);
  }, 300_000);

  it("the ratification report is byte-identical across runs and definition key order", () => {
    const first = serializeStableJson(buildRatificationReport(context.definitions));
    expect(serializeStableJson(buildRatificationReport(context.definitions))).toBe(first);
    for (const salt of SHUFFLE_SALTS) {
      const shuffled = context.definitions.map((definition) => shuffledKeys(definition, seedFor(definition.key, salt)));
      expect(serializeStableJson(buildRatificationReport(shuffled))).toBe(first);
    }
    expect(first.includes("\r")).toBe(false);
    expect(first).not.toMatch(ISO_TIMESTAMP);
  });

  it("the whole generator output is identical across two runs, with no CR and no timestamp", async () => {
    const first = await buildGppShapeOutputs(REPO_ROOT, context);
    const second = await buildGppShapeOutputs(REPO_ROOT, defaultGppShapesContext());
    expect([...second.outputs.entries()]).toEqual([...first.outputs.entries()]);
    expect(first.refusals).toEqual([]);
    for (const [path, text] of first.outputs) {
      expect(text.includes("\r"), path).toBe(false);
      expect(text, path).not.toMatch(ISO_TIMESTAMP);
    }
  }, 120_000);
});
